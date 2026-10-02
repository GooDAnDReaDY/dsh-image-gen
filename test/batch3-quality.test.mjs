import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { trackAndAssertLoopGuard, resetLoopGuard } from '../lib/loop-guard.js'
import { sanitizeErrorAndLogs } from '../lib/security.js'
import { getCachedGeneration, setCachedGeneration } from '../lib/generation-cache.js'
import { assertBudgetAvailable, calculateGenerationCost } from '../lib/cost-meter.js'
import { optimizeSvgContent } from '../lib/frontend-assets.js'
import { resolveConversationImage } from '../lib/resolve-image.js'

test('loop-guard: limit = 0 explicitly bypasses loop check', () => {
  const sid = 'bypass_loop_' + Date.now()
  resetLoopGuard(sid)

  for (let i = 0; i < 10; i++) {
    const res = trackAndAssertLoopGuard(sid, { limit: 0, prompt: 'cat' })
    assert.equal(res.allowed, true)
    assert.equal(res.remaining, Infinity)
  }
})

test('security: masks Replicate r8_ tokens and Google Gemini AIza keys', () => {
  const replicateErr = 'Error: 401 Unauthorized for token r8_AbCdEf1234567890XyZ in prediction pipeline'
  const sanitizedRep = sanitizeErrorAndLogs(replicateErr)
  assert.ok(!sanitizedRep.includes('r8_AbCdEf1234567890XyZ'))
  assert.ok(sanitizedRep.includes('r8_A...0XyZ'))

  const geminiErr = 'GoogleGenAIError: API key AIzaSyD-7890abcdef1234567890123456789 is invalid on endpoint'
  const sanitizedGem = sanitizeErrorAndLogs(geminiErr)
  assert.ok(!sanitizedGem.includes('AIzaSyD-7890abcdef1234567890123456789'))
  assert.ok(sanitizedGem.includes('AIza...6789'))
})

test('generation-cache: resilient getCachedGeneration still returns bytes on read-only metadata', () => {
  const hash = 'resilient_test_hash_' + Date.now()
  const dummyBytes = Buffer.from('my_resilient_cached_image')

  setCachedGeneration(hash, {
    bytes: dummyBytes,
    mediaType: 'image/png',
    width: 512,
    height: 512,
    seed: 12345,
  })

  // Normal retrieval
  const hit = getCachedGeneration(hash)
  assert.ok(hit)
  assert.equal(Buffer.compare(hit.bytes, dummyBytes), 0)
  assert.equal(hit.seed, 12345)
})

test('cost-meter: assertBudgetAvailable safely handles undefined, string, and NaN costs', () => {
  assert.equal(assertBudgetAvailable(undefined, 10.0), true)
  assert.equal(assertBudgetAvailable('0.05', 10.0), true)
  assert.equal(assertBudgetAvailable(NaN, 10.0), true)
  assert.equal(assertBudgetAvailable(0.05, 0), true) // budget 0 = unlimited
})

test('frontend-assets: optimizeSvgContent rejects non-SVG text strings', () => {
  assert.throws(
    () => optimizeSvgContent('This is just plain text, not an SVG document'),
    /Content does not contain valid SVG markup/
  )

  assert.throws(
    () => optimizeSvgContent('<html><body><div>Not SVG</div></body></html>'),
    /Content does not contain valid SVG markup/
  )

  const validSvg = '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>'
  const res = optimizeSvgContent(validSvg)
  assert.ok(res.svg.includes('<svg'))
  assert.ok(res.reactTsx.includes('export const VectorIcon'))
})

test('resolve-image: rejects empty (0 bytes) or non-existent files', async () => {
  const emptyFilePath = `/tmp/empty_test_${Date.now()}.png`
  fs.writeFileSync(emptyFilePath, Buffer.alloc(0))

  const ctx = {}
  const exec = { agent: { session: { header: { cwd: '/tmp' } } } }

  await assert.rejects(
    async () => resolveConversationImage(ctx, exec, emptyFilePath),
    /Image file is empty \(0 bytes\)/
  )

  await assert.rejects(
    async () => resolveConversationImage(ctx, exec, '/tmp/non_existent_image_12345.png'),
    /Image file not found/
  )

  try {
    fs.unlinkSync(emptyFilePath)
  } catch {}
})

test('loop-guard: resets on new user turn and isolates sessions (#370)', () => {
  const sid1 = 'user_session_1_' + Date.now()
  const sid2 = 'user_session_2_' + Date.now()

  // Initial turn 1: generates 3 times and reaches limit
  trackAndAssertLoopGuard(sid1, { limit: 3, prompt: 'cat', turnId: 'turn_1' })
  trackAndAssertLoopGuard(sid1, { limit: 3, prompt: 'cat', turnId: 'turn_1' })
  trackAndAssertLoopGuard(sid1, { limit: 3, prompt: 'cat', turnId: 'turn_1' })

  // 4th call in turn_1 must throw
  assert.throws(
    () => trackAndAssertLoopGuard(sid1, { limit: 3, prompt: 'cat', turnId: 'turn_1' }),
    /Generation loop limit reached/
  )

  // Session 2 is completely isolated and unaffected by session 1
  const resSid2 = trackAndAssertLoopGuard(sid2, { limit: 3, prompt: 'dog', turnId: 'turn_1' })
  assert.equal(resSid2.count, 1)

  // Next user turn (turn_2) in session 1 automatically resets loop count
  const resTurn2 = trackAndAssertLoopGuard(sid1, { limit: 3, prompt: 'cat enhanced', turnId: 'turn_2' })
  assert.equal(resTurn2.count, 1)
  assert.equal(resTurn2.allowed, true)

  // resetLoopGuard() with no argument clears all sessions
  resetLoopGuard()
  const resAfterTeardown = trackAndAssertLoopGuard(sid1, { limit: 3, prompt: 'fresh' })
  assert.equal(resAfterTeardown.count, 1)
})
