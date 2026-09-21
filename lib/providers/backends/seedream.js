import {
  normalizeMediaType,
  SIZE_PIXELS,
} from '../shared-helpers.js'

/**
 * @param {fetchImpl: Function, resolveKey: Function, cfg: object} deps
 * @param {prompt?: string, size?: string, format?: string, seed?: number, signal?: AbortSignal,
 *   negativePrompt?: string, guidanceScale?: number, source?: object, mask?: object, strength?: number,
 *   quality?: string, style?: string, aspectPixels?: number[], aspectRatio?: string} job
 */
export function createSeedreamGenerator(deps, job) {
  const { fetchImpl, resolveKey, cfg } = deps
  const { prompt, size, format, seed, signal, negativePrompt, guidanceScale, source, mask, strength, quality, style, aspectPixels, aspectRatio } = job

  async function seedream(seedArg = seed, promptArg = prompt) {
    const key = await resolveKey(cfg.seedreamKeyEnv)
    const base = (cfg.seedreamBaseURL || 'https://api.bytedanceapi.com/v1').replace(/\/+$/, '')
    const timeoutSignal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(cfg.timeoutMs || 120000)
      : undefined
    const effectiveSignal = signal && timeoutSignal && AbortSignal.any
      ? AbortSignal.any([signal, timeoutSignal])
      : (signal || timeoutSignal)
    const res = await fetchImpl(`${base}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: cfg.seedreamModel || 'seedream-4.0',
        prompt: promptArg,
        n: 1,
        size: (aspectPixels ? aspectPixels.join('x') : SIZE_PIXELS[size]) || size,
        ...(negativePrompt !== undefined ? { negative_prompt: negativePrompt } : {}),
        ...(quality !== undefined ? { quality } : {}),
        ...(style !== undefined ? { style } : {}),
      }),
      signal: effectiveSignal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = data?.error?.message || JSON.stringify(data).slice(0, 600)
      throw new Error(`Seedream failed (HTTP ${res.status}): ${detail}`)
    }
    const item = data?.data?.[0]
    if (!item) throw new Error('Seedream returned no images')
    if (item.b64_json) {
      return { bytes: Buffer.from(item.b64_json, 'base64'), mediaType: normalizeMediaType('image/png', format), width: 0, height: 0, seed: seedArg ?? 0, sourceUrl: '' }
    }
    if (!item.url) throw new Error('Seedream returned neither b64_json nor url')
    const dl = await fetchImpl(item.url, { signal: effectiveSignal })
    if (!dl.ok) throw new Error(`Seedream download failed (HTTP ${dl.status})`)
    return { bytes: Buffer.from(await dl.arrayBuffer()), mediaType: normalizeMediaType('image/png', format), width: 0, height: 0, seed: seedArg ?? 0, sourceUrl: item.url }
  }
  return seedream
}
