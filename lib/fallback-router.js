// fallback-router.js — Smart Provider Fallback Chain for image generation (#282).
// Automatically cascades across configured providers on 429, 5xx, timeouts,
// quota depletion, and network issues without failing the user's turn.

import { formatErrorMessage } from './provider-utils.js'

/**
 * Checks if an error is strictly a prompt-level safety or client syntax violation
 * that cannot be fixed by switching to a different provider.
 *
 * @param {Error|any} error
 * @returns {boolean} true if fatal prompt/content violation, false if provider-level retryable
 */
export function isFatalPromptError(error) {
  const msg = (error?.message || String(error || '')).toLowerCase()
  return (
    msg.includes('content policy') ||
    msg.includes('safety system') ||
    msg.includes('nsfw') ||
    msg.includes('moderation') ||
    msg.includes('prompt is required') ||
    msg.includes('empty prompt') ||
    msg.includes('invalid_prompt') ||
    msg.includes('unsupported image format')
  )
}

/**
 * Checks whether an error is retryable by switching to another provider.
 * Covers 429 (rate limit), 5xx (server error), timeout, payment/quota depletion, and network dropouts.
 *
 * @param {Error|any} error
 * @returns {boolean}
 */
export function isRetryableProviderError(error) {
  if (isFatalPromptError(error)) return false
  const msg = (error?.message || String(error || '')).toLowerCase()

  // Non-retryable: authentication, authorization, or invalid request / client configuration errors
  if (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('invalid api key') ||
    msg.includes('invalid key') ||
    msg.includes('api key missing') ||
    msg.includes('api_key_invalid') ||
    msg.includes('bad request') ||
    msg.includes('invalid argument') ||
    msg.includes('invalid parameter') ||
    msg.includes('400')
  ) {
    return false
  }

  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('bad gateway') ||
    msg.includes('service unavailable') ||
    msg.includes('gateway timeout') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('aborted') ||
    msg.includes('402') ||
    msg.includes('payment required') ||
    msg.includes('insufficient_quota') ||
    msg.includes('insufficient credits') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('balance is insufficient') ||
    msg.includes('quota') ||
    msg.includes('credit') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  )
}

/**
 * Resolves the candidate evaluation order:
 * Primary provider first, followed by explicit fallbackProviders, then remaining known providers.
 *
 * @param {string} primary
 * @param {string[]} [configuredFallbacks=[]]
 * @param {string[]} [allProviders=[]]
 * @returns {string[]}
 */
export function resolveFallbackChain(primary, configuredFallbacks = [], allProviders = []) {
  const chain = [primary]
  if (Array.isArray(configuredFallbacks)) {
    for (const p of configuredFallbacks) {
      if (typeof p === 'string' && p.trim() && !chain.includes(p.trim())) {
        chain.push(p.trim())
      }
    }
  }
  if (Array.isArray(allProviders)) {
    for (const p of allProviders) {
      if (typeof p === 'string' && p.trim() && !chain.includes(p.trim())) {
        chain.push(p.trim())
      }
    }
  }
  return chain
}

/**
 * Executes image generation across a cascade of providers with full attempt diagnostics.
 *
 * @param {Record<string, (seed: number, prompt: string) => Promise<any>>} generators
 * @param {string[]} chain Ordered list of providers to try
 * @param {number} seed
 * @param {string} prompt
 * @param {object} [options]
 * @returns {Promise<any>} Produced image with attached _fallback metadata
 */
export async function executeWithFallback(generators, chain, seed, prompt, options = {}) {
  const attempts = []
  const primaryProvider = chain[0] || 'unknown'
  const logger = options.logger || null

  for (let i = 0; i < chain.length; i++) {
    const providerKey = chain[i]
    const generator = generators[providerKey]
    if (typeof generator !== 'function') {
      continue
    }

    const startTime = Date.now()
    try {
      const produced = await generator(seed, prompt)
      if (produced) {
        const isFallback = providerKey !== primaryProvider
        produced._fallback = {
          triggered: isFallback,
          primaryProvider,
          providerUsed: providerKey,
          attempts: [
            ...attempts,
            { provider: providerKey, durationMs: Date.now() - startTime, success: true },
          ],
        }
        if (isFallback && logger && typeof logger.info === 'function') {
          logger.info(`[dsh-image-gen] Fallback triggered: ${primaryProvider} -> ${providerKey}`)
        }
        return produced
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      const formatted = formatErrorMessage(err, providerKey)
      attempts.push({
        provider: providerKey,
        error: formatted,
        durationMs,
        success: false,
      })

      if (isFatalPromptError(err)) {
        throw new Error(`Content or policy error on ${providerKey} (not cascading): ${formatted}`)
      }

      if (!isRetryableProviderError(err)) {
        throw new Error(`Non-retryable provider error on ${providerKey} (not cascading): ${formatted}`)
      }

      if (logger && typeof logger.warn === 'function') {
        logger.warn(`[dsh-image-gen] Provider ${providerKey} failed: ${formatted}. Trying next candidate...`)
      }
    }
  }

  const failureSummary = attempts
    .map((a) => `${a.provider} (${a.durationMs}ms): ${a.error}`)
    .join('; ')
  throw new Error(`Image generation cascade failed on all ${attempts.length} attempted providers: ${failureSummary}`)
}
