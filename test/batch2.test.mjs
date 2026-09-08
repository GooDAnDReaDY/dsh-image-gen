import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { trackAndAssertLoopGuard, resetLoopGuard, getLoopGuardState } from '../lib/loop-guard.js'
import { maskApiKey, sanitizeErrorAndLogs, enforceSecurePermissions } from '../lib/security.js'
import { getCachedGeneration, setCachedGeneration, pruneCacheToLimit } from '../lib/generation-cache.js'

test('trackAndAssertLoopGuard: limits consecutive calls and throws at limit', () => {
  const sid = 'test_session_' + Date.now()
  resetLoopGuard(sid)

  // 1st call: OK
  const r1 = trackAndAssertLoopGuard(sid, { limit: 3, prompt: 'cat' })
  assert.equal(r1.count, 1)

  // 2nd call: OK
  const r2 = trackAndAssertLoopGuard(sid, { limit: 3, prompt: 'cat' })
  assert.equal(r2.count, 2)

  // 3rd call: OK
  const r3 = trackAndAssertLoopGuard(sid, { limit: 3, prompt: 'cat' })
  assert.equal(r3.count, 3)

  // 4th call: Throws loop limit exceeded
  assert.throws(
    () => trackAndAssertLoopGuard(sid, { limit: 3, prompt: 'cat' }),
    /Generation loop limit reached/
  )

  // User turn resets counter
  trackAndAssertLoopGuard(sid, { isUserTurn: true })
  const afterReset = getLoopGuardState(sid)
  assert.equal(afterReset.count, 0)
})

test('security: maskApiKey and sanitizeErrorAndLogs masks secrets in text', () => {
  assert.equal(maskApiKey('sk-1234567890abcdef'), 'sk-1...cdef')
  assert.equal(maskApiKey('short'), '********')
  assert.equal(maskApiKey(''), '')

  const rawError = 'Error: 401 Unauthorized for Authorization: Bearer sk-ant-api03-abcdef1234567890 on https://api.fal.ai?key=fal_secret_key_123456'
  const sanitized = sanitizeErrorAndLogs(rawError)
  assert.ok(!sanitized.includes('sk-ant-api03-abcdef1234567890'))
  assert.ok(!sanitized.includes('fal_secret_key_123456'))
  assert.ok(sanitized.includes('Bearer sk-a...7890'))
  assert.ok(sanitized.includes('fal_...3456'))
})

test('generation-cache: stores and retrieves identical generation by hash', () => {
  const hash = 'testhash_' + Date.now()
  const bytes = Buffer.from('test_image_bytes_content')

  // Cache miss before storing
  assert.equal(getCachedGeneration(hash), null)

  // Store in cache
  setCachedGeneration(hash, {
    bytes,
    mediaType: 'image/png',
    width: 512,
    height: 512,
    seed: 42,
  })

  // Cache hit
  const hit = getCachedGeneration(hash)
  assert.ok(hit)
  assert.equal(hit.width, 512)
  assert.equal(hit.seed, 42)
  assert.equal(Buffer.from(hit.bytes).toString(), 'test_image_bytes_content')

  // Force bypass cache
  const bypassed = getCachedGeneration(hash, { force: true })
  assert.equal(bypassed, null)
})

test('syntax audit: all lib files must pass node syntax check', () => {
  const out = execSync('node --check lib/index.js lib/client.js lib/providers.js lib/cost-meter.js lib/generation-cache.js lib/loop-guard.js lib/negative-sanitizer.js lib/quality-gate.js lib/security.js', { encoding: 'utf8' })
  assert.equal(out.trim(), '')
})
