import {
  normalizeMediaType,
} from '../shared-helpers.js'

/**
 * @param {fetchImpl: Function, resolveKey: Function, cfg: object} deps
 * @param {prompt?: string, size?: string, format?: string, seed?: number, signal?: AbortSignal,
 *   negativePrompt?: string, guidanceScale?: number, source?: object, mask?: object, strength?: number,
 *   quality?: string, style?: string, aspectPixels?: number[], aspectRatio?: string} job
 */
export function createGeminiGenerator(deps, job) {
  const { fetchImpl, resolveKey, cfg } = deps
  const { prompt, size, format, seed, signal, negativePrompt, guidanceScale, source, mask, strength, quality, style, aspectPixels, aspectRatio } = job

  async function gemini(seedArg = seed, promptArg = prompt) {
    const key = await resolveKey(cfg.geminiKeyEnv)
    const model = cfg.geminiModel || 'gemini-2.0-flash-exp-image-generation'
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptArg }] }],
        generationConfig: { responseModalities: ['IMAGE'], ...(quality !== undefined ? { imageConfig: { imageQuality: quality } } : {}), ...(style !== undefined ? { imageConfig: { imageStyle: style } } : {}) },
      }),
      signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = data?.error?.message || JSON.stringify(data).slice(0, 600)
      throw new Error(`Gemini failed (HTTP ${res.status}): ${detail}`)
    }
    const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
    if (!part) throw new Error('Gemini returned no image')
    return { bytes: Buffer.from(part.inlineData.data, 'base64'), mediaType: normalizeMediaType(part.inlineData.mimeType || 'image/png', format), width: 0, height: 0, seed: seedArg ?? 0, sourceUrl: '' }
  }
  return gemini
}
