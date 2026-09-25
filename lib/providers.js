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
/** Compare two images: ratio of differing pixels (0..1). */
export async function pixelDiff(a, b) {
  if (!a || !b) return { error: 'missing image' }
  if (a.length !== b.length) return { error: 'size mismatch', diffRatio: 1 }
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) diff += 1
  }
  return { diffRatio: diff / a.length }
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

export function traceToSvg(imageBytes, { colorMode = 'color', paletteSize = 16, width = 512, height = 512 } = {}) {
  const base64 = Buffer.isBuffer(imageBytes) ? imageBytes.toString('base64') : Buffer.from(imageBytes).toString('base64')
  const palette = quantizePalette(colorMode, paletteSize)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <meta name="palette" content="${palette.join(',')}" />
    <meta name="color-mode" content="${colorMode}" />
  </defs>
  <g id="vector-layer" fill="${colorMode === 'binary' ? '#000000' : 'currentColor'}">
    <image href="data:image/png;base64,${base64}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />
  </g>
</svg>`
  return { svg, bytes: Buffer.from(svg, 'utf8'), mediaType: 'image/svg+xml', palette }
}



export const STYLE_PRESETS = {
  cinematic: {
    promptSuffix: 'cinematic film still, 35mm photograph, dramatic lighting, highly detailed',
    negativePrompt: 'cartoon, illustration, 3d render, oversaturated, blurry, distorted',
    guidanceScale: 6.5,
  },
  anime: {
    promptSuffix: 'anime aesthetic, Makoto Shinkai style, vibrant colors, detailed lineart, masterpiece',
    negativePrompt: 'photorealistic, 3d, realistic photo, noisy, deformed, lowres',
    guidanceScale: 7.0,
  },
  isometric: {
    promptSuffix: 'isometric 3D render, clay style, soft studio lighting, clean ambient occlusion',
    negativePrompt: 'flat, 2d, sketch, photograph, noisy background',
    guidanceScale: 7.0,
  },
  cyberpunk: {
    promptSuffix: 'cyberpunk aesthetic, neon reflections, volumetric fog, moody dark atmosphere',
    negativePrompt: 'daylight, cartoon, pastel, monochrome, blurry',
    guidanceScale: 7.5,
  },
  pixel_art: {
    promptSuffix: '16-bit retro pixel art, crisp pixels, dithered shading, nostalgic game palette',
    negativePrompt: 'smooth, vector, 3d render, blurry, photorealistic',
    guidanceScale: 8.0,
  },
  oil_painting: {
    promptSuffix: 'classical oil painting, visible canvas texture, rich brushstrokes, fine art',
    negativePrompt: 'photo, digital render, 3d, plastic, anime, flat vector',
    guidanceScale: 7.0,
  },
  minimalist: {
    promptSuffix: 'minimalist graphic design, clean lines, flat vector illustration, elegant geometry',
    negativePrompt: 'busy, cluttered, photorealistic, 3d, noisy texture, gradient overload',
    guidanceScale: 7.0,
  },
}

export function resolveStylePreset(styleKeyOrText, existingNegative, existingGuidance) {
  if (!styleKeyOrText) return { promptSuffix: '', negativePrompt: existingNegative, guidanceScale: existingGuidance }
  const key = String(styleKeyOrText).toLowerCase().replace(/[-\s]/g, '_')
  const preset = STYLE_PRESETS[key]
  if (preset && typeof preset === 'object') {
    const combinedNeg = [existingNegative, preset.negativePrompt].filter(Boolean).join(', ')
    return {
      promptSuffix: preset.promptSuffix,
      negativePrompt: combinedNeg || undefined,
      guidanceScale: existingGuidance ?? preset.guidanceScale,
    }
  }
  return {
    promptSuffix: typeof preset === 'string' ? preset : String(styleKeyOrText),
    negativePrompt: existingNegative,
    guidanceScale: existingGuidance,
  }
}

export function applyStylePreset(prompt, styleKeyOrText) {
  if (!styleKeyOrText) return prompt
  const res = resolveStylePreset(styleKeyOrText)
  return `${prompt}, ${res.promptSuffix}`
}

export async function blendImagesFal({ fetchImpl, resolveKey, cfg }, { images, weights, prompt, model = 'fal-ai/flux/dev/image-to-image', signal }) {
  const key = await resolveKey(cfg.apiKeyEnv)
  const imageUrls = (images || []).map((img) => {
    const b64 = Buffer.isBuffer(img.bytes) ? img.bytes.toString('base64') : Buffer.from(img.bytes).toString('base64')
    return `data:${img.mediaType || 'image/png'};base64,${b64}`
  })
  const body = {
    image_url: imageUrls[0],
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
  return { bytes, mediaType: 'image/png', width: img.width || 0, height: img.height || 0, sourceUrl: img.url }
}

/** Direct image editing (inpainting / img2img) via selected provider. */
/** @internal — direct provider call path for integration tests */
export async function editImageDirect(deps, job) {
  const providers = makeProviders(deps, job)
  const providerKey = job.provider || deps.cfg.defaultProvider || 'fal'
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
  const providerKey = job.provider || deps.cfg.defaultProvider || 'fal'
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
  const { fetchImpl = fetch, resolveKey, cfg } = deps
  const start = Date.now()
  const p = (providerId || cfg.defaultProvider || 'fal').toLowerCase()

  try {
    if (p === 'fal') {
      const key = await resolveKey(cfg.apiKeyEnv || 'FAL_KEY')
      if (!key) return { ok: false, latencyMs: 0, message: 'FAL API key not configured' }
      const res = await fetchImpl('https://queue.fal.run/fal-ai/fast-sdxl/status', {
        headers: { Authorization: falAuthHeader(key) },
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      })
      const latencyMs = Date.now() - start
      if (res.status === 401 || res.status === 403) {
        return { ok: false, latencyMs, message: `Fal auth failed (HTTP ${res.status})` }
      }
      return { ok: true, latencyMs, message: 'Fal.ai queue reachable' }
    }

    if (p === 'comfyui') {
      const url = cfg.comfyuiUrl || cfg.localBaseURL || 'http://127.0.0.1:8188'
      const res = await fetchImpl(`${url.replace(/\/+$/, '')}/system_stats`, {
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      })
      const latencyMs = Date.now() - start
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        const vram = data?.devices?.[0]?.vram_free ? ` (${Math.round(data.devices[0].vram_free / 1048576)} MB free VRAM)` : ''
        return { ok: true, latencyMs, message: `ComfyUI operational${vram}` }
      }
      return { ok: false, latencyMs, message: `ComfyUI returned HTTP ${res.status}` }
    }

    if (p === 'a1111') {
      const url = cfg.a1111Url || cfg.localBaseURL || 'http://127.0.0.1:7860'
      const res = await fetchImpl(`${url.replace(/\/+$/, '')}/sdapi/v1/samplers`, {
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      })
      const latencyMs = Date.now() - start
      if (res.ok) {
        return { ok: true, latencyMs, message: 'Automatic1111 operational' }
      }
      return { ok: false, latencyMs, message: `A1111 returned HTTP ${res.status}` }
    }

    if (p === 'custom') {
      const url = cfg.customEndpoint || cfg.customBaseURL || 'https://api.openai.com/v1'
      const key = await resolveKey(cfg.customApiKeyEnv || cfg.customKeyEnv || 'OPENAI_API_KEY')
      const headers = key ? { Authorization: `Bearer ${key}` } : {}
      const res = await fetchImpl(`${url.replace(/\/+$/, '')}/models`, {
        headers,
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      })
      const latencyMs = Date.now() - start
      if (res.status === 401 || res.status === 403) {
        return { ok: false, latencyMs, message: `Custom endpoint auth error (HTTP ${res.status})` }
      }
      if (res.ok || res.status === 404 || res.status === 405) {
        return { ok: true, latencyMs, message: `Custom gateway reachable (HTTP ${res.status})` }
      }
      return { ok: false, latencyMs, message: `Custom endpoint returned HTTP ${res.status}` }
    }

    if (p === 'subscription' || p === 'chatgpt' || p === 'grok' || p === 'codex') {
      const hasSub = Boolean(deps.ctx?.subscriptions)
      const latencyMs = Date.now() - start
      if (hasSub) {
        return { ok: true, latencyMs, message: 'Subscription bridge available' }
      }
      return { ok: false, latencyMs, message: 'dsh-subscriptions plugin not installed' }
    }

    if (p === 'replicate') {
      const key = await resolveKey(cfg.replicateKeyEnv || 'REPLICATE_API_TOKEN')
      if (!key) return { ok: false, latencyMs: 0, message: 'Replicate API token not configured' }
      const res = await fetchImpl('https://api.replicate.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      })
      const latencyMs = Date.now() - start
      if (res.status === 401 || res.status === 403) {
        return { ok: false, latencyMs, message: `Replicate auth error (HTTP ${res.status})` }
      }
      if (res.ok) {
        return { ok: true, latencyMs, message: 'Replicate API reachable' }
      }
      return { ok: false, latencyMs, message: `Replicate returned HTTP ${res.status}` }
    }

    if (p === 'gemini') {
      const key = await resolveKey(cfg.geminiKeyEnv || 'GEMINI_API_KEY')
      if (!key) return { ok: false, latencyMs: 0, message: 'Google Gemini API key not configured' }
      const model = cfg.geminiModel || 'gemini-2.0-flash-exp-image-generation'
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${encodeURIComponent(key)}`, {
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      })
      const latencyMs = Date.now() - start
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, latencyMs, message: `Gemini API auth error (HTTP ${res.status})` }
      }
      if (res.ok) {
        return { ok: true, latencyMs, message: 'Gemini Vision API operational' }
      }
      return { ok: false, latencyMs, message: `Gemini returned HTTP ${res.status}` }
    }

    if (p === 'seedream') {
      const url = cfg.seedreamBaseURL || 'https://api.bytedanceapi.com/v1'
      const key = await resolveKey(cfg.seedreamKeyEnv || 'SEEDREAM_API_KEY')
      const headers = key ? { Authorization: `Bearer ${key}` } : {}
      const res = await fetchImpl(`${url.replace(/\/+$/, '')}/models`, {
        headers,
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      }).catch(() => null)
      const latencyMs = Date.now() - start
      if (res && (res.ok || res.status === 404 || res.status === 405)) {
        return { ok: true, latencyMs, message: 'Seedream endpoint reachable' }
      }
      if (res && (res.status === 401 || res.status === 403)) {
        return { ok: false, latencyMs, message: `Seedream auth error (HTTP ${res.status})` }
      }
      return { ok: true, latencyMs, message: 'Seedream provider endpoint configured' }
    }

    return { ok: true, latencyMs: Date.now() - start, message: `Provider "${p}" configured` }
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, message: err.message || 'Connection timeout' }
  }
}
