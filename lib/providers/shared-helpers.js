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

export function normalizeMediaType(contentType, fallbackFormat) {
  const raw = String(contentType ?? '').toLowerCase()
  if (raw.includes('jpeg') || raw.includes('jpg')) return 'image/jpeg'
  if (raw.includes('webp')) return 'image/webp'
  if (raw.includes('png')) return 'image/png'
  if (fallbackFormat === 'jpeg') return 'image/jpeg'
  if (fallbackFormat === 'webp') return 'image/webp'
  return 'image/png'
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

export async function pollStatus(fetchImpl, statusUrl, key, signal, pollIntervalMs = 500, timeoutMs = 180000) {
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
    if (status === 'COMPLETED') return data
    if (status === 'ERROR' || data.error || data.detail) {
      throw new Error(`FAL generation failed: ${JSON.stringify(data).slice(0, 600)}`)
    }
    if (status !== 'IN_QUEUE' && status !== 'IN_PROGRESS') {
      throw new Error(`Unexpected FAL status "${status}": ${JSON.stringify(data).slice(0, 300)}`)
    }
  }
}

export function buildEditForm({ source, mask, prompt, size, strength }) {
  const form = new FormData()
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

