import sharp from 'sharp'
/**
 * Shared provider HTTP/auth helpers used by per-backend factories.
 * Extracted from providers.js for #218 modularization.
 */
import {
  SIZE_PIXELS,
  formatErrorMessage,
  buildEndpointUrl,
  resolveSubscriptionSize,
  calculateBackoff,
} from '../provider-utils.js'

export {
  SIZE_PIXELS,
  formatErrorMessage,
  buildEndpointUrl,
  resolveSubscriptionSize,
  calculateBackoff,
}
export function falAuthHeader(key) {
  const trimmed = String(key ?? '').trim()
  if (!trimmed) return ''
  return trimmed.startsWith('Key ') || trimmed.startsWith('key ')
    ? trimmed
    : `Key ${trimmed}`
}

export function detectImageMediaType(buf) {
  if (!buf || (!Buffer.isBuffer(buf) && !(buf instanceof Uint8Array))) return undefined
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  if (b.length < 4) return undefined
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return 'image/webp'
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b.length > 5) {
    const head = b.subarray(0, Math.min(256, b.length)).toString('utf8').trimStart()
    if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
      return 'image/svg+xml'
    }
  }
  return undefined
}

export function normalizeMediaType(contentType, fallbackFormat, bytes) {
  if (bytes) {
    const detected = detectImageMediaType(bytes)
    if (detected) return detected
  }
  const raw = String(contentType ?? '').toLowerCase()
  if (raw.includes('jpeg') || raw.includes('jpg')) return 'image/jpeg'
  if (raw.includes('webp')) return 'image/webp'
  if (raw.includes('png')) return 'image/png'
  if (fallbackFormat === 'jpeg' || fallbackFormat === 'jpg') return 'image/jpeg'
  if (fallbackFormat === 'webp') return 'image/webp'
  if (fallbackFormat === 'png') return 'image/png'
  return 'image/png'
}

/**
 * Ensures image bytes match the requested target format ('png', 'jpeg', 'webp').
 * If bytes already match target format, returns them with truthful mediaType.
 * If bytes differ (e.g. provider returned PNG for a webp request), transcodes via Sharp (#386).
 */
export async function ensureImageFormat(bytes, targetFormat, { fallbackMime } = {}) {
  if (!bytes) return { bytes: Buffer.alloc(0), mediaType: fallbackMime || 'image/png' }
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  const actualMime = detectImageMediaType(buf)
  if (!targetFormat && !fallbackMime) return { bytes: buf, mediaType: actualMime || 'image/png' }

  const rawFormat = String(targetFormat || '').trim().toLowerCase()
  const canonical = rawFormat === 'jpg' ? 'jpeg' : rawFormat

  if (canonical && !['png', 'jpeg', 'webp'].includes(canonical)) {
    throw new Error(`Unsupported output format "${targetFormat}". Supported formats: png, jpeg, webp`)
  }

  const targetMime = canonical ? `image/${canonical}` : fallbackMime
  if (actualMime === targetMime) {
    return { bytes: buf, mediaType: targetMime }
  }

  try {
    if (!canonical) return { bytes: buf, mediaType: fallbackMime || actualMime || 'image/png' }
    const transcoded = await sharp(buf).toFormat(canonical).toBuffer()
    const verified = detectImageMediaType(transcoded) || targetMime
    return { bytes: transcoded, mediaType: verified }
  } catch (err) {
    if (buf.length < 64) {
      return { bytes: buf, mediaType: fallbackMime || targetMime || actualMime || 'image/png' }
    }
    throw new Error(`Failed to encode image to ${canonical}: ${err.message}`)
  }
}

export async function submitJob(fetchImpl, baseURL, model, key, body, signal) {
  const res = await fetchImpl(`${baseURL}/${model}`, {
    method: 'POST',
    headers: {
      Authorization: falAuthHeader(key),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.request_id) {
    const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data).slice(0, 600)
    throw new Error(`FAL submit failed (HTTP ${res.status}): ${detail}`)
  }
  return data
}

export async function pollStatus(fetchImpl, statusUrl, key, signal, pollIntervalMs = 500, timeoutMs = 180000, onProgress) {
  const deadline = Date.now() + timeoutMs
  let attempt = 0
  for (;;) {
    if (signal?.aborted) throw new Error('FAL generation cancelled')
    if (Date.now() > deadline) throw new Error(`FAL generation timed out after ${timeoutMs} ms`)
    if (attempt > 0) {
      const delay = calculateBackoff(attempt - 1, pollIntervalMs, 5000)
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, delay)
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
        }
      })
    }
    attempt++
    if (signal?.aborted) throw new Error('FAL generation cancelled')
    const res = await fetchImpl(statusUrl, { headers: { Authorization: falAuthHeader(key) }, signal })
    const data = await res.json().catch(() => ({}))
    const status = data.status
    if (typeof onProgress === 'function') {
      if (status === 'IN_QUEUE') {
        const pos = data.queue_position
        onProgress({
          stage: pos !== undefined ? `In queue (#${pos})` : 'In queue',
          progress: undefined, // honest status: do NOT simulate fake percentage
        })
      } else if (status === 'IN_PROGRESS') {
        const rawProg = typeof data.progress === 'number' ? Math.round(data.progress * 100) : undefined
        onProgress({
          stage: 'Generating...',
          progress: rawProg,
        })
      }
    }
    if (status === 'COMPLETED') return data
    if (status === 'ERROR' || data.error || data.detail) {
      throw new Error(`FAL generation failed: ${JSON.stringify(data).slice(0, 600)}`)
    }
    if (status !== 'IN_QUEUE' && status !== 'IN_PROGRESS') {
      throw new Error(`Unexpected FAL status "${status}": ${JSON.stringify(data).slice(0, 300)}`)
    }
  }
}

/**
 * Normalizes mask bytes for OpenAI/Custom inpainting where transparent alpha (0) indicates edit region.
 * If the incoming mask has an alpha channel with transparent areas, it is preserved.
 * If the incoming mask is opaque black & white (e.g. from Canvas), white pixels are converted to transparent (alpha 0)
 * and black pixels to opaque (alpha 255).
 *
 * @param {Buffer|Uint8Array} maskBytes
 * @returns {Promise<Buffer>}
 */
export async function normalizeMaskAlpha(maskBytes) {
  if (!maskBytes || maskBytes.length === 0) return maskBytes
  try {
    const img = sharp(maskBytes)
    const { data, info } = await img.raw().ensureAlpha().toBuffer({ resolveWithObject: true })
    const { width, height, channels } = info

    let hasTransparency = false
    for (let i = 3; i < data.length; i += channels) {
      if (data[i] < 250) {
        hasTransparency = true
        break
      }
    }

    if (hasTransparency) {
      return await sharp(data, { raw: { width, height, channels } }).png().toBuffer()
    }

    const out = Buffer.from(data)
    for (let i = 0; i < out.length; i += channels) {
      const r = out[i]
      const g = out[i + 1]
      const b = out[i + 2]
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      if (lum > 128) {
        out[i + 3] = 0
      } else {
        out[i + 3] = 255
      }
    }

    return await sharp(out, { raw: { width, height, channels } }).png().toBuffer()
  } catch (_) {
    return maskBytes
  }
}

export function buildEditForm({ source, mask, prompt, size, strength, model }) {
  const form = new FormData()
  if (model) form.append('model', model)
  form.append('image', new Blob([source.bytes], { type: source.mediaType || 'image/png' }), 'source.png')
  if (mask) form.append('mask', new Blob([mask.bytes], { type: mask.mediaType || 'image/png' }), 'mask.png')
  form.append('prompt', prompt)
  if (size) form.append('size', size)
  if (strength !== undefined) form.append('strength', String(strength))
  return form
}

export function estimateCost(provider, model, { count = 1 } = {}) {
  const p = String(provider).toLowerCase()
  if (p === 'fal') {
    if (String(model).includes('schnell') || String(model).includes('klein')) return 0.003 * count
    if (String(model).includes('dev')) return 0.025 * count
    if (String(model).includes('clarity') || String(model).includes('upscale')) return 0.01 * count
    return 0.005 * count
  }
  if (p === 'replicate') return 0.003 * count
  if (p === 'seedream') return 0.004 * count
  if (p === 'gemini') return 0.03 * count
  if (p === 'codex' || p === 'grok' || p === 'local') return 0.0
  return 0.01 * count
}


export function snapToMultipleOf64(dim, minVal = 256, maxVal = 2048) {
  const n = Math.round(Number(dim) / 64) * 64
  return Math.max(minVal, Math.min(maxVal, n))
}

export function snapDimensions(width, height) {
  return [snapToMultipleOf64(width), snapToMultipleOf64(height)]
}

export function extractComfyNodeErrors(entry) {
  if (!entry || typeof entry !== 'object') return ''
  const status = entry.status
  if (status && status.status_str === 'error') {
    const msgs = status.messages || []
    const errList = []
    for (const m of msgs) {
      if (Array.isArray(m) && m[0] === 'execution_error') {
        const d = m[1] || {}
        errList.push(`node ${d.node_id || 'unknown'} (${d.node_type || ''}): ${d.exception_message || d.exception_type || 'execution failed'}`)
      }
    }
    if (errList.length) return errList.join('; ')
    return status.status_str || 'execution error'
  }
  return ''
}

export function pxSize(aspectPixels, size) {
  if (aspectPixels) return snapDimensions(aspectPixels[0], aspectPixels[1])
  const [w, h] = sizeToPixels(size)
  return snapDimensions(w, h)
}

export const ASPECT_RATIOS = {
  '1:1': [1024, 1024],
  '16:9': [1344, 768],
  '9:16': [768, 1344],
  '4:3': [1152, 896],
  '3:4': [896, 1152],
  '3:2': [1152, 768],
  '2:3': [768, 1152],
}

export function sizeToPixels(size) {
  const px = SIZE_PIXELS[size]
  if (!px) return [1024, 1024]
  const [w, h] = px.split('x').map(Number)
  return [w, h]
}

