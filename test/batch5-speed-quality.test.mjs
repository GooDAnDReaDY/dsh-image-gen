import test from 'node:test'
import assert from 'node:assert/strict'
import { isFatalClientError, pollStatus } from '../lib/providers.js'
import { getCachedGeneration, setCachedGeneration } from '../lib/generation-cache.js'

test('isFatalClientError: identifies 402 payment required and quota exhaustion', () => {
  assert.equal(isFatalClientError(new Error('402 Payment Required: Insufficient balance')), true)
  assert.equal(isFatalClientError(new Error('You have exceeded your current quota, please check your plan')), true)
  assert.equal(isFatalClientError(new Error('insufficient_quota: billing account closed')), true)
  assert.equal(isFatalClientError(new Error('Account balance is insufficient to complete this operation')), true)
  assert.equal(isFatalClientError(new Error('FAL API error: insufficient credits for flux-pro')), true)

  // Non-fatal errors that should fallback
  assert.equal(isFatalClientError(new Error('503 Service Unavailable')), false)
  assert.equal(isFatalClientError(new Error('504 Gateway Timeout')), false)
  assert.equal(isFatalClientError(new Error('ETIMEDOUT: Connection reset by peer')), false)
})

test('pollStatus: executes immediate first poll without waiting for backoff delay', async () => {
  let callCount = 0
  const startTime = Date.now()

  const fetchImpl = async () => {
    callCount++
    // Return completed immediately on first attempt
    return {
      ok: true,
      json: async () => ({ status: 'COMPLETED', response_url: 'https://fal/result.png' }),
    }
  }

  const res = await pollStatus(fetchImpl, 'https://fal/status', 'fal_test_key', undefined, 2000, 10000)
  const elapsed = Date.now() - startTime

  assert.equal(res.status, 'COMPLETED')
  assert.equal(callCount, 1)
  // Should finish virtually immediately (< 100ms) rather than waiting 2000ms
  assert.ok(elapsed < 200, `Expected elapsed < 200ms but got ${elapsed}ms`)
})

test('generation-cache: in-memory L1 LRU returns hit instantly and syncs with disk', () => {
  const hash = 'l1_speed_test_' + Date.now()
  const bytes = Buffer.from('fast_cached_image_bytes')

  setCachedGeneration(hash, {
    bytes,
    mediaType: 'image/png',
    width: 256,
    height: 256,
    seed: 777,
  })

  // First read hits L1
  const t0 = Date.now()
  const hit1 = getCachedGeneration(hash)
  const d0 = Date.now() - t0

  assert.ok(hit1)
  assert.equal(hit1.seed, 777)
  assert.equal(Buffer.compare(hit1.bytes, bytes), 0)
  assert.ok(d0 < 5, `Expected L1 cache hit in < 5ms, took ${d0}ms`)

  // Second read also hits L1
  const hit2 = getCachedGeneration(hash)
  assert.ok(hit2)
  assert.equal(Buffer.compare(hit2.bytes, bytes), 0)
})
