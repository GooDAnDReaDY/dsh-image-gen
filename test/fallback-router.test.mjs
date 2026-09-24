import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isFatalPromptError,
  isRetryableProviderError,
  resolveFallbackChain,
  executeWithFallback,
} from '../lib/fallback-router.js'

test('fallback-router: isFatalPromptError detects safety and syntax policy violations', () => {
  assert.equal(isFatalPromptError(new Error('Prompt violates content policy')), true)
  assert.equal(isFatalPromptError(new Error('Triggered safety system')), true)
  assert.equal(isFatalPromptError(new Error('NSFW filter blocked request')), true)
  assert.equal(isFatalPromptError(new Error('prompt is required')), true)

  assert.equal(isFatalPromptError(new Error('HTTP 429 Too Many Requests')), false)
  assert.equal(isFatalPromptError(new Error('HTTP 503 Service Unavailable')), false)
  assert.equal(isFatalPromptError(new Error('balance is insufficient')), false)
})

test('fallback-router: isRetryableProviderError detects transient and quota errors', () => {
  assert.equal(isRetryableProviderError(new Error('HTTP 429 Too Many Requests')), true)
  assert.equal(isRetryableProviderError(new Error('HTTP 502 Bad Gateway')), true)
  assert.equal(isRetryableProviderError(new Error('gateway timeout 504')), true)
  assert.equal(isRetryableProviderError(new Error('Request timed out')), true)
  assert.equal(isRetryableProviderError(new Error('insufficient_quota')), true)
  assert.equal(isRetryableProviderError(new Error('balance is insufficient')), true)
  assert.equal(isRetryableProviderError(new Error('Invalid API key (HTTP 401)')), false)
  assert.equal(isRetryableProviderError(new Error('HTTP 403 Forbidden')), false)
  assert.equal(isRetryableProviderError(new Error('HTTP 400 Bad Request')), false)
  assert.equal(isRetryableProviderError(new Error('fetch failed: ECONNREFUSED')), true)

  assert.equal(isRetryableProviderError(new Error('Prompt violates content policy')), false)
})

test('fallback-router: resolveFallbackChain orders primary, configured fallbacks, and deduplicates', () => {
  const chain1 = resolveFallbackChain('fal', ['replicate', 'custom'], ['fal', 'custom', 'gemini', 'replicate'])
  assert.deepEqual(chain1, ['fal', 'replicate', 'custom', 'gemini'])

  const chain2 = resolveFallbackChain('gemini', [], ['fal', 'replicate', 'gemini'])
  assert.deepEqual(chain2, ['gemini', 'fal', 'replicate'])

  const chain3 = resolveFallbackChain('custom', ['custom', 'fal'], ['custom'])
  assert.deepEqual(chain3, ['custom', 'fal'])
})

test('fallback-router: executeWithFallback succeeds on primary provider without triggering fallback', async () => {
  const generators = {
    fal: async (seed, prompt) => ({ path: '/tmp/fal.png', seed, prompt, provider: 'fal' }),
    replicate: async (seed, prompt) => ({ path: '/tmp/rep.png', seed, prompt, provider: 'replicate' }),
  }

  const result = await executeWithFallback(generators, ['fal', 'replicate'], 1234, 'a cute cat')
  assert.equal(result.provider, 'fal')
  assert.equal(result._fallback.triggered, false)
  assert.equal(result._fallback.primaryProvider, 'fal')
  assert.equal(result._fallback.providerUsed, 'fal')
  assert.equal(result._fallback.attempts.length, 1)
})

test('fallback-router: executeWithFallback cascades on 429 or quota depletion to fallback provider', async () => {
  let falAttempts = 0
  const generators = {
    fal: async () => {
      falAttempts++
      throw new Error('HTTP 429: Rate limit exceeded. Try again later.')
    },
    replicate: async (seed, prompt) => {
      return { path: '/tmp/replicate.png', seed, prompt, provider: 'replicate' }
    },
  }

  const result = await executeWithFallback(generators, ['fal', 'replicate'], 5678, 'a robotic hound')
  assert.equal(falAttempts, 1)
  assert.equal(result.provider, 'replicate')
  assert.equal(result._fallback.triggered, true)
  assert.equal(result._fallback.primaryProvider, 'fal')
  assert.equal(result._fallback.providerUsed, 'replicate')
  assert.equal(result._fallback.attempts.length, 2)
  assert.equal(result._fallback.attempts[0].success, false)
  assert.equal(result._fallback.attempts[1].success, true)
})

test('fallback-router: executeWithFallback does not cascade on fatal prompt/content violations', async () => {
  let repAttempts = 0
  const generators = {
    fal: async () => {
      throw new Error('Triggered safety system: Prompt violates content policy')
    },
    replicate: async () => {
      repAttempts++
      return { path: '/tmp/rep.png' }
    },
  }

  await assert.rejects(
    async () => executeWithFallback(generators, ['fal', 'replicate'], 999, 'unsafe prompt'),
    (err) => {
      assert.ok(err.message.includes('Content or policy error on fal'))
      return true
    }
  )
  assert.equal(repAttempts, 0)
})

test('fallback-router: executeWithFallback throws aggregate error when all providers fail', async () => {
  const generators = {
    fal: async () => { throw new Error('HTTP 502 Bad Gateway') },
    replicate: async () => { throw new Error('HTTP 429 Rate Limit') },
  }

  await assert.rejects(
    async () => executeWithFallback(generators, ['fal', 'replicate'], 111, 'neon cityscape'),
    (err) => {
      assert.ok(err.message.includes('Image generation cascade failed on all 2 attempted providers'))
      assert.ok(err.message.includes('502 Bad Gateway'))
      assert.ok(err.message.includes('429 Rate Limit'))
      return true
    }
  )
})

test('fallback-router: executeWithFallback does not cascade on 401/auth non-retryable errors (#298)', async () => {
  let repAttempts = 0
  const generators = {
    fal: async () => {
      throw new Error('HTTP 401 Unauthorized: Invalid API key')
    },
    replicate: async () => {
      repAttempts++
      return { path: '/tmp/rep.png' }
    },
  }

  await assert.rejects(
    async () => executeWithFallback(generators, ['fal', 'replicate'], 555, 'auth test'),
    (err) => {
      assert.ok(err.message.includes('Non-retryable provider error on fal (not cascading)'))
      assert.ok(err.message.includes('401'))
      return true
    }
  )
  assert.equal(repAttempts, 0, 'replicate fallback must NOT be called on 401')
})

test('fallback-router: executeWithFallback cascades on 503 Service Unavailable (#298)', async () => {
  let falAttempts = 0
  let repAttempts = 0
  const generators = {
    fal: async () => {
      falAttempts++
      throw new Error('HTTP 503 Service Unavailable')
    },
    replicate: async (seed, prompt) => {
      repAttempts++
      return { path: '/tmp/rep503.png', seed, prompt, provider: 'replicate' }
    },
  }

  const res = await executeWithFallback(generators, ['fal', 'replicate'], 777, 'cascade test')
  assert.equal(falAttempts, 1)
  assert.equal(repAttempts, 1)
  assert.equal(res.provider, 'replicate')
  assert.equal(res._fallback.triggered, true)
})
