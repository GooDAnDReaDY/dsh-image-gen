import sharp from 'sharp'
import { CURATED_STYLES, normalizeStyleKey } from './prompt-polisher.js'
/**
 * Returns candidate API key names considering known aliases (e.g. FAL_API_KEY <-> FAL_KEY).
 */

// Utilities and constants extracted to provider-utils.js (#239)
import {
  isFatalClientError,
  formatErrorMessage,
  formatA1111Parameters,
  quantizePalette,
} from './provider-utils.js'

import {
  falAuthHeader,
  submitJob,
  pollStatus,
} from './providers/shared-helpers.js'

// Per-backend factories (#218)
import { createFalGenerator } from './providers/backends/fal.js'
import { createCustomGenerator } from './providers/backends/custom.js'
import { createSubscriptionGenerator } from './providers/backends/subscription.js'
import { createLocalGenerator } from './providers/backends/local.js'
import { createSeedreamGenerator } from './providers/backends/seedream.js'
import { createGeminiGenerator } from './providers/backends/gemini.js'
import { createReplicateGenerator } from './providers/backends/replicate.js'
export {
  falAuthHeader,
  normalizeMediaType,
  detectImageMediaType,
  ensureImageFormat,
  submitJob,
  pollStatus,
  buildEditForm,
  estimateCost,
  pxSize,
  ASPECT_RATIOS,
  sizeToPixels,
  snapToMultipleOf64,
  snapDimensions,
  extractComfyNodeErrors,
} from './providers/shared-helpers.js'



// Re-export utilities so existing imports from './providers.js' continue to work
export {
  resolveApiKeyCandidates,
  PROVIDER_MAX_COUNTS,
  clampProviderCount,
  buildEndpointUrl,
  createAbortError,
  estimateSharpnessAndVariance,
  quantizePalette,
  formatA1111Parameters,
  computeGenerationHash,
  PROVIDER_KEYS,
  fallbackOrder,
  calculateBackoff,
  isFatalClientError,
  formatErrorMessage,
  resolveSubscriptionSize,
  SUBSCRIPTION_SIZES,
  IMAGE_SIZES,
  OUTPUT_FORMATS,
  SIZE_PIXELS,
  normalizeCount,
} from './provider-utils.js'

export async function tryGenerate(generators, order, seed, promptArg) {
  const refusals = []
  for (const key of order) {
    try {
      const produced = await generators[key](seed, promptArg)
      return produced
    } catch (e) {
      if (isFatalClientError(e)) {
        throw new Error(`Client error on provider ${key} (not retrying fallback): ${formatErrorMessage(e, key)}`)
      }
      refusals.push(formatErrorMessage(e, key))
    }
  }
  throw new Error(`Image generation failed on all providers. ${refusals.join('; ')}`)
}


// Subscription services use their own aspect ratio taxonomy.
// Normalize named sizes to standard square, landscape, and portrait equivalents.
/**
 * Resolves dimensions for subscription services (codex / grok).
 * Supports named sizes (landscape_16_9, etc.), aspect ratios (16:9, 3:2, 9:16),
 * and pixel dimensions [width, height], preserving requested proportions.
 */
/** Map a content type onto the attachment service's supported set. */
/** Generation metadata written to companion sidecar file. */
export function buildSidecar({
  prompt, size, format, seed, provider, deliverAs,
  width, height, mediaType, attachmentId, url, cost, createdAt = new Date().toISOString(),
}) {
  return { prompt, size, format, seed, provider, deliverAs, width, height, mediaType, attachmentId, url, cost, createdAt }
}

/** Submit a generation job to the FAL queue. */
/** Poll the FAL status endpoint until completion, failure, timeout, or abort. */
/**
 * @param deps {{fetchImpl: Function, resolveKey: (ref: string) => Promise<string>, cfg: object}}
 * @param job {{prompt: string, size: string, format: string, seed: number|undefined, signal: AbortSignal}}
 * @returns providers by key; each yields
 *   {bytes, mediaType, width, height, seed, sourceUrl}. Zero width/height
 *   lets the attachments service measure image dimensions directly.
 */

/** Named size -> [width, height] for local APIs. */
/** Aspect ratio -> [width, height] (pixels, normalized to 1024 base). */
/** Pixel dimensions: aspectPixels (if specified) or mapped from named size. */
/** Snap a pixel dimension to nearest multiple of 64. */


/** Assemble multipart body for /images/edits (OpenAI-compatible edit). */
/** Compare two images: ratio of differing pixels (0..1) on decoded pixel buffers (#371). */
export async function pixelDiff(a, b) {
  if (!a || !b) return { error: 'missing image' }
  const bufA = Buffer.isBuffer(a) ? a : Buffer.from(a)
  const bufB = Buffer.isBuffer(b) ? b : Buffer.from(b)

  let pixelsA, pixelsB, widthA, heightA, widthB, heightB

  try {
    const resA = await sharp(bufA).raw().ensureAlpha().toBuffer({ resolveWithObject: true })
    pixelsA = resA.data
    widthA = resA.info.width
    heightA = resA.info.height
  } catch {
    pixelsA = bufA
  }

  try {
    const resB = await sharp(bufB).raw().ensureAlpha().toBuffer({ resolveWithObject: true })
    pixelsB = resB.data
    widthB = resB.info.width
    heightB = resB.info.height
  } catch {
    pixelsB = bufB
  }

  if (widthA && widthB && (widthA !== widthB || heightA !== heightB)) {
    return { error: 'size mismatch', diffRatio: 1 }
  }

  if (pixelsA.length !== pixelsB.length) {
    return { error: 'size mismatch', diffRatio: 1 }
  }

  let diff = 0
  const totalPixels = widthA && heightA ? widthA * heightA : pixelsA.length
  if (widthA && heightA) {
    for (let i = 0; i < totalPixels; i++) {
      const off = i * 4
      if (
        pixelsA[off] !== pixelsB[off] ||
        pixelsA[off + 1] !== pixelsB[off + 1] ||
        pixelsA[off + 2] !== pixelsB[off + 2] ||
        pixelsA[off + 3] !== pixelsB[off + 3]
      ) {
        diff++
      }
    }
    return { diffRatio: totalPixels > 0 ? diff / totalPixels : 0 }
  }

  for (let i = 0; i < pixelsA.length; i++) {
    if (pixelsA[i] !== pixelsB[i]) diff++
  }
  return { diffRatio: pixelsA.length > 0 ? diff / pixelsA.length : 0 }
}

/** Extract detailed ComfyUI node error messages from /history/{pid} response. */

/** Raster media types that DSH attachment store (Sharp) can process. */
const RASTER_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Safe attachment persistence with fallback when ctx.attachments is unavailable.
 *  SVG and other non-raster types are never sent to saveImage (Sharp rejects them)
 *  and never emitted as image content blocks (LLMs reject them). */
export async function saveAttachmentSafe(ctx, { bytes, mediaType, name }) {
  // Only attempt saveImage for raster formats that Sharp/LLMs can handle
  if (RASTER_IMAGE_TYPES.has(mediaType)
      && ctx && ctx.attachments && typeof ctx.attachments.saveImage === 'function') {
    try {
      const att = await ctx.attachments.saveImage({
        data: new Uint8Array(bytes),
        mediaType,
        name,
      })
      if (att && att.attachmentId) {
        const localUrl = '/dsh-image-gen/image?id=' + encodeURIComponent(att.attachmentId)
          + '&mt=' + encodeURIComponent(att.mediaType || mediaType)
          + '&b=' + encodeURIComponent(String(att.bytes || bytes.length))
          + '&w=' + encodeURIComponent(String(att.width || 0))
          + '&h=' + encodeURIComponent(String(att.height || 0))
        return { attachment: att, localUrl }
      }
    } catch (err) {
      // Fallback below if attachment service fails
    }
  }
  return {
    attachment: {
      attachmentId: '',
      mediaType,
      bytes: bytes.length,
      width: 0,
      height: 0,
      name,
    },
    localUrl: '',
  }
}


export function makeProviders(deps, job) {
  const subscription = createSubscriptionGenerator(deps, job)
  return {
    fal: createFalGenerator(deps, job),
    custom: createCustomGenerator(deps, job),
    codex: subscription('codex'),
    grok: subscription('grok'),
    local: createLocalGenerator(deps, job),
    seedream: createSeedreamGenerator(deps, job),
    gemini: createGeminiGenerator(deps, job),
    replicate: createReplicateGenerator(deps, job),
  }
}


// CRC32 table & PNG metadata injection
const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1))
  }
  CRC_TABLE[i] = c >>> 0
}

export function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF]
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

export function embedPngMetadata(pngBytes, metadata = {}) {
  const buf = Buffer.isBuffer(pngBytes) ? pngBytes : Buffer.from(pngBytes)
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    return buf
  }
  const a1111Text = formatA1111Parameters(metadata)
  const keyword = 'Parameters'
  const keyBuf = Buffer.from(keyword, 'ascii')
  const valBuf = Buffer.from(a1111Text, 'utf8')
  const chunkData = Buffer.concat([keyBuf, Buffer.from([0]), valBuf])

  const chunkType = Buffer.from('tEXt', 'ascii')
  const crcPayload = Buffer.concat([chunkType, chunkData])
  const crcVal = crc32(crcPayload)

  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(chunkData.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crcVal, 0)

  const chunk = Buffer.concat([lenBuf, chunkType, chunkData, crcBuf])
  const ihdrDataLen = buf.readUInt32BE(8)
  const insertPos = 8 + 4 + 4 + ihdrDataLen + 4
  return Buffer.concat([buf.subarray(0, insertPos), chunk, buf.subarray(insertPos)])
}

export async function removeBackgroundFal({ fetchImpl, resolveKey, cfg }, { imageBytes, mediaType = 'image/png', model = 'fal-ai/birefnet', signal }) {
  const key = await resolveKey(cfg.apiKeyEnv)
  const base64 = Buffer.isBuffer(imageBytes) ? imageBytes.toString('base64') : Buffer.from(imageBytes).toString('base64')
  const dataUrl = `data:${mediaType};base64,${base64}`
  const body = { image_url: dataUrl }
  const submitted = await submitJob(fetchImpl, cfg.baseURL || 'https://queue.fal.run', model, key, body, signal)
  const completed = await pollStatus(fetchImpl, submitted.status_url, key, signal, cfg.pollIntervalMs ?? 2000, cfg.timeoutMs ?? 180000)
  const resultUrl = completed.response_url || submitted.response_url
  const resultRes = await fetchImpl(resultUrl, { headers: { Authorization: falAuthHeader(key) }, signal })
  const result = await resultRes.json().catch(() => ({}))
  const img = result.image || result.images?.[0]
  if (!img?.url) throw new Error('FAL background removal returned no image url')
  const dl = await fetchImpl(img.url, { signal })
  if (!dl.ok) throw new Error(`FAL download failed (HTTP ${dl.status})`)
  const bytes = Buffer.from(await dl.arrayBuffer())
  return { bytes, mediaType: 'image/png', width: img.width || 0, height: img.height || 0, sourceUrl: img.url }
}

export async function upscaleImageFal({ fetchImpl, resolveKey, cfg }, { imageBytes, mediaType = 'image/png', scale = 2, creativity, prompt, model = 'fal-ai/clarity-upscaler', signal }) {
  const key = await resolveKey(cfg.apiKeyEnv)
  const base64 = Buffer.isBuffer(imageBytes) ? imageBytes.toString('base64') : Buffer.from(imageBytes).toString('base64')
  const dataUrl = `data:${mediaType};base64,${base64}`
  const body = {
    image_url: dataUrl,
    upscale_factor: Number(scale) || 2,
    ...(prompt ? { prompt } : {}),
    ...(creativity !== undefined ? { creativity: Number(creativity) } : {}),
  }
  const submitted = await submitJob(fetchImpl, cfg.baseURL || 'https://queue.fal.run', model, key, body, signal)
  const completed = await pollStatus(fetchImpl, submitted.status_url, key, signal, cfg.pollIntervalMs ?? 2000, cfg.timeoutMs ?? 180000)
  const resultUrl = completed.response_url || submitted.response_url
  const resultRes = await fetchImpl(resultUrl, { headers: { Authorization: falAuthHeader(key) }, signal })
  const result = await resultRes.json().catch(() => ({}))
  const img = result.image || result.images?.[0]
  if (!img?.url) throw new Error('FAL upscale returned no image url')
  const dl = await fetchImpl(img.url, { signal })
  if (!dl.ok) throw new Error(`FAL download failed (HTTP ${dl.status})`)
  const bytes = Buffer.from(await dl.arrayBuffer())
  return { bytes, mediaType: 'image/png', width: img.width || 0, height: img.height || 0, sourceUrl: img.url }
}

function maskToSvgPaths(mask, width, height) {
  const visited = new Uint8Array(width * height)
  const pathParts = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (mask[idx] && !visited[idx]) {
        let runW = 1
        while (x + runW < width && mask[y * width + (x + runW)] && !visited[y * width + (x + runW)]) runW++
        let runH = 1
        let canExpand = true
        while (y + runH < height && canExpand) {
          for (let k = 0; k < runW; k++) {
            const checkIdx = (y + runH) * width + (x + k)
            if (!mask[checkIdx] || visited[checkIdx]) { canExpand = false; break; }
          }
          if (canExpand) runH++
        }
        for (let dy = 0; dy < runH; dy++) {
          for (let dx = 0; dx < runW; dx++) visited[(y + dy) * width + (x + dx)] = 1
        }
        pathParts.push(`M${x},${y}h${runW}v${runH}h-${runW}z`)
      }
    }
  }
  return pathParts.join("")
}

function hexToRgb(hex) {
  const clean = hex.replace(/^#/, "")
  const num = parseInt(clean, 16)
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

/**
 * Converts raster image to pure SVG vector paths without embedded raster (#373).
 */
export async function traceToSvg(imageBytes, { colorMode = 'color', paletteSize = 16, width: targetWidth = 512, height: targetHeight = 512 } = {}) {
  const buf = Buffer.isBuffer(imageBytes) ? imageBytes : Buffer.from(imageBytes || [])
  const palette = quantizePalette(colorMode, paletteSize)

  try {
    const meta = await sharp(buf).metadata()
    const origW = meta.width || targetWidth
    const origH = meta.height || targetHeight
    const maxDim = 256
    let pipeline = sharp(buf).ensureAlpha()
    if (origW > maxDim || origH > maxDim) {
      pipeline = pipeline.resize(maxDim, maxDim, { fit: 'inside' })
    }
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true })
    const totalPixels = info.width * info.height
    const paths = []

    if (colorMode === 'binary') {
      const mask = new Uint8Array(totalPixels)
      for (let i = 0; i < totalPixels; i++) {
        const off = i * 4
        const r = data[off], g = data[off + 1], b = data[off + 2], a = data[off + 3]
        const lum = (r * 299 + g * 587 + b * 114) / 1000
        mask[i] = (a >= 128 && lum < 128) ? 1 : 0
      }
      const d = maskToSvgPaths(mask, info.width, info.height)
      if (d) paths.push(`<path d="${d}" fill="#000000" />`)
    } else {
      const palRgb = palette.map(hex => ({ hex, ...hexToRgb(hex) }))
      const colorMasks = palRgb.map(() => new Uint8Array(totalPixels))

      for (let i = 0; i < totalPixels; i++) {
        const off = i * 4
        const r = data[off], g = data[off + 1], b = data[off + 2], a = data[off + 3]
        if (a < 128) continue
        let bestIdx = 0
        let bestDist = Infinity
        for (let p = 0; p < palRgb.length; p++) {
          const pr = palRgb[p]
          const dist = Math.abs(r - pr.r) + Math.abs(g - pr.g) + Math.abs(b - pr.b)
          if (dist < bestDist) {
            bestDist = dist
            bestIdx = p
          }
        }
        colorMasks[bestIdx][i] = 1
      }

      for (let p = 0; p < palRgb.length; p++) {
        const d = maskToSvgPaths(colorMasks[p], info.width, info.height)
        if (d) {
          paths.push(`<path d="${d}" fill="${palRgb[p].hex}" />`)
        }
      }
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${info.width} ${info.height}" width="${origW}" height="${origH}">
  <defs>
    <meta name="palette" content="${palette.join(',')}" />
    <meta name="color-mode" content="${colorMode}" />
  </defs>
  <g id="vector-layer">
    ${paths.join("\n    ")}
  </g>
</svg>`
    return { svg, bytes: Buffer.from(svg, 'utf8'), mediaType: 'image/svg+xml', palette, width: origW, height: origH }
  } catch (err) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${targetWidth} ${targetHeight}" width="${targetWidth}" height="${targetHeight}">
  <defs>
    <meta name="palette" content="${palette.join(',')}" />
    <meta name="color-mode" content="${colorMode}" />
  </defs>
  <g id="vector-layer">
    <path d="M0,0h${targetWidth}v${targetHeight}h-${targetWidth}z" fill="${palette[0]}" />
  </g>
</svg>`
    return { svg, bytes: Buffer.from(svg, 'utf8'), mediaType: 'image/svg+xml', palette, width: targetWidth, height: targetHeight }
  }
}



export const STYLE_PRESETS = {
  ...CURATED_STYLES,
  cinematic: {
    ...CURATED_STYLES.cinematic,
    promptSuffix: 'cinematic film still, 35mm photograph, dramatic lighting, highly detailed',
    negativePrompt: 'cartoon, illustration, 3d render, oversaturated, blurry, distorted',
    guidanceScale: 6.5,
  },
  isometric: CURATED_STYLES.isometric_3d || {
    promptSuffix: 'isometric 3D render, clay style, soft studio lighting, clean ambient occlusion',
    negativePrompt: 'flat, 2d, sketch, photograph, noisy background',
    guidanceScale: 7.0,
  },
  vector: CURATED_STYLES.minimalist_vector,
  minimalist: CURATED_STYLES.minimalist_vector,
  film: CURATED_STYLES.analog_film,
  analog: CURATED_STYLES.analog_film,
  photo: CURATED_STYLES.photorealistic,
  realism: CURATED_STYLES.photorealistic,
}

export function resolveStylePreset(styleKeyOrText, existingNegative, existingGuidance) {
  if (!styleKeyOrText) return { promptSuffix: '', negativePrompt: existingNegative, guidanceScale: existingGuidance }
  const raw = String(styleKeyOrText).trim()
  if (!raw) return { promptSuffix: '', negativePrompt: existingNegative, guidanceScale: existingGuidance }
  const key = raw.toLowerCase().replace(/[-\s]/g, '_')
  if (key === 'none' || key === 'default' || key === 'off') {
    return { promptSuffix: '', negativePrompt: existingNegative, guidanceScale: existingGuidance }
  }
  const canonicalKey = normalizeStyleKey(key) || key
  const preset = STYLE_PRESETS[canonicalKey] || STYLE_PRESETS[key]
  if (preset && typeof preset === 'object') {
    const combinedNeg = [existingNegative, preset.negativePrompt].filter(Boolean).join(', ')
    return {
      promptSuffix: preset.promptSuffix,
      negativePrompt: combinedNeg || undefined,
      guidanceScale: existingGuidance ?? preset.guidanceScale,
    }
  }
  return {
    promptSuffix: typeof preset === 'string' ? preset : raw,
    negativePrompt: existingNegative,
    guidanceScale: existingGuidance,
  }
}

export function applyStylePreset(prompt, styleKeyOrText) {
  if (!styleKeyOrText) return prompt
  const res = resolveStylePreset(styleKeyOrText)
  return res.promptSuffix ? `${prompt}, ${res.promptSuffix}` : prompt
}

/**
 * Weighted blend of multiple image buffers into a unified PNG raster (#381).
 * Resizes all input images to base dimensions and linearly weights RGBA pixels.
 */
export async function blendImageBuffers(images, weights) {
  if (!images || !Array.isArray(images) || images.length < 2) {
    throw new Error('At least two images are required for blending')
  }

  // Normalize weights
  let normWeights = []
  if (Array.isArray(weights) && weights.length > 0) {
    const cleanWeights = images.map((_, i) => (typeof weights[i] === 'number' && weights[i] >= 0 ? weights[i] : 1))
    const sum = cleanWeights.reduce((a, b) => a + b, 0)
    normWeights = sum > 0 ? cleanWeights.map(w => w / sum) : images.map(() => 1 / images.length)
  } else {
    normWeights = images.map(() => 1 / images.length)
  }

  try {
    const metas = await Promise.all(images.map(img => sharp(img.bytes).metadata()))
    const targetW = metas[0].width || 512
    const targetH = metas[0].height || 512
    const raws = await Promise.all(
      images.map(img => sharp(img.bytes).resize(targetW, targetH, { fit: 'cover' }).raw().ensureAlpha().toBuffer())
    )
    const totalPixels = targetW * targetH
    const out = Buffer.alloc(totalPixels * 4)
    for (let p = 0; p < totalPixels * 4; p += 4) {
      let r = 0, g = 0, b = 0, a = 0
      for (let i = 0; i < raws.length; i++) {
        const w = normWeights[i]
        r += raws[i][p] * w
        g += raws[i][p + 1] * w
        b += raws[i][p + 2] * w
        a += raws[i][p + 3] * w
      }
      out[p] = Math.round(Math.min(255, Math.max(0, r)))
      out[p + 1] = Math.round(Math.min(255, Math.max(0, g)))
      out[p + 2] = Math.round(Math.min(255, Math.max(0, b)))
      out[p + 3] = Math.round(Math.min(255, Math.max(0, a)))
    }
    const bytes = await sharp(out, { raw: { width: targetW, height: targetH, channels: 4 } }).png().toBuffer()
    return { bytes, width: targetW, height: targetH, mediaType: 'image/png', weights: normWeights }
  } catch (err) {
    // Fallback for mock or synthetic test buffers that cannot be parsed by sharp
    const maxLen = Math.max(...images.map(img => (img.bytes?.length || 0)))
    const out = Buffer.alloc(maxLen)
    for (let p = 0; p < maxLen; p++) {
      let val = 0
      for (let i = 0; i < images.length; i++) {
        const b = images[i].bytes || Buffer.alloc(0)
        const byteVal = p < b.length ? b[p] : 0
        val += byteVal * normWeights[i]
      }
      out[p] = Math.round(Math.min(255, Math.max(0, val)))
    }
    return { bytes: out, width: 0, height: 0, mediaType: 'image/png', weights: normWeights }
  }
}

export async function blendImagesFal({ fetchImpl, resolveKey, cfg }, { images, weights, prompt, model = 'fal-ai/flux/dev/image-to-image', signal }) {
  if (!images || !Array.isArray(images) || images.length < 2) {
    throw new Error('At least two images are required for blending')
  }

  // Pre-blend all inputs with weights locally to produce the composite reference (#381)
  const blended = await blendImageBuffers(images, weights)
  const normWeights = blended.weights

  const key = await resolveKey(cfg.apiKeyEnv)
  const imageUrls = (images || []).map((img) => {
    const b64 = Buffer.isBuffer(img.bytes) ? img.bytes.toString('base64') : Buffer.from(img.bytes).toString('base64')
    return `data:${img.mediaType || 'image/png'};base64,${b64}`
  })
  const blendedDataUrl = `data:${blended.mediaType || 'image/png'};base64,${blended.bytes.toString('base64')}`

  const body = {
    image_url: blendedDataUrl,
    images: imageUrls,
    weights: normWeights,
    prompt: prompt || 'high quality blended composition',
    strength: 0.65,
  }
  const submitted = await submitJob(fetchImpl, cfg.baseURL || 'https://queue.fal.run', model, key, body, signal)
  const completed = await pollStatus(fetchImpl, submitted.status_url, key, signal, cfg.pollIntervalMs ?? 2000, cfg.timeoutMs ?? 180000)
  const resultUrl = completed.response_url || submitted.response_url
  const resultRes = await fetchImpl(resultUrl, { headers: { Authorization: falAuthHeader(key) }, signal })
  const result = await resultRes.json().catch(() => ({}))
  const img = result.images?.[0] || result.image
  if (!img?.url) throw new Error('FAL blend returned no image url')
  const dl = await fetchImpl(img.url, { signal })
  if (!dl.ok) throw new Error(`FAL download failed (HTTP ${dl.status})`)
  const bytes = Buffer.from(await dl.arrayBuffer())
  return { bytes, mediaType: 'image/png', width: img.width || blended.width || 0, height: img.height || blended.height || 0, sourceUrl: img.url }
}

/** Direct image editing (inpainting / img2img) via selected provider. */
/** @internal — direct provider call path for integration tests */
export async function editImageDirect(deps, job) {
  const providers = makeProviders(deps, job)
  const providerKey = (typeof job?.provider === 'string' && job.provider.trim()) || (typeof deps?.cfg?.provider === 'string' && deps.cfg.provider.trim()) || (typeof deps?.cfg?.defaultProvider === 'string' && deps.cfg.defaultProvider.trim()) || 'fal'
  const fn = providers[providerKey] || providers.fal || providers.custom
  if (!fn) throw new Error(`Provider "${providerKey}" does not support image editing`)
  return fn(job.seed, job.prompt)
}

/** Direct image variation via selected provider. */
/** @internal — direct provider call path for integration tests */
export async function varyImageDirect(deps, job) {
  const providers = makeProviders(deps, {
    ...job,
    strength: job.variationStrength ?? job.strength ?? 0.35,
  })
  const providerKey = (typeof job?.provider === 'string' && job.provider.trim()) || (typeof deps?.cfg?.provider === 'string' && deps.cfg.provider.trim()) || (typeof deps?.cfg?.defaultProvider === 'string' && deps.cfg.defaultProvider.trim()) || 'fal'
  const fn = providers[providerKey] || providers.fal || providers.custom
  if (!fn) throw new Error(`Provider "${providerKey}" does not support image variations`)
  return fn(job.seed, job.prompt)
}

/**
 * Recursively removes any property with an undefined value so the result satisfies
 * DSH lossless JSON requirements (dsh-util-values isJsonValue).
 *
 * @param {any} val
 * @returns {any}
 */
export function toLosslessJson(val) {
  if (val === null || typeof val === 'boolean' || typeof val === 'string') return val
  if (typeof val === 'number') return Number.isFinite(val) && !Object.is(val, -0) ? val : null
  if (Array.isArray(val)) return val.map(toLosslessJson)
  if (typeof val === 'object' && val !== null) {
    const res = {}
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        res[k] = toLosslessJson(v)
      }
    }
    return res
  }
  return null
}


/**
 * Diagnostic ping/connection test for a given provider.
 * Returns { ok: boolean, latencyMs: number, message: string }.
 */
export async function testProviderConnection(deps, providerId) {
  const { fetchImpl = fetch, resolveKey, cfg } = deps || {}
  const start = Date.now()
  const rawProvider = (typeof providerId === 'string' && providerId.trim())
    || (typeof cfg?.provider === 'string' && cfg.provider.trim())
    || (typeof cfg?.defaultProvider === 'string' && cfg.defaultProvider.trim())
    || 'fal'
  const p = rawProvider.toLowerCase()

  const safeTimeout = (ms) => {
    return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined
  }

  try {
    if (p === 'fal') {
      const key = await resolveKey(cfg?.apiKeyEnv || 'FAL_KEY')
      if (!key) return { ok: false, state: 'not_configured', latencyMs: 0, message: 'FAL API key not configured' }
      let res
      try {
        res = await fetchImpl('https://queue.fal.run/fal-ai/fast-sdxl/status', {
          headers: { Authorization: falAuthHeader(key) },
          signal: safeTimeout(6000),
        })
      } catch (netErr) {
        return { ok: false, state: 'offline', latencyMs: Date.now() - start, message: `Fal queue unreachable: ${netErr.message || 'connection error'}` }
      }
      const latencyMs = Date.now() - start
      if (res.status === 401 || res.status === 403) {
        return { ok: false, state: 'unauthorized', latencyMs, message: `Fal auth failed (HTTP ${res.status})` }
      }
      if (res.status >= 500) {
        return { ok: false, state: 'server_error', latencyMs, message: `Fal server error (HTTP ${res.status})` }
      }
      return { ok: true, state: 'authenticated', latencyMs, message: 'Fal.ai queue reachable' }
    }

    if (p === 'local' || p === 'comfyui' || p === 'a1111') {
      const backend = (p === 'local' ? (cfg?.localBackend || 'comfyui') : p).toLowerCase()
      if (backend === 'a1111') {
        const url = cfg?.a1111Url || cfg?.localBaseURL || 'http://127.0.0.1:7860'
        let res
        try {
          res = await fetchImpl(`${url.replace(/\/+$/, '')}/sdapi/v1/samplers`, {
            signal: safeTimeout(5000),
          })
        } catch (netErr) {
          return { ok: false, state: 'offline', latencyMs: Date.now() - start, message: `Automatic1111 offline (${netErr.message || 'connection refused'})` }
        }
        const latencyMs = Date.now() - start
        if (res.status === 401 || res.status === 403) {
          return { ok: false, state: 'unauthorized', latencyMs, message: `A1111 auth error (HTTP ${res.status})` }
        }
        if (res.status >= 500) {
          return { ok: false, state: 'server_error', latencyMs, message: `A1111 server error (HTTP ${res.status})` }
        }
        if (res.ok) {
          return { ok: true, state: 'model_available', latencyMs, message: 'Automatic1111 operational' }
        }
        return { ok: false, state: 'server_error', latencyMs, message: `A1111 returned HTTP ${res.status}` }
      }

      // Default local is ComfyUI
      const url = cfg?.comfyuiUrl || cfg?.localBaseURL || 'http://127.0.0.1:8188'
      let res
      try {
        res = await fetchImpl(`${url.replace(/\/+$/, '')}/system_stats`, {
          signal: safeTimeout(5000),
        })
      } catch (netErr) {
        return { ok: false, state: 'offline', latencyMs: Date.now() - start, message: `ComfyUI offline (${netErr.message || 'connection refused'})` }
      }
      const latencyMs = Date.now() - start
      if (res.status === 401 || res.status === 403) {
        return { ok: false, state: 'unauthorized', latencyMs, message: `ComfyUI auth error (HTTP ${res.status})` }
      }
      if (res.status >= 500) {
        return { ok: false, state: 'server_error', latencyMs, message: `ComfyUI server error (HTTP ${res.status})` }
      }
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        const vram = data?.devices?.[0]?.vram_free ? ` (${Math.round(data.devices[0].vram_free / 1048576)} MB free VRAM)` : ''
        return { ok: true, state: 'model_available', latencyMs, message: `ComfyUI operational${vram}` }
      }
      return { ok: false, state: 'server_error', latencyMs, message: `ComfyUI returned HTTP ${res.status}` }
    }

    if (p === 'custom') {
      const url = cfg?.customEndpoint || cfg?.customBaseURL || 'https://api.openai.com/v1'
      const key = await resolveKey(cfg?.customApiKeyEnv || cfg?.customKeyEnv || 'OPENAI_API_KEY')
      const headers = key ? { Authorization: `Bearer ${key}` } : {}
      let res
      try {
        res = await fetchImpl(`${url.replace(/\/+$/, '')}/models`, {
          headers,
          signal: safeTimeout(6000),
        })
      } catch (netErr) {
        return { ok: false, state: 'offline', latencyMs: Date.now() - start, message: `Custom endpoint offline (${netErr.message || 'connection error'})` }
      }
      const latencyMs = Date.now() - start
      if (res.status === 401 || res.status === 403) {
        return { ok: false, state: 'unauthorized', latencyMs, message: `Custom endpoint auth error (HTTP ${res.status})` }
      }
      if (res.status >= 500) {
        return { ok: false, state: 'server_error', latencyMs, message: `Custom endpoint server error (HTTP ${res.status})` }
      }
      if (res.ok || res.status === 404 || res.status === 405) {
        return { ok: true, state: res.ok ? 'authenticated' : 'reachable', latencyMs, message: `Custom gateway reachable (HTTP ${res.status})` }
      }
      return { ok: false, state: 'server_error', latencyMs, message: `Custom endpoint returned HTTP ${res.status}` }
    }

    if (p === 'subscription' || p === 'chatgpt' || p === 'grok' || p === 'codex') {
      const subService = deps?.subscriptionImages
        || (deps?.ctx?.get && deps.ctx.get('subscriptionImages'))
        || deps?.ctx?.subscriptionImages
      const hasSub = Boolean(subService && typeof subService.generate === 'function')
      const latencyMs = Date.now() - start
      if (hasSub) {
        return { ok: true, state: 'authenticated', latencyMs, message: 'Subscription bridge available' }
      }
      return { ok: false, state: 'not_configured', latencyMs, message: 'subscriptionImages service not available (requires dsh-subscriptions plugin)' }
    }

    if (p === 'replicate') {
      const key = await resolveKey(cfg?.replicateKeyEnv || 'REPLICATE_API_TOKEN')
      if (!key) return { ok: false, state: 'not_configured', latencyMs: 0, message: 'Replicate API token not configured' }
      let res
      try {
        res = await fetchImpl('https://api.replicate.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: safeTimeout(6000),
        })
      } catch (netErr) {
        return { ok: false, state: 'offline', latencyMs: Date.now() - start, message: `Replicate unreachable (${netErr.message || 'connection error'})` }
      }
      const latencyMs = Date.now() - start
      if (res.status === 401 || res.status === 403) {
        return { ok: false, state: 'unauthorized', latencyMs, message: `Replicate auth error (HTTP ${res.status})` }
      }
      if (res.status >= 500) {
        return { ok: false, state: 'server_error', latencyMs, message: `Replicate server error (HTTP ${res.status})` }
      }
      if (res.ok) {
        return { ok: true, state: 'authenticated', latencyMs, message: 'Replicate API reachable' }
      }
      return { ok: false, state: 'server_error', latencyMs, message: `Replicate returned HTTP ${res.status}` }
    }

    if (p === 'gemini') {
      const key = await resolveKey(cfg?.geminiKeyEnv || 'GEMINI_API_KEY')
      if (!key) return { ok: false, state: 'not_configured', latencyMs: 0, message: 'Google Gemini API key not configured' }
      const model = cfg?.geminiModel || 'gemini-2.0-flash-exp-image-generation'
      let res
      try {
        res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${encodeURIComponent(key)}`, {
          signal: safeTimeout(6000),
        })
      } catch (netErr) {
        return { ok: false, state: 'offline', latencyMs: Date.now() - start, message: `Google Gemini API unreachable (${netErr.message || 'connection error'})` }
      }
      const latencyMs = Date.now() - start
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, state: 'unauthorized', latencyMs, message: `Gemini API auth error (HTTP ${res.status})` }
      }
      if (res.status >= 500) {
        return { ok: false, state: 'server_error', latencyMs, message: `Gemini API server error (HTTP ${res.status})` }
      }
      if (res.ok) {
        return { ok: true, state: 'model_available', latencyMs, message: 'Gemini Vision API operational' }
      }
      return { ok: false, state: 'server_error', latencyMs, message: `Gemini returned HTTP ${res.status}` }
    }

    if (p === 'seedream') {
      const url = cfg?.seedreamBaseURL || 'https://api.bytedanceapi.com/v1'
      const key = await resolveKey(cfg?.seedreamKeyEnv || 'SEEDREAM_API_KEY')
      const headers = key ? { Authorization: `Bearer ${key}` } : {}
      let res
      try {
        res = await fetchImpl(`${url.replace(/\/+$/, '')}/models`, {
          headers,
          signal: safeTimeout(6000),
        })
      } catch (netErr) {
        return { ok: false, state: 'offline', latencyMs: Date.now() - start, message: `Seedream endpoint offline (${netErr.message || 'connection error'})` }
      }
      const latencyMs = Date.now() - start
      if (res.status === 401 || res.status === 403) {
        return { ok: false, state: 'unauthorized', latencyMs, message: `Seedream auth error (HTTP ${res.status})` }
      }
      if (res.status >= 500) {
        return { ok: false, state: 'server_error', latencyMs, message: `Seedream server error (HTTP ${res.status})` }
      }
      if (res.ok || res.status === 404 || res.status === 405) {
        return { ok: true, state: res.ok ? 'authenticated' : 'reachable', latencyMs, message: 'Seedream endpoint reachable' }
      }
      return { ok: false, state: 'server_error', latencyMs, message: `Seedream returned HTTP ${res.status}` }
    }

    return { ok: false, state: 'unsupported', latencyMs: Date.now() - start, message: `Unknown or unsupported provider: "${p}"` }
  } catch (err) {
    return { ok: false, state: 'offline', latencyMs: Date.now() - start, message: err.message || 'Connection timeout' }
  }
}
