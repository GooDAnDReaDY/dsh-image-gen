import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { saveAttachmentSafe, buildSidecar, toLosslessJson, ensureImageFormat } from './providers.js'
import { resolveInside } from './security.js'
import { recordSpend } from './cost-meter.js'
import { resolveAssetOutputDir, buildSemanticSlug, resolveSessionSlug } from './session-artifacts.js'
import { buildDualOutputMarkdown } from './resolve-image.js'

/** Default byte/character threshold above which data URIs are offloaded from context */
export const DEFAULT_OFFLOAD_THRESHOLD = 1024

/** Raster media types safe for multimodal LLM context (DeepSeek, OpenAI, Claude, Gemini). */
export const SAFE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Regex matching inline data URI images */
const DATA_URI_IMAGE_REGEX = /data:(image\/[a-zA-Z0-9\+\-\.]+);base64,([A-Za-z0-9+/=]+)/g

/**
 * Offloads heavy base64 data URIs and raw buffers from text, structures, and messages
 * into persistent attachments or workspace files, replacing them with lightweight links.
 * Preserves metadata (dimensions, format, seed, prompt, attachmentId).
 *
 * @param {string|object|Array} input
 * @param {object} [options]
 * @param {object} [options.ctx] - Cordis context with ctx.attachments
 * @param {number} [options.threshold=1024] - Base64 payload length threshold
 * @param {string} [options.cwd] - Target workspace directory
 * @param {string} [options.outputDir='generated/offload']
 * @returns {Promise<any>}
 */
export async function offloadHeavyImageData(input, options = {}) {
  const threshold = typeof options.threshold === 'number' ? options.threshold : DEFAULT_OFFLOAD_THRESHOLD
  const ctx = options.ctx
  const cwd = options.cwd || process.cwd()
  const outputDir = options.outputDir || 'generated/offload'

  if (typeof input === 'string') {
    if (!input.includes('data:image/')) {
      return input
    }
    const matches = Array.from(input.matchAll(DATA_URI_IMAGE_REGEX))
    if (!matches.length) return input

    let resultText = input
    for (const match of matches) {
      const fullUri = match[0]
      const mediaType = match[1]
      const b64Data = match[2]
      if (b64Data.length > threshold) {
        try {
          const buf = Buffer.from(b64Data, 'base64')
          const hash = createHash('sha256').update(buf).digest('hex')
          const ext = mediaType.includes('png') ? 'png' : mediaType.includes('jpeg') ? 'jpg' : mediaType.includes('webp') ? 'webp' : mediaType.includes('gif') ? 'gif' : mediaType.includes('svg') ? 'svg' : 'bin'
          const name = `offload-${hash.slice(0, 16)}.${ext}`

          let replaceUrl = ''
          if (ctx && ctx.attachments && typeof ctx.attachments.saveImage === 'function' && SAFE_IMAGE_TYPES.has(mediaType)) {
            const { attachment, localUrl } = await saveAttachmentSafe(ctx, { bytes: buf, mediaType, name })
            if (localUrl) replaceUrl = localUrl
            else if (attachment && attachment.attachmentId) {
              replaceUrl = `/dsh-image-gen/image?id=${encodeURIComponent(attachment.attachmentId)}`
            }
          }

          if (!replaceUrl) {
            const outDir = resolveInside(cwd, outputDir)
            await mkdir(outDir, { recursive: true })
            const filePath = path.join(outDir, name)
            await writeFile(filePath, buf)
            replaceUrl = `file://${filePath}`
          }

          resultText = resultText.replaceAll(fullUri, replaceUrl)
        } catch (err) {
          if (typeof ctx?.logger?.debug === 'function') ctx.logger.debug(`[dsh-image-gen] offload failure: ${err?.message || err}`)
        }
      }
    }
    return resultText
  }

  if (input && typeof input === 'object') {
    if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
      if (input.length > threshold) {
        const hash = createHash('sha256').update(input).digest('hex')
        const name = `offload-${hash.slice(0, 16)}.bin`
        const { attachment, localUrl } = await saveAttachmentSafe(ctx, { bytes: input, mediaType: 'image/png', name })
        return {
          attachmentId: attachment?.attachmentId || `sha256:${hash}`,
          bytes: input.length,
          url: localUrl || `/dsh-image-gen/image?id=sha256:${hash}`,
          mediaType: 'image/png',
        }
      }
      return input
    }

    if (Array.isArray(input)) {
      const resArr = []
      for (const item of input) {
        resArr.push(await offloadHeavyImageData(item, options))
      }
      return resArr
    }

    const resObj = {}
    for (const [key, val] of Object.entries(input)) {
      if (key === 'bytes' && (Buffer.isBuffer(val) || val instanceof Uint8Array)) {
        resObj.bytes = val.length
      } else {
        resObj[key] = await offloadHeavyImageData(val, options)
      }
    }
    return resObj
  }

  return input
}

/**
 * Compacts tool execution results, session messages, and conversation history
 * to avoid blowing up the LLM context window in multi-turn dialogues (#456).
 * Preserves essential generation metadata: dimensions, prompt, seed, format, cost, attachmentId.
 *
 * @param {any} payload
 * @param {object} [options]
 * @returns {Promise<any>}
 */
export async function compactSessionPayload(payload, options = {}) {
  if (!payload || typeof payload !== 'object') {
    if (typeof payload === 'string' && payload.includes('data:image/')) {
      return offloadHeavyImageData(payload, options)
    }
    return payload
  }

  const offloaded = await offloadHeavyImageData(payload, options)
  if (offloaded && typeof offloaded === 'object') {
    if (offloaded.attachment && typeof offloaded.attachment === 'object') {
      if (Buffer.isBuffer(offloaded.attachment.bytes) || offloaded.attachment.bytes instanceof Uint8Array) {
        offloaded.attachment.bytes = offloaded.attachment.bytes.length
      }
    }
    if (Array.isArray(offloaded.images)) {
      for (const img of offloaded.images) {
        if (img && img.attachment && (Buffer.isBuffer(img.attachment.bytes) || img.attachment.bytes instanceof Uint8Array)) {
          img.attachment.bytes = img.attachment.bytes.length
        }
      }
    }
  }
  return offloaded
}

export async function saveAndAttachResult(ctx, exec, cfg, {
  bytes,
  mediaType,
  name,
  stem,
  prompt,
  size,
  format,
  seed,
  provider,
  model,
  cost,
  sourceUrl,
  deliverAs,
  args = {},
  action = 'generated',
}) {
  const targetFormat = format || (mediaType ? mediaType.replace('image/', '') : undefined)
  const formatted = await ensureImageFormat(bytes, targetFormat, { fallbackMime: mediaType })
  bytes = formatted.bytes
  mediaType = formatted.mediaType
  const { attachment, localUrl } = await saveAttachmentSafe(ctx, { bytes, mediaType, name })

  const sessionCwd = exec?.agent?.session?.header?.cwd
  const outDir = resolveAssetOutputDir({
    cwd: process.cwd(),
    sessionCwd,
    session: exec?.agent?.session,
    cfg,
    args,
  })
  await mkdir(outDir, { recursive: true })
  const filePath = path.join(outDir, name)
  await writeFile(filePath, bytes)

  await writeFile(
    path.join(outDir, `${stem}.json`),
    JSON.stringify(buildSidecar({
      prompt,
      size,
      format,
      seed,
      provider,
      deliverAs,
      width: attachment.width,
      height: attachment.height,
      mediaType,
      attachmentId: attachment.attachmentId,
      url: deliverAs === 'image' && sourceUrl ? sourceUrl : localUrl,
      cost,
    }), null, 2),
  )

  const effectiveCost = Number(cost) || 0
  if (effectiveCost > 0) {
    recordSpend(effectiveCost, {
      ctx,
      meta: {
        provider,
        model: model || cfg.model || cfg.customModel || 'default',
        prompt,
        seed,
      },
    })
  }

  const summary = buildDualOutputMarkdown({
    action,
    filePath,
    width: attachment.width,
    height: attachment.height,
    mediaType,
    seed,
    provider,
    model: model || cfg.model || cfg.customModel || 'default',
    cost,
    attachmentId: attachment.attachmentId,
  })

  return toLosslessJson({
    summary,
    path: filePath,
    url: deliverAs === 'image' && sourceUrl ? sourceUrl : localUrl,
    width: attachment.width,
    height: attachment.height,
    seed,
    prompt,
    cost,
    format: mediaType.replace('image/', ''),
    attachment: {
      attachmentId: attachment.attachmentId,
      mediaType: attachment.mediaType,
      bytes: attachment.bytes,
      width: attachment.width,
      height: attachment.height,
      name: attachment.name,
    },
  })
}

export function renderToolOutput(value) {
  let text = (value && value.summary) || (typeof value === "string" ? value : JSON.stringify(value || ""))
  if (text.includes('data:image/')) {
    text = text.replace(DATA_URI_IMAGE_REGEX, (match, mediaType, b64) => {
      if (b64.length > DEFAULT_OFFLOAD_THRESHOLD) {
        const hash = createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex')
        return `/dsh-image-gen/image?id=sha256:${hash}`
      }
      return match
    })
  }
  const blocks = [{ type: "text", text }]
  if (value && value.attachment
      && value.attachment.attachmentId
      && SAFE_IMAGE_TYPES.has(value.attachment.mediaType)) {
    const att = {
      attachmentId: value.attachment.attachmentId,
      mediaType: value.attachment.mediaType,
      bytes: typeof value.attachment.bytes === 'number' ? value.attachment.bytes : (value.attachment.bytes?.length || 0),
      width: value.attachment.width || 0,
      height: value.attachment.height || 0,
      ...(value.attachment.name ? { name: value.attachment.name } : {}),
    }
    blocks.push({ type: "image", attachment: att })
  }
  return blocks
}

export function buildPresentationMeta(value) {
  if (!value || typeof value !== 'object') return null
  const meta = {
    url: value.url,
    path: value.path,
    width: value.width,
    height: value.height,
    seed: value.seed,
    prompt: value.prompt,
    provider: value.provider,
    model: value.model,
    attachment: value.attachment,
    attachmentId: value.attachment?.attachmentId || value.attachmentId,
  }
  if (value.images) meta.images = value.images
  if (value.cells) meta.cells = value.cells
  if (value.base_prompt) meta.base_prompt = value.base_prompt
  if (value.blind_mode !== undefined) meta.blind_mode = value.blind_mode
  if (value.light) meta.light = value.light
  if (value.dark) meta.dark = value.dark
  if (value.html_snippet) meta.html_snippet = value.html_snippet
  if (value.css_snippet) meta.css_snippet = value.css_snippet
  return meta
}

export { resolveAssetOutputDir, buildSemanticSlug, resolveSessionSlug }
