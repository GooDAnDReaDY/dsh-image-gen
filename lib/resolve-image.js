import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { estimateSharpnessAndVariance } from './providers.js'

/**
 * Scan active session messages in reverse order to find the latest image attachment or file ref.
 *
 * @param {object} exec - Tool execution context provided by DSH
 * @returns {{ ref: string, name?: string } | undefined}
 */
export function findLastConversationImage(exec) {
  if (!exec || !exec.agent || !exec.agent.session) return undefined
  const session = exec.agent.session
  const messages = typeof session.deriveMessages === 'function'
    ? session.deriveMessages()
    : Array.isArray(session.messages) ? session.messages : []

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue

    // 1. Check direct attachments array on message
    if (Array.isArray(msg.attachments)) {
      for (const att of msg.attachments) {
        if (att && (att.mediaType?.startsWith('image/') || att.attachmentId?.startsWith('sha256:') || att.id?.startsWith('sha256:'))) {
          return {
            ref: att.attachmentId || att.id || att.ref,
            name: att.name || att.filename || 'previous-image',
          }
        }
      }
    }

    // 2. Check content blocks
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block) continue
        if (block.type === 'image' && block.source) {
          const ref = block.source.attachmentId || block.source.id || block.source.data || block.source.url
          if (ref) return { ref, name: 'conversation-image' }
        }
        if (block.type === 'tool_result' && block.content) {
          // Look for file path or attachment reference in tool results
          const str = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
          const shaMatch = str.match(/sha256:[a-f0-9]{64}/i)
          if (shaMatch) return { ref: shaMatch[0], name: 'tool-image' }
          const fileMatch = str.match(/(?:File|Path|Saved to):\s*[`"']?([^\r\n`"']+\.(?:png|jpe?g|webp|svg))[`"']?/i)
          if (fileMatch) return { ref: fileMatch[1].trim(), name: path.basename(fileMatch[1].trim()) }
        }
      }
    }

    // 3. Check metadata fields
    if (msg.metadata) {
      const metaImg = msg.metadata.attachmentId || msg.metadata.image || msg.metadata.outputFile
      if (metaImg && typeof metaImg === 'string') {
        return { ref: metaImg, name: 'metadata-image' }
      }
    }
  }

  return undefined
}

/**
 * Determine MIME type by extension or signature.
 */
export function detectMediaType(filePath, buffer) {
  if (buffer && buffer.length >= 8) {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png'
    // JPEG signature: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg'
    // WebP signature: RIFF ... WEBP
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp'
    // SVG xml/svg check
    const head = buffer.slice(0, 100).toString('utf8').toLowerCase()
    if (head.includes('<svg') || head.includes('<?xml')) return 'image/svg+xml'
  }
  const ext = path.extname(String(filePath || '')).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.svg') return 'image/svg+xml'
  return 'image/png'
}

/**
 * Resolve target image bytes and mediaType, automatically looking up session history if omitted.
 *
 * @param {object} ctx - Cordis context
 * @param {object} exec - Tool execution context
 * @param {string} [targetRef] - User provided path, attachment ID, or 'latest'
 * @returns {Promise<{ bytes: Buffer, mediaType: string, ref: string, name: string }>}
 */
export async function resolveConversationImage(ctx, exec, targetRef) {
  const sessionCwd = exec?.agent?.session?.header?.cwd || process.cwd()
  let effectiveRef = typeof targetRef === 'string' ? targetRef.trim() : ''

  const isImplicit = !effectiveRef ||
    effectiveRef.toLowerCase() === 'latest' ||
    effectiveRef.toLowerCase() === 'last' ||
    effectiveRef.toLowerCase() === 'previous' ||
    effectiveRef.toLowerCase() === 'current'

  if (isImplicit) {
    const found = findLastConversationImage(exec)
    if (!found || !found.ref) {
      throw new Error(
        'No previous image found in the active conversation session. ' +
        'Please provide an explicit image path or attachment ID.'
      )
    }
    effectiveRef = found.ref
  }

  // 1. Attachment store resolution
  if (effectiveRef.startsWith('sha256:')) {
    if (!ctx?.attachments?.readImage) {
      throw new Error(`Attachments service unavailable to read ${effectiveRef}`)
    }
    const stored = await ctx.attachments.readImage({
      attachmentId: effectiveRef,
      mediaType: 'image/png',
      bytes: 0,
      width: 0,
      height: 0,
    })
    const bytes = Buffer.from(stored.data || stored.bytes || [])
    return {
      bytes,
      mediaType: stored.ref?.mediaType || detectMediaType('', bytes),
      ref: effectiveRef,
      name: `attachment-${effectiveRef.slice(7, 15)}`,
    }
  }

  // 2. Data URI
  if (effectiveRef.startsWith('data:')) {
    const commaIndex = effectiveRef.indexOf(',')
    if (commaIndex > 0) {
      const meta = effectiveRef.slice(0, commaIndex)
      const data = effectiveRef.slice(commaIndex + 1)
      const mediaMatch = meta.match(/data:([^;]+)/)
      const mediaType = mediaMatch ? mediaMatch[1] : 'image/png'
      const bytes = Buffer.from(data, 'base64')
      return {
        bytes,
        mediaType,
        ref: effectiveRef.slice(0, 32) + '...',
        name: 'inline-image',
      }
    }
  }

  // 3. Local filesystem resolution
  const absPath = path.isAbsolute(effectiveRef)
    ? effectiveRef
    : path.resolve(sessionCwd, effectiveRef)

  const fileStat = await stat(absPath).catch(() => null)
  if (!fileStat) {
    throw new Error(`Image file not found: ${effectiveRef}`)
  }
  if (fileStat.size === 0) {
    throw new Error(`Image file is empty (0 bytes): ${effectiveRef}`)
  }
  if (fileStat.size > 50 * 1024 * 1024) {
    throw new Error(`Image file too large (${(fileStat.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is 50 MB.`)
  }

  const bytes = await readFile(absPath)
  const mediaType = detectMediaType(absPath, bytes)
  return {
    bytes,
    mediaType,
    ref: effectiveRef,
    name: path.basename(absPath, path.extname(absPath)),
  }
}

/**
 * Query @goodandready/dsh-vision-bridge or Cordis tools to extract structural scene cues.
 *
 * @param {object} ctx - Cordis context
 * @param {object} exec - Tool execution context
 * @param {{ bytes: Buffer, mediaType: string, ref: string }} source - Source image
 * @returns {Promise<{ available: boolean, summary: string, subjects?: string[], palette?: string }>}
 */
export async function analyzeImageWithVision(ctx, exec, source) {
  if (!source || !source.bytes) {
    return { available: false, summary: 'No image data to analyze' }
  }

  // Check if dsh-vision-bridge tools exist in runtime
  const inspectTool = ctx?.tools?.get?.('inspect_image') || ctx?.tools?.get?.('describe_image')
  if (inspectTool && typeof inspectTool.execute === 'function') {
    try {
      const res = await inspectTool.execute(
        {
          source: source.ref,
          attachmentIds: source.ref.startsWith('sha256:') ? [source.ref] : undefined,
          paths: !source.ref.startsWith('sha256:') ? [source.ref] : undefined,
          question: 'Summarize in 1 sentence: key subjects, visual style, and dominant colors for image editing.',
          detail: 'low',
        },
        exec,
      )
      const text = res?.description || res?.summary || (typeof res === 'string' ? res : '')
      if (text && text.trim()) {
        return {
          available: true,
          summary: text.trim(),
        }
      }
    } catch {
      // Vision bridge execution failed or timed out; proceed with local fallback
    }
  }

  // Local fallback: analyze sharpness and dimensions without external model call
  const analysis = estimateSharpnessAndVariance(source.bytes)
  const fallbackSummary = analysis.isBlank
    ? 'Low-contrast or uniform canvas'
    : `Detected visual asset (${source.mediaType}, sharpness: ${analysis.score})`

  return {
    available: false,
    summary: fallbackSummary,
  }
}
/**
 * Форматирует структурированный текстовый отчёт для безопасного возврата в LLM (#150 Dual-Output).
 */
export function buildDualOutputMarkdown({
  action = 'generated',
  filePath,
  width,
  height,
  mediaType,
  seed,
  provider,
  model,
  cost,
  attachmentId,
}) {
  return `✅ **Image ${action} successfully**\n`
    + `- **File:** \`${filePath}\`\n`
    + `- **Dimensions:** ${width}x${height} (${mediaType || 'image/png'})\n`
    + `- **Seed:** ${seed ?? 'N/A'} | **Provider:** ${provider} (${model})\n`
    + (cost !== undefined ? `- **Cost:** $${Number(cost).toFixed(4)}\n` : '')
    + `- **Attachment ID:** \`${attachmentId}\`\n\n`
    + `*(Interactive visual card rendered in conversation UI)*`
}
