// lib/provider-utils.js
// Shared provider utilities and size/format constants extracted from providers.js (#239)

export function resolveApiKeyCandidates(ref) {
  if (!ref) return []
  const candidates = [ref]
  if (ref === 'FAL_API_KEY') candidates.push('FAL_KEY')
  else if (ref === 'FAL_KEY') candidates.push('FAL_API_KEY')
  return candidates
}


export const PROVIDER_MAX_COUNTS = {
  fal: 4,
  replicate: 4,
  custom: 10,
  seedream: 10,
  gemini: 4,
  codex: 1,
  grok: 1,
  local: 4,
}

export function normalizeCount(count, max = 4) {
  const n = Math.floor(Number(count))
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(max, n))
}

/** @internal — test helper for validating provider count limits */
export function clampProviderCount(provider, count) {
  const max = PROVIDER_MAX_COUNTS[provider] || 4
  return normalizeCount(count, max)
}

export function buildEndpointUrl(baseURL, pathSuffix) {
  const base = String(baseURL || '').trim().replace(/\/+$/, '')
  const suffix = String(pathSuffix || '').trim().replace(/^\/+/, '')
  return `${base}/${suffix}`
}

/** @internal — test helper for abort signal simulation */
export function createAbortError(message = 'Image generation cancelled') {
  const err = new Error(message)
  err.name = 'AbortError'
  return err
}


/** Fast Laplacian-like sharpness and entropy estimator across image scanlines. */
export function estimateSharpnessAndVariance(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || [])
  if (!buf || buf.length < 64) {
    return { score: 0, passed: false, isBlank: true, reason: 'Empty or corrupt image buffer' }
  }
  let diffSum = 0
  const sampleStep = Math.max(1, Math.floor(buf.length / 4096))
  let count = 0
  for (let i = 8; i < buf.length - sampleStep; i += sampleStep) {
    const v = buf[i]
    const nextV = buf[i + sampleStep]
    diffSum += Math.abs(v - nextV)
    count++
  }
  const avgDiff = count > 0 ? diffSum / count : 0
  if (avgDiff < 2) {
    return { score: 0.1, passed: false, isBlank: true, reason: 'Image appears blank or solid monochrome' }
  }
  const score = Math.min(0.98, Math.max(0.3, +(0.5 + (avgDiff / 255) * 0.5).toFixed(2)))
  return { score, passed: score >= 0.5, isBlank: false, avgDiff: +avgDiff.toFixed(2) }
}

/** Adaptive color palette quantizer for SVG vectorization. */
export function quantizePalette(colorMode = 'color', paletteSize = 16) {
  if (colorMode === 'binary') return ['#000000', '#ffffff']
  if (colorMode === 'grayscale') return ['#000000', '#444444', '#888888', '#cccccc', '#ffffff']
  // Standard vibrant UI vector palette
  return [
    '#000000', '#ffffff', '#e11d48', '#2563eb',
    '#16a34a', '#ca8a04', '#9333ea', '#0891b2',
    '#475569', '#64748b', '#94a3b8', '#cbd5e1'
  ].slice(0, Math.max(2, paletteSize))
}


/** Format parameters in standard Automatic1111 / ComfyUI text format for drag-and-drop support. */
export function formatA1111Parameters(metadata = {}) {
  if (typeof metadata === 'string') return metadata
  const prompt = metadata.prompt || ''
  const neg = metadata.negative_prompt || metadata.negativePrompt || ''
  const seed = metadata.seed ?? ''
  const size = metadata.size || (metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : '1024x1024')
  const model = metadata.model || metadata.provider || ''
  const steps = metadata.steps || 20
  const cfg = metadata.cfg_scale || metadata.guidance_scale || 7

  let out = prompt
  if (neg) out += `\nNegative prompt: ${neg}`
  out += `\nSteps: ${steps}, Sampler: Euler, CFG scale: ${cfg}, Seed: ${seed}, Size: ${size}, Model: ${model}`
  return out
}


import { createHash } from 'node:crypto'

/** Deterministic sha256 hash for image generation caching. */
export function computeGenerationHash({ provider, model, prompt, seed, size, style }) {
  const norm = [
    String(provider || '').trim().toLowerCase(),
    String(model || '').trim().toLowerCase(),
    String(prompt || '').trim(),
    String(seed ?? ''),
    String(size || '').trim().toLowerCase(),
    String(style || '').trim().toLowerCase(),
  ].join('|')
  return createHash('sha256').update(norm).digest('hex')
}

// Image generation provider implementations.
//
// A provider receives a generation job and returns finished image bytes. Everything
// that follows (attachments, workspace files, links, card rendering) is shared
// across all providers and lives in index.js.
//
// Network is injected via fetchImpl and keys via resolveKey, enabling fully isolated unit tests.

export const PROVIDER_KEYS = ['fal', 'custom', 'codex', 'grok', 'local', 'seedream', 'gemini', 'replicate']

/** Clamp count from tool arguments to range 1..4. */
/** Provider fallback ordering: primary provider first, followed by PROVIDER_KEYS. */
export function fallbackOrder(primary) {
  return [primary, ...PROVIDER_KEYS.filter((k) => k !== primary)]
}

/**
 * Iterates through candidate generators, returning the first successful result.
 * Throws an aggregate error if all candidates fail.
 * @param generators - array of (key, seed) => Promise<generated> functions.
 * @param order - candidate key evaluation order.
 */

/** Calculate exponential backoff delay with jitter. */
export function calculateBackoff(attempt, baseInterval = 500, maxInterval = 5000, jitterFactor = 0.2) {
  const exp = Math.min(maxInterval, baseInterval * Math.pow(1.3, attempt))
  const jitter = exp * jitterFactor * (Math.random() * 2 - 1)
  return Math.max(100, Math.floor(exp + jitter))
}

/** Check if an error is a fatal client error that should NOT be cascaded to other providers. */
export function isFatalClientError(error) {
  const msg = (error?.message || String(error || '')).toLowerCase()
  return (
    msg.includes('content policy') ||
    msg.includes('safety system') ||
    msg.includes('nsfw') ||
    msg.includes('moderation') ||
    msg.includes('bad request (http 400') ||
    msg.includes('invalid_prompt') ||
    msg.includes('prompt is required') ||
    msg.includes('unsupported image format') ||
    msg.includes('402 payment required') ||
    msg.includes('insufficient_quota') ||
    msg.includes('insufficient credits') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('balance is insufficient')
  )
}

/**
 * Safely extract a human-readable message from any error, object, or response.
 * Completely eliminates "[object Object]" and prevents duplicate provider prefixes (e.g. "codex: codex: ...").
 */
export function formatErrorMessage(e, providerKey = '') {
  if (e === null || e === undefined) {
    return providerKey ? `${providerKey}: unknown error` : 'unknown error'
  }

  let msg = ''
  if (typeof e === 'string') {
    msg = e
  } else if (typeof e === 'object') {
    if (typeof e.message === 'string' && e.message && e.message !== '[object Object]') {
      msg = e.message
    } else if (typeof e.detail === 'string' && e.detail) {
      msg = e.detail
    } else if (e.error) {
      if (typeof e.error === 'string') msg = e.error
      else if (typeof e.error.message === 'string') msg = e.error.message
      else if (typeof e.error.detail === 'string') msg = e.error.detail
      else {
        try { msg = JSON.stringify(e.error) } catch { msg = String(e.error) }
      }
    } else if (typeof e.statusText === 'string' && e.statusText) {
      msg = `HTTP ${e.status || ''} ${e.statusText}`.trim()
    } else if (typeof e.cause === 'string') {
      msg = e.cause
    } else if (e.cause && typeof e.cause.message === 'string') {
      msg = e.cause.message
    }

    if (!msg || msg === '[object Object]') {
      try {
        const json = JSON.stringify(e)
        if (json && json !== '{}') {
          msg = json.slice(0, 500)
        }
      } catch { /* response body not JSON; use raw text */ }
    }

    if (!msg || msg === '[object Object]') {
      const keys = Object.getOwnPropertyNames(e)
      if (keys.length) {
        msg = `error [${keys.join(', ')}]`
      } else {
        msg = String(e)
      }
    }
  } else {
    msg = String(e)
  }

  msg = String(msg || 'unknown error').trim()

  if (providerKey) {
    const prefixRegex = new RegExp(`^${providerKey}\\s*:\\s*`, 'i')
    while (prefixRegex.test(msg)) {
      msg = msg.replace(prefixRegex, '').trim()
    }
  }

  if (!msg || msg === '[object Object]') {
    msg = 'unknown error object'
  } else if (msg.includes('[object Object]')) {
    msg = msg.replace(/\[object Object\]/g, 'unknown error object').trim()
  }

  if (providerKey) {
    return `${providerKey}: ${msg}`
  }

  return msg
}

export function resolveSubscriptionSize(size, aspectPixels, aspectRatio) {
  if (size && SUBSCRIPTION_SIZES[size]) {
    return SUBSCRIPTION_SIZES[size]
  }
  const ratio = String(aspectRatio || '').trim()
  if (ratio === '16:9' || ratio === '3:2' || ratio === '4:3') {
    return '1536x1024'
  }
  if (ratio === '9:16' || ratio === '2:3' || ratio === '3:4') {
    return '1024x1536'
  }
  if (ratio === '1:1') {
    return '1024x1024'
  }
  if (Array.isArray(aspectPixels) && aspectPixels.length === 2) {
    const [w, h] = aspectPixels
    if (w > h) return '1536x1024'
    if (h > w) return '1024x1536'
    return '1024x1024'
  }
  return '1024x1024'
}

export const SUBSCRIPTION_SIZES = {
  square_hd: '1024x1024',
  square: '1024x1024',
  portrait_4_3: '1024x1536',
  portrait_16_9: '1024x1536',
  landscape_4_3: '1536x1024',
  landscape_16_9: '1536x1024',
}

/** Image sizes accepted by fal-ai/flux-2/klein (and most FAL flux models). */
export const IMAGE_SIZES = [
  'square_hd',
  'square',
  'portrait_4_3',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_16_9',
]

/** Output formats accepted by the model. */
export const OUTPUT_FORMATS = ['png', 'jpeg', 'webp']

// Named sizes are a unified abstraction across all providers.
// FAL accepts named identifiers; OpenAI-compatible gateways require WxH resolution.
export const SIZE_PIXELS = {
  square_hd: '1024x1024',
  square: '512x512',
  portrait_4_3: '768x1024',
  portrait_16_9: '576x1024',
  landscape_4_3: '1024x768',
  landscape_16_9: '1024x576',
}

/** Normalize a raw key into a FAL `Authorization: Key <key>` value. */
