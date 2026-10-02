import {
  normalizeMediaType,
  buildEditForm,
  normalizeMaskAlpha,
  SIZE_PIXELS,
  formatErrorMessage,
  buildEndpointUrl,
  ensureImageFormat,
} from '../shared-helpers.js'

/**
 * @param {fetchImpl: Function, resolveKey: Function, cfg: object} deps
 * @param {prompt?: string, size?: string, format?: string, seed?: number, signal?: AbortSignal,
 *   negativePrompt?: string, guidanceScale?: number, source?: object, mask?: object, strength?: number,
 *   quality?: string, style?: string, aspectPixels?: number[], aspectRatio?: string} job
 */
export function createCustomGenerator(deps, job) {
  const { fetchImpl, resolveKey, cfg } = deps
  const { prompt, size, format, seed, signal, negativePrompt, guidanceScale, source, mask, strength, quality, style, aspectPixels, aspectRatio } = job

  async function custom(seedArg = seed, promptArg = prompt) {
    const base = String(cfg.customBaseURL || '').replace(/\/+$/, '')
    if (!base) throw new Error('Custom image provider: base URL is not configured (Settings → Image generation)')
    if (!cfg.customModel) throw new Error('Custom image provider: model is not configured')

    // Empty key reference indicates unauthenticated gateway.
    const key = cfg.customKeyEnv ? await resolveKey(cfg.customKeyEnv) : ''
    const isEdit = Boolean(source && source.bytes)
    const headers = {}
    if (!isEdit) {
      headers['Content-Type'] = 'application/json'
    }
    if (key) headers.Authorization = `Bearer ${key}`

    // Omit response_format; modern models return either base64 or URL.
    let effectiveMask = mask
    if (isEdit && mask && mask.bytes) {
      const normBytes = await normalizeMaskAlpha(mask.bytes)
      effectiveMask = { ...mask, bytes: normBytes, mediaType: 'image/png' }
    }
    const endpoint = buildEndpointUrl(base, isEdit ? 'images/edits' : 'images/generations')
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: isEdit
        ? buildEditForm({
            model: cfg.customModel,
            source,
            mask: effectiveMask,
            prompt: promptArg,
            size: cfg.customSize || (aspectPixels ? aspectPixels.join('x') : SIZE_PIXELS[size]) || size,
            strength,
          })
        : JSON.stringify({
            model: cfg.customModel,
            prompt: promptArg,
            n: 1,
            size: cfg.customSize || (aspectPixels ? aspectPixels.join('x') : SIZE_PIXELS[size]) || size,
            ...(format ? { output_format: format } : {}),
            ...(negativePrompt !== undefined ? { negative_prompt: negativePrompt } : {}),
            ...(guidanceScale !== undefined ? { guidance_scale: guidanceScale } : {}),
            ...(quality && quality !== 'auto' ? { quality } : {}),
          }),
      signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 503) {
        const msg = (data?.error?.message || JSON.stringify(data)).toLowerCase()
        if (msg.includes('no available channel') || msg.includes('model_not_found')) {
          throw new Error(`Custom image API has no provisioned channel for "${cfg.customModel}" (HTTP 503); check gateway channel and routing configuration`)
        }
      }
      const detail = formatErrorMessage(data?.error || data)
      throw new Error(`Image API failed (HTTP ${res.status}): ${detail}`)
    }
    const item = data?.data?.[0]
    if (!item) {
      throw new Error(`Image API returned no images: ${JSON.stringify(data).slice(0, 600)}`)
    }

    if (item.b64_json) {
      const rawBytes = Buffer.from(item.b64_json, 'base64')
      const targetFormat = format || data.output_format
      const formatted = await ensureImageFormat(rawBytes, targetFormat, {
        fallbackMime: normalizeMediaType(data.output_format || '', format, rawBytes),
      })
      return {
        bytes: formatted.bytes,
        mediaType: formatted.mediaType,
        width: 0,
        height: 0,
        seed: seedArg ?? 0,
        sourceUrl: '',
      }
    }
    if (!item.url) {
      throw new Error(`Image API returned neither b64_json nor url: ${JSON.stringify(item).slice(0, 300)}`)
    }
    const download = await fetchImpl(item.url, { signal })
    if (!download.ok) {
      throw new Error(`Failed to download generated image (HTTP ${download.status})`)
    }
    const contentType = download.headers && typeof download.headers.get === 'function'
      ? download.headers.get('content-type')
      : ''
    const rawBytes = Buffer.from(await download.arrayBuffer())
    const downloadFormat = contentType ? contentType.replace('image/', '').trim().toLowerCase() : undefined
    const targetFormat = (format && format !== 'png') ? format : (downloadFormat || format)
    const formatted = await ensureImageFormat(rawBytes, targetFormat, {
      fallbackMime: normalizeMediaType(contentType, format),
    })
    return {
      bytes: formatted.bytes,
      mediaType: formatted.mediaType,
      width: 0,
      height: 0,
      seed: seedArg ?? 0,
      sourceUrl: item.url,
    }
  }
  return custom
}
