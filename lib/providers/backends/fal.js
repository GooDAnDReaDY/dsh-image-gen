import {
  falAuthHeader,
  normalizeMediaType,
  submitJob,
  pollStatus,
} from '../shared-helpers.js'

/**
 * @param {fetchImpl: Function, resolveKey: Function, cfg: object} deps
 * @param {prompt?: string, size?: string, format?: string, seed?: number, signal?: AbortSignal,
 *   negativePrompt?: string, guidanceScale?: number, source?: object, mask?: object, strength?: number,
 *   quality?: string, style?: string, aspectPixels?: number[], aspectRatio?: string} job
 */
export function createFalGenerator(deps, job) {
  const { fetchImpl, resolveKey, cfg } = deps
  const { prompt, size, format, seed, signal, negativePrompt, guidanceScale, source, mask, strength, quality, style, aspectPixels, aspectRatio } = job

  async function fal(seedArg = seed, promptArg = prompt) {
    const key = await resolveKey(cfg.apiKeyEnv)
    const isEdit = Boolean(source && source.bytes)
    const targetModel = isEdit
      ? (mask && mask.bytes ? 'fal-ai/flux-pro/v1/inpaint' : 'fal-ai/flux/dev/image-to-image')
      : cfg.model
    const body = { prompt: promptArg, image_size: size, num_images: 1 }
    if (seedArg !== undefined) body.seed = seedArg
    if (negativePrompt !== undefined) body.negative_prompt = negativePrompt
    if (guidanceScale !== undefined) body.guidance_scale = guidanceScale
    if (format !== 'png') body.output_format = format
    if (isEdit) {
      body.image_url = `data:${source.mediaType || 'image/png'};base64,${Buffer.from(source.bytes).toString('base64')}`
      if (mask && mask.bytes) {
        body.mask_url = `data:${mask.mediaType || 'image/png'};base64,${Buffer.from(mask.bytes).toString('base64')}`
      }
      if (strength !== undefined) {
        body.strength = strength
      }
    }

    const submit = await submitJob(fetchImpl, cfg.baseURL, targetModel, key, body, signal)
    const statusUrl = submit.status_url || `${cfg.baseURL}/${cfg.model}/requests/${submit.request_id}/status`
    const statusBody = await pollStatus(fetchImpl, statusUrl, key, signal, cfg.pollIntervalMs, cfg.timeoutMs)

    const resultRes = await fetchImpl(statusBody.response_url, {
      headers: { Authorization: falAuthHeader(key) },
      signal,
    })
    const result = await resultRes.json().catch(() => ({}))
    const image = result.images && result.images[0]
    if (!image || !image.url) {
      throw new Error(`FAL returned no images: ${JSON.stringify(result).slice(0, 600)}`)
    }
    const download = await fetchImpl(image.url, { signal })
    if (!download.ok) {
      throw new Error(`Failed to download generated image (HTTP ${download.status})`)
    }
    return {
      bytes: Buffer.from(await download.arrayBuffer()),
      mediaType: normalizeMediaType(image.content_type, format),
      width: image.width ?? 0,
      height: image.height ?? 0,
      seed: result.seed ?? seedArg ?? 0,
      sourceUrl: image.url,
      cost: result.cost,
    }
  }
  return fal
}
