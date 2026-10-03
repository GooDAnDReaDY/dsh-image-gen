import {
  normalizeMediaType,
  ensureImageFormat,
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
    let model = cfg.geminiModel || 'gemini-3.1-flash-image'
    // #364: Transparently migrate deprecated Imagen 3/4 IDs and preview 2.0 to current Gemini multimodal model
    if (model.startsWith('imagen-') || model.startsWith('gemini-2.0-flash-exp')) {
      model = 'gemini-3.1-flash-image'
    }

    const timeoutSignal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(cfg.timeoutMs || 120000)
      : undefined
    const effectiveSignal = signal && timeoutSignal && AbortSignal.any
      ? AbortSignal.any([signal, timeoutSignal])
      : (signal || timeoutSignal)

    const parts = []
    if (source && source.bytes) {
      const sourceMime = source.mediaType || 'image/png'
      const sourceBase64 = Buffer.isBuffer(source.bytes) ? source.bytes.toString('base64') : Buffer.from(source.bytes).toString('base64')
      parts.push({
        inlineData: {
          mimeType: sourceMime,
          data: sourceBase64,
        },
      })
    } else {
      const refTarget = job.faceReference || job.referenceImage
      if (refTarget && refTarget.bytes) {
        const refMime = refTarget.mediaType || 'image/png'
        const refBase64 = Buffer.isBuffer(refTarget.bytes) ? refTarget.bytes.toString('base64') : Buffer.from(refTarget.bytes).toString('base64')
        parts.push({
          inlineData: {
            mimeType: refMime,
            data: refBase64,
          },
        })
      }
    }
    parts.push({ text: promptArg })

    // #364: Google Gemini ImageConfig only accepts aspectRatio and imageSize.
    // Unofficial/deprecated fields like imageQuality or imageStyle must not be passed.
    const imageConfig = {}
    if (aspectRatio) {
      const ratioMap = {
        square: '1:1',
        portrait_4_3: '3:4',
        landscape_4_3: '4:3',
        portrait_16_9: '9:16',
        landscape_16_9: '16:9',
      }
      imageConfig.aspectRatio = ratioMap[aspectRatio] || aspectRatio
    }

    const generationConfig = {
      responseModalities: ['TEXT', 'IMAGE'],
      ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
    }

    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig,
      }),
      signal: effectiveSignal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = data?.error?.message || JSON.stringify(data).slice(0, 600)
      throw new Error(`Gemini failed (HTTP ${res.status}): ${detail}`)
    }
    const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
    if (!part) throw new Error('Gemini returned no image')

    const rawBytes = Buffer.from(part.inlineData.data, 'base64')
    const formatted = await ensureImageFormat(rawBytes, format || part.inlineData.mimeType)
    return {
      bytes: formatted.bytes,
      mediaType: formatted.mediaType,
      width: 0,
      height: 0,
      seed: seedArg ?? 0,
      sourceUrl: '',
    }
  }
  return gemini
}
