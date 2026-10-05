import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { saveAttachmentSafe, buildSidecar, toLosslessJson, ensureImageFormat } from './providers.js'
import { resolveInside } from './security.js'
import { recordSpend } from './cost-meter.js'
import { buildDualOutputMarkdown } from './resolve-image.js'

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
  const targetDir = (args.output_dir && String(args.output_dir).trim()) || cfg.outputDir || 'generated/images'
  const outDir = resolveInside(sessionCwd || process.cwd(), targetDir)
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

/** Raster media types safe for multimodal LLM context (DeepSeek, OpenAI, Claude, Gemini). */
const SAFE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function renderToolOutput(value) {
  const text = (value && value.summary) || (typeof value === "string" ? value : JSON.stringify(value || ""))
  const blocks = [{ type: "text", text }]
  if (value && value.attachment
      && value.attachment.attachmentId
      && SAFE_IMAGE_TYPES.has(value.attachment.mediaType)) {
    blocks.push({ type: "image", attachment: value.attachment })
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
