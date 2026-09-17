import {
  formatErrorMessage,
  resolveSubscriptionSize,
} from '../shared-helpers.js'

/**
 * @param {fetchImpl: Function, resolveKey: Function, cfg: object} deps
 * @param {prompt?: string, size?: string, format?: string, seed?: number, signal?: AbortSignal,
 *   negativePrompt?: string, guidanceScale?: number, source?: object, mask?: object, strength?: number,
 *   quality?: string, style?: string, aspectPixels?: number[], aspectRatio?: string} job
 */
export function createSubscriptionGenerator(deps, job) {
  const { fetchImpl, resolveKey, cfg } = deps
  const { prompt, size, format, seed, signal, negativePrompt, guidanceScale, source, mask, strength, quality, style, aspectPixels, aspectRatio } = job

  function subscription(provider) {
    return async function generate(seedArg = seed, promptArg = prompt) {
      if (source) {
        return { ok: false, provider, reason: `${provider}: does not support image editing — use fal, custom, or local` }
      }
      const images = deps.subscriptionImages
      if (!images || typeof images.generate !== 'function') {
        return {
          ok: false,
          provider,
          reason: `${provider}: requires dsh-subscriptions plugin to manage session authentication`,
        }
      }
      let produced
      try {
        produced = await images.generate({
          provider,
          prompt: promptArg,
          size: resolveSubscriptionSize(size, aspectPixels, aspectRatio),
          quality: cfg.subscriptionQuality || undefined,
          signal,
        })
      } catch (e) {
        return { ok: false, provider, reason: formatErrorMessage(e, provider) }
      }
      const first = Array.isArray(produced) ? produced[0] : null
      if (!first || !first.b64_json) {
        return { ok: false, provider, reason: `${provider}: no image returned in response` }
      }
      return {
        bytes: Buffer.from(first.b64_json, 'base64'),
        // Subscription outputs default to PNG media type.
        mediaType: 'image/png',
        width: 0,
        height: 0,
        seed: seedArg ?? 0,
        sourceUrl: '',
        revisedPrompt: first.revisedPrompt || '',
      }
    }
  }
  return subscription
}
