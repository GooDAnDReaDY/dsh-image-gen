import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateImageQuality, executeWithQualityGate } from '../lib/quality-gate.js'

test('evaluateImageQuality: rejects corrupt or tiny buffers', async () => {
  const result = await evaluateImageQuality(Buffer.from([0, 1, 2, 3]))
  assert.equal(result.passed, false)
  assert.equal(result.defect, 'corrupt_buffer')
})

test('evaluateImageQuality: rejects solid monochrome or blank images', async () => {
  const sharp = (await import('sharp')).default
  const blankBuf = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toBuffer()
  const result = await evaluateImageQuality(blankBuf)
  assert.equal(result.passed, false)
  assert.equal(result.defect, 'blank_or_solid_frame')
})

test('evaluateImageQuality: accepts high-entropy varied image buffers', async () => {
  const sharp = (await import('sharp')).default
  const variedRaw = Buffer.alloc(32 * 32)
  for (let i = 0; i < variedRaw.length; i++) variedRaw[i] = (i * 37) % 256
  const variedBuf = await sharp(variedRaw, { raw: { width: 32, height: 32, channels: 1 } }).png().toBuffer()
  const result = await evaluateImageQuality(variedBuf)
  assert.equal(result.passed, true)
  assert.equal(result.defect, null)
  assert.ok(result.score >= 0.5)
})

test('executeWithQualityGate: passes through immediately when quality is good', async () => {
  const sharp = (await import('sharp')).default
  const goodRaw = Buffer.alloc(32 * 32)
  for (let i = 0; i < goodRaw.length; i++) goodRaw[i] = (i * 43) % 256
  const goodBuf = await sharp(goodRaw, { raw: { width: 32, height: 32, channels: 1 } }).png().toBuffer()

  let callCount = 0
  const generateFn = async (seed) => {
    callCount++
    return { seed, bytes: goodBuf, width: 32, height: 32 }
  }

  const { generated, qualityReport } = await executeWithQualityGate(generateFn, {
    initialSeed: 12345,
    enabled: true,
  })

  assert.equal(callCount, 1)
  assert.equal(qualityReport.passed, true)
  assert.equal(qualityReport.rerolls, 0)
  assert.equal(generated.seed, 12345)
})

test('executeWithQualityGate: performs silent re-roll when first attempt fails', async () => {
  const sharp = (await import('sharp')).default
  const badBuf = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer()
  const goodRaw = Buffer.alloc(32 * 32)
  for (let i = 0; i < goodRaw.length; i++) goodRaw[i] = (i * 17) % 256
  const goodBuf = await sharp(goodRaw, { raw: { width: 32, height: 32, channels: 1 } }).png().toBuffer()

  let callCount = 0
  const generateFn = async (seed) => {
    callCount++
    if (callCount === 1) {
      return { seed, bytes: badBuf, width: 32, height: 32 }
    }
    return { seed, bytes: goodBuf, width: 32, height: 32 }
  }

  const { generated, qualityReport } = await executeWithQualityGate(generateFn, {
    initialSeed: 100,
    enabled: true,
    maxRerolls: 2,
  })

  assert.equal(callCount, 2)
  assert.equal(qualityReport.passed, true)
  assert.equal(qualityReport.rerolls, 1)
  assert.notEqual(generated.seed, 100) // Changed seed on re-roll
})

test('executeWithQualityGate: respects enabled=false and skips checking', async () => {
  const badBuf = Buffer.alloc(1024, 0)
  const generateFn = async (seed) => ({ seed, bytes: badBuf })

  const { qualityReport } = await executeWithQualityGate(generateFn, {
    initialSeed: 55,
    enabled: false,
  })

  assert.equal(qualityReport.passed, true)
  assert.equal(qualityReport.skipped, true)
  assert.equal(qualityReport.rerolls, 0)
})

test('pipeline regression: generate_image inspects raw bytes without false positive retries (#353)', async () => {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const os = await import('node:os')
  const { registerGenerationTools } = await import('../lib/tools/generation.js')
  const { readHistory } = await import('../lib/history.js')

  const testDir = path.join(os.tmpdir(), 'qg_regress_' + Date.now())
  const prevDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = testDir

  try {
    // 1. Build a valid high-entropy PNG buffer via sharp
    const sharp = (await import('sharp')).default
    const validPng = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .composite([{ input: Buffer.from([0, 255, 0, 255, 0, 0, 255, 255]), raw: { width: 2, height: 1, channels: 4 } }])
      .png()
      .toBuffer()

    let apiCalls = 0
    const mockFetch = async () => {
      apiCalls++
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ b64_json: validPng.toString('base64') }],
        }),
      }
    }

    const registeredTools = []
    const mockCtx = {
      effect: (fn) => fn(),
      tools: { register: (t) => registeredTools.push(t) },
      get: () => null,
      logger: () => {},
    }

    const mockDeps = {
      config: {
        enabled: true,
        provider: 'custom',
        customBaseURL: 'https://api.mock.test/v1',
        customModel: 'dall-e-3',
        qualityGate: true,
        defaultSize: 'square',
        defaultFormat: 'png',
        diskCache: false,
        outputDir: path.join(testDir, 'out'),
      },
      live: () => mockDeps.config,
      resolveSource: async () => undefined,
      slugify: (s) => 'qg-test',
      resolveApiKey: async () => 'mock-key',
    }

    // Temporarily stub global fetch
    const prevFetch = globalThis.fetch
    globalThis.fetch = mockFetch

    try {
      registerGenerationTools(mockCtx, mockDeps)
      const tool = registeredTools.find((t) => t.name === 'generate_image')
      assert.ok(tool, 'generate_image must be registered')

      const execContext = {
        signal: new AbortController().signal,
        agent: { session: { header: { cwd: testDir } } },
      }

      // Execute on valid PNG with quality_gate = true
      const res = await tool.execute({
        prompt: 'a vibrant landscape with mountains',
        seed: 100,
        quality_gate: true,
      }, execContext)

      // CRITICAL AUDIT VERIFICATIONS:
      // 1. Exactly 1 API call made (NOT 3)
      assert.equal(apiCalls, 1, 'Valid PNG must pass on first attempt without 3x retry loop')

      // 2. Seed must remain the user requested seed (100, NOT changed to 2126)
      assert.equal(res.seed, 100, 'Seed must match initial seed when quality gate passes')

      // 3. Quality report passed without rerolls
      assert.ok(res.qualityReport, 'qualityReport must be present')
      assert.equal(res.qualityReport.passed, true, 'Quality gate must pass')
      assert.equal(res.qualityReport.rerolls, 0, 'Rerolls must be 0 for valid PNG')
      assert.equal(res.qualityReport.attempts, 1, 'Attempts must be 1')
      assert.equal(res.qualityReport.exhausted, undefined, 'Must not be exhausted')

      // 4. Exactly 1 history entry written (NOT 3)
      const history = await readHistory()
      assert.equal(history.length, 1, 'History must contain exactly 1 entry')
    } finally {
      globalThis.fetch = prevFetch
    }
  } finally {
    if (prevDshHome !== undefined) process.env.DSH_HOME = prevDshHome
    else delete process.env.DSH_HOME
    try { await fs.rm(testDir, { recursive: true, force: true }) } catch (_err) { /* cleanup */ }
  }
})

test('pipeline regression: defective buffer triggers silent reroll and saves chosen artifact (#353)', async () => {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const os = await import('node:os')
  const { registerGenerationTools } = await import('../lib/tools/generation.js')
  const { readHistory } = await import('../lib/history.js')

  const testDir = path.join(os.tmpdir(), 'qg_reroll_' + Date.now())
  const prevDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = testDir

  try {
    // Blank buffer (defect) for attempt 1, valid buffer for attempt 2
    const sharp = (await import('sharp')).default
    const blankPng = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer()
    const validPng = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .composite([{ input: Buffer.from([0, 255, 0, 255, 0, 0, 255, 255]), raw: { width: 2, height: 1, channels: 4 } }])
      .png()
      .toBuffer()

    let apiCalls = 0
    const mockFetch = async () => {
      apiCalls++
      const buf = apiCalls === 1 ? blankPng : validPng
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ b64_json: buf.toString('base64') }],
        }),
      }
    }

    const registeredTools = []
    const mockCtx = {
      effect: (fn) => fn(),
      tools: { register: (t) => registeredTools.push(t) },
      get: () => null,
      logger: () => {},
    }

    const mockDeps = {
      config: {
        enabled: true,
        provider: 'custom',
        customBaseURL: 'https://api.mock.test/v1',
        customModel: 'dall-e-3',
        qualityGate: true,
        defaultSize: 'square',
        defaultFormat: 'png',
        diskCache: false,
        outputDir: path.join(testDir, 'out'),
      },
      live: () => mockDeps.config,
      resolveSource: async () => undefined,
      slugify: (s) => 'qg-reroll',
      resolveApiKey: async () => 'mock-key',
    }

    const prevFetch = globalThis.fetch
    globalThis.fetch = mockFetch

    try {
      registerGenerationTools(mockCtx, mockDeps)
      const tool = registeredTools.find((t) => t.name === 'generate_image')

      const execContext = {
        signal: new AbortController().signal,
        agent: { session: { header: { cwd: testDir } } },
      }

      const res = await tool.execute({
        prompt: 'a mountain sunset',
        seed: 100,
        quality_gate: true,
      }, execContext)

      // 1st attempt defective -> rerolled once -> 2nd attempt passed
      assert.equal(apiCalls, 2, 'Must perform exactly 1 silent reroll')
      assert.equal(res.qualityReport.passed, true)
      assert.equal(res.qualityReport.rerolls, 1)
      assert.equal(res.qualityReport.attempts, 2)
      assert.notEqual(res.seed, 100, 'Seed must update to the accepted rerolled seed')

      // Exactly 1 history entry saved (the accepted one)
      const history = await readHistory()
      assert.equal(history.length, 1, 'Only the accepted artifact is saved to history')
    } finally {
      globalThis.fetch = prevFetch
    }
  } finally {
    if (prevDshHome !== undefined) process.env.DSH_HOME = prevDshHome
    else delete process.env.DSH_HOME
    try { await fs.rm(testDir, { recursive: true, force: true }) } catch (_err) { /* cleanup */ }
  }
})
