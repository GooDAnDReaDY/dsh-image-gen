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

test('style preset: handles style_preset correctly and never appends default "none" to prompt (#376)', async () => {
  const { resolveStylePreset, applyStylePreset } = await import('../lib/providers.js')
  const { prepareGenerationPrompt } = await import('../lib/generation-helpers.js')

  // 1. None should never add suffix
  assert.equal(resolveStylePreset('none').promptSuffix, '')
  assert.equal(resolveStylePreset('None').promptSuffix, '')
  assert.equal(resolveStylePreset('off').promptSuffix, '')
  assert.equal(resolveStylePreset('default').promptSuffix, '')
  assert.equal(resolveStylePreset('').promptSuffix, '')
  assert.equal(resolveStylePreset(null).promptSuffix, '')

  assert.equal(applyStylePreset('a sunset', 'none'), 'a sunset')
  assert.equal(applyStylePreset('a sunset', ''), 'a sunset')

  // 2. All 10 presets and their aliases produce distinct suffixes
  const presets = [
    'cinematic',
    'photorealistic',
    'anime',
    'minimalist_vector',
    'isometric_3d',
    'analog_film',
    'cyberpunk',
    'pixel_art',
    'oil_painting',
    'claymation',
  ]
  for (const p of presets) {
    const res = resolveStylePreset(p)
    assert.ok(res.promptSuffix.length > 0, `Preset ${p} should have a prompt suffix`)
    assert.notEqual(res.promptSuffix, p, `Preset ${p} should expand, not be literal name`)
  }

  // Aliases
  assert.equal(resolveStylePreset('photo').promptSuffix, resolveStylePreset('photorealistic').promptSuffix)
  assert.equal(resolveStylePreset('isometric').promptSuffix, resolveStylePreset('isometric_3d').promptSuffix)
  assert.equal(resolveStylePreset('vector').promptSuffix, resolveStylePreset('minimalist_vector').promptSuffix)
  assert.equal(resolveStylePreset('analog').promptSuffix, resolveStylePreset('analog_film').promptSuffix)

  // 3. prepareGenerationPrompt respects args.style_preset
  const fakeCtx = {}
  const fakeExec = { signal: new AbortController().signal }
  const cfg = { stylePreset: 'none', defaultStylePreset: 'none', enhancePrompt: false }

  // Default with no style_preset -> prompt unmodified, no ", none"
  const p1 = await prepareGenerationPrompt({
    ctx: fakeCtx,
    cfg,
    args: { prompt: 'a beautiful castle' },
    exec: fakeExec,
    sessionId: 's1',
    provider: 'fal',
    resolveSource: async () => ({}),
  })
  assert.equal(p1.effectivePrompt, 'a beautiful castle')
  assert.ok(!p1.effectivePrompt.includes('none'))

  // With explicit style_preset: 'anime'
  const p2 = await prepareGenerationPrompt({
    ctx: fakeCtx,
    cfg,
    args: { prompt: 'a beautiful castle', style_preset: 'anime' },
    exec: fakeExec,
    sessionId: 's2',
    provider: 'fal',
    resolveSource: async () => ({}),
  })
  assert.ok(p2.effectivePrompt.includes('Makoto Shinkai'))
  assert.ok(p2.effectiveNegative.includes('photorealistic'))

  // Explicit provider style (e.g. style: 'vivid') does not replace preset or contaminate prompt
  const p3 = await prepareGenerationPrompt({
    ctx: fakeCtx,
    cfg,
    args: { prompt: 'a beautiful castle', style: 'vivid' },
    exec: fakeExec,
    sessionId: 's3',
    provider: 'openai',
    resolveSource: async () => ({}),
  })
  assert.equal(p3.effectivePrompt, 'a beautiful castle')
})
