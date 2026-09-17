import {
  normalizeMediaType,
  estimateCost,
  pxSize,
  calculateBackoff,
  ASPECT_RATIOS,
} from '../shared-helpers.js'

/**
 * @param {fetchImpl: Function, resolveKey: Function, cfg: object} deps
 * @param {prompt?: string, size?: string, format?: string, seed?: number, signal?: AbortSignal,
 *   negativePrompt?: string, guidanceScale?: number, source?: object, mask?: object, strength?: number,
 *   quality?: string, style?: string, aspectPixels?: number[], aspectRatio?: string} job
 */
export function createReplicateGenerator(deps, job) {
  const { fetchImpl, resolveKey, cfg } = deps
  const { prompt, size, format, seed, signal, negativePrompt, guidanceScale, source, mask, strength, quality, style, aspectPixels, aspectRatio } = job

  async function replicate(seedArg = seed, promptArg = prompt) {
    const key = await resolveKey(cfg.replicateKeyEnv || 'REPLICATE_API_TOKEN')
    if (!key) throw new Error('Replicate API token is not configured (Settings → Image generation → replicateKeyEnv)')
    const model = cfg.replicateModel || 'black-forest-labs/flux-schnell'
    const [width, height] = pxSize(aspectPixels, size)
    const body = {
      input: {
        prompt: promptArg,
        aspect_ratio: aspectPixels ? `${aspectPixels[0]}:${aspectPixels[1]}` : (ASPECT_RATIOS[size] || '1:1'),
        seed: seedArg,
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
        ...(source && source.bytes ? {
          image: `data:${source.mediaType || 'image/png'};base64,${Buffer.from(source.bytes).toString('base64')}`,
          ...(mask && mask.bytes ? { mask: `data:${mask.mediaType || 'image/png'};base64,${Buffer.from(mask.bytes).toString('base64')}` } : {}),
          ...(strength !== undefined ? { prompt_strength: strength } : {}),
        } : {}),
      },
    }
    const res = await fetchImpl(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(`Replicate submit failed (HTTP ${res.status}): ${data.detail || JSON.stringify(data).slice(0, 300)}`)
    }
    let pred = data
    if (pred.status !== 'succeeded') {
      const pollUrl = pred.urls?.get || `https://api.replicate.com/v1/predictions/${pred.id}`
      const deadline = Date.now() + (cfg.timeoutMs || 180000)
      let attempt = 0
    while (pred.status !== 'succeeded') {
        if (signal?.aborted) throw new Error('Replicate generation cancelled')
        if (Date.now() > deadline) throw new Error('Replicate generation timed out')
        if (pred.status === 'failed' || pred.status === 'canceled') {
          throw new Error(`Replicate failed: ${pred.error || 'unknown error'}`)
        }
        const repDelay = calculateBackoff(attempt++, cfg.pollIntervalMs || 1000, 5000)
        await new Promise((r) => setTimeout(r, repDelay))
        const pRes = await fetchImpl(pollUrl, { headers: { Authorization: `Bearer ${key}` }, signal })
        pred = await pRes.json().catch(() => ({}))
      }
    }
    const output = Array.isArray(pred.output) ? pred.output[0] : pred.output
    if (!output) throw new Error('Replicate returned no image output')
    const dl = await fetchImpl(output, { signal })
    if (!dl.ok) throw new Error(`Replicate download failed (HTTP ${dl.status})`)
    const bytes = Buffer.from(await dl.arrayBuffer())
    return {
      bytes,
      mediaType: normalizeMediaType(dl.headers?.get?.('content-type') || 'image/png', format),
      width,
      height,
      seed: seedArg ?? 0,
      cost: estimateCost('replicate', model),
      sourceUrl: output,
    }
  }
  return replicate
}
