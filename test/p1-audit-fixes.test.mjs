// test/p1-audit-fixes.test.mjs
// Regression test suite for P1 issues:
// Issue #404: Cache identity (effective model & source bytes)
// Issue #405: Release budget reservations on failure
// Issue #406: Prevent JSX expression injection in SVG to TSX export

import test from 'node:test'
import assert from 'node:assert/strict'
import { computeGenerationHash } from '../lib/provider-utils.js'
import { findCached, findCachedByPrompt } from '../lib/history.js'
import {
  reserveSpend,
  getTotalActiveReservations,
  clearSpendReservations,
  loadDailySpend,
  recordSpend,
} from '../lib/cost-meter.js'
import { optimizeSvgContent, escapeJsxText } from '../lib/frontend-assets.js'
import { registerProcessingTools } from '../lib/tools/processing-basic.js'
import { registerCharacterSheetTools } from '../lib/tools/character-sheet.js'
import { registerUiAssetTools } from '../lib/tools/ui-asset.js'
import { registerVisionOcrTools } from '../lib/tools/vision-ocr.js'
import { registerDiagramTools } from '../lib/tools/diagram.js'
import { registerGenerationTools } from '../lib/tools/generation.js'
import { resetLoopGuard } from '../lib/loop-guard.js'
import { clearAllAnchors } from '../lib/anchor-helpers.js'

const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==',
  'base64',
)

// =========================================================================
// ISSUE #406: Prevent JSX expression injection in SVG to TSX export
// =========================================================================

test('Issue #406: escapeJsxText converts curly braces outside attributes to HTML entities', () => {
  const input = '<text>{globalThis.__auditMarker = true}</text>'
  const escaped = escapeJsxText(input)
  assert.equal(escaped, '<text>&#123;globalThis.__auditMarker = true&#125;</text>')

  // Attributes with quotes remain untouched
  const withAttr = '<rect id="box-{1}" class="sample" />'
  assert.equal(escapeJsxText(withAttr), '<rect id="box-{1}" class="sample" />')

  // Multiple expressions and nested elements
  const complex = '<g><text>{user.name}</text><text x="10">{40 + 2}</text></g>'
  assert.equal(escapeJsxText(complex), '<g><text>&#123;user.name&#125;</text><text x="10">&#123;40 + 2&#125;</text></g>')
})

test('Issue #406: optimizeSvgContent escapes JSX expressions so audit marker code does not execute', () => {
  const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <text>{globalThis.__auditMarker = true}</text>
  </svg>`

  const result = optimizeSvgContent(maliciousSvg, { componentName: 'SafeMarkerIcon' })

  // The generated TSX must contain the escaped entity and not raw expression
  assert.ok(result.reactTsx.includes('&#123;globalThis.__auditMarker = true&#125;'), 'Must encode curly braces as entities')
  assert.ok(!result.reactTsx.includes('<text>{globalThis.__auditMarker = true}</text>'), 'Must not contain raw JSX expression')

  // Verify that globalThis.__auditMarker is not set
  assert.equal(globalThis.__auditMarker, undefined, 'Marker must not be evaluated during optimization')

  // Verify standard sanitization remains active
  const withScripts = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
    <script>alert(2)</script>
    <a href="javascript:alert(3)"><text>{alert(4)}</text></a>
  </svg>`
  const sanitized = optimizeSvgContent(withScripts, { componentName: 'SanitizedIcon' })
  assert.ok(!sanitized.reactTsx.includes('onload='))
  assert.ok(!sanitized.reactTsx.includes('<script'))
  assert.ok(!sanitized.reactTsx.includes('javascript:'))
  assert.ok(sanitized.reactTsx.includes('&#123;alert(4)&#125;'))
})

// =========================================================================
// ISSUE #405: Release budget reservations on processing failures
// =========================================================================

test('Issue #405: remove_background releases reservation on provider error', async () => {
  clearSpendReservations()
  const initialSpend = loadDailySpend().totalSpendUsd

  const registeredTools = new Map()
  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) { registeredTools.set(def.name, def) },
    },
    logger: { warn() {}, error() {} },
  }

  const liveConfig = {
    enabled: true,
    provider: 'fal',
    dailyBudgetUsd: 10.0,
    outputDir: 'test-out',
  }

  const originalFetch = globalThis.fetch
  // Mock fetch that throws network failure
  globalThis.fetch = async () => {
    throw new Error('Network timeout to fal.ai endpoint')
  }

  try {
    registerProcessingTools(ctx, {
      config: liveConfig,
      live: () => liveConfig,
      resolveSource: async () => ({ bytes: MOCK_PNG, mediaType: 'image/png' }),
      slugify: (s) => s,
      resolveApiKey: async () => 'mock-key',
    })

    const tool = registeredTools.get('remove_background')
    assert.ok(tool, 'remove_background must be registered')

    // Executing the tool with simulated failure must reject
    await assert.rejects(
      async () => await tool.execute({ image: 'mock.png' }, { signal: new AbortController().signal }),
      /Network timeout to fal.ai endpoint/
    )

    // Critical assertion: active reservations must be zero!
    assert.equal(getTotalActiveReservations(), 0, 'Must have 0 active reservations after failure')

    // Persisted daily spend must not have increased
    assert.equal(loadDailySpend().totalSpendUsd, initialSpend, 'Failed operation must not increment persisted spend')
  } finally {
    globalThis.fetch = originalFetch
    clearSpendReservations()
  }
})

test('Issue #405: upscale_image releases reservation on provider error', async () => {
  clearSpendReservations()
  const initialSpend = loadDailySpend().totalSpendUsd

  const registeredTools = new Map()
  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) { registeredTools.set(def.name, def) },
    },
    logger: { warn() {}, error() {} },
  }

  const liveConfig = {
    enabled: true,
    provider: 'fal',
    dailyBudgetUsd: 10.0,
    outputDir: 'test-out',
  }

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('Internal server error 500 from clarity upscaler')
  }

  try {
    registerProcessingTools(ctx, {
      config: liveConfig,
      live: () => liveConfig,
      resolveSource: async () => ({ bytes: MOCK_PNG, mediaType: 'image/png' }),
      slugify: (s) => s,
      resolveApiKey: async () => 'mock-key',
    })

    const tool = registeredTools.get('upscale_image')
    assert.ok(tool, 'upscale_image must be registered')

    await assert.rejects(
      async () => await tool.execute({ image: 'mock.png', scale: 2 }, { signal: new AbortController().signal }),
      /Internal server error 500/
    )

    assert.equal(getTotalActiveReservations(), 0, 'Must have 0 active reservations after upscale failure')
    assert.equal(loadDailySpend().totalSpendUsd, initialSpend, 'Failed upscale must not increment spend')
  } finally {
    globalThis.fetch = originalFetch
    clearSpendReservations()
  }
})

test('Issue #405: blend_images releases reservation on validation error and provider failure', async () => {
  clearSpendReservations()
  const initialSpend = loadDailySpend().totalSpendUsd

  const registeredTools = new Map()
  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) { registeredTools.set(def.name, def) },
    },
    logger: { warn() {}, error() {} },
  }

  const liveConfig = {
    enabled: true,
    provider: 'fal',
    dailyBudgetUsd: 10.0,
    outputDir: 'test-out',
  }

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('Blend engine connection dropped')
  }

  try {
    registerProcessingTools(ctx, {
      config: liveConfig,
      live: () => liveConfig,
      resolveSource: async () => ({ bytes: MOCK_PNG, mediaType: 'image/png' }),
      slugify: (s) => s,
      resolveApiKey: async () => 'mock-key',
    })

    const tool = registeredTools.get('blend_images')
    assert.ok(tool, 'blend_images must be registered')

    // Test A: Validation failure with only 1 image
    await assert.rejects(
      async () => await tool.execute({ images: ['img1.png'] }, { signal: new AbortController().signal }),
      /At least two images are required/
    )
    assert.equal(getTotalActiveReservations(), 0, 'Active reservations must be 0 after validation error')

    // Test B: Provider error with 2 images
    await assert.rejects(
      async () => await tool.execute({ images: ['img1.png', 'img2.png'] }, { signal: new AbortController().signal }),
      /Blend engine connection dropped/
    )
    assert.equal(getTotalActiveReservations(), 0, 'Active reservations must be 0 after provider failure')
    assert.equal(loadDailySpend().totalSpendUsd, initialSpend, 'Spend must not increase')
  } finally {
    globalThis.fetch = originalFetch
    clearSpendReservations()
  }
})

// =========================================================================
// ISSUE #404: Cache identity with effective model and source bytes
// =========================================================================

test('Issue #404: computeGenerationHash differentiates model and source image bytes', () => {
  const base = {
    provider: 'custom',
    model: 'dall-e-3',
    prompt: 'serene mountain landscape',
    seed: 42,
    size: '1024x1024',
    format: 'png',
    aspectRatio: '1:1',
  }

  const hBase = computeGenerationHash(base)

  // Changing model produces different hash
  const hNewModel = computeGenerationHash({ ...base, model: 'gpt-image-1' })
  assert.notEqual(hBase, hNewModel, 'Hash must differ when model changes')

  // Changing sourceImage bytes produces different hash
  const hSource1 = computeGenerationHash({ ...base, sourceImage: Buffer.from([1, 2, 3, 4]) })
  const hSource2 = computeGenerationHash({ ...base, sourceImage: Buffer.from([1, 2, 3, 99]) })
  assert.notEqual(hSource1, hSource2, 'Hash must differ when source bytes change')

  // Identical bytes produce identical hash
  const hSource1Copy = computeGenerationHash({ ...base, sourceImage: Buffer.from([1, 2, 3, 4]) })
  assert.equal(hSource1, hSource1Copy, 'Identical source bytes must produce matching hash')
})

test('Issue #404: findCached invalidates when model or source bytes differ', async () => {
  const entries = [
    {
      seed: 100,
      prompt: 'futuristic city',
      provider: 'custom',
      model: 'model-v1',
      format: 'png',
      aspectRatio: '1:1',
      sourceHash: 'sha256-bytes-v1',
      cacheHash: 'hash-entry-1',
      path: '/tmp/nonexistent-img.png',
    },
  ]

  // 1. Same seed and prompt, but different model -> MUST REJECT (return undefined)
  const byDifferentModel = await findCached(entries, 100, 'futuristic city', {
    provider: 'custom',
    model: 'model-v2',
    format: 'png',
    aspectRatio: '1:1',
    sourceHash: 'sha256-bytes-v1',
  })
  assert.equal(byDifferentModel, undefined, 'Must reject cache when model differs')

  // 2. Same seed and prompt, but different sourceHash -> MUST REJECT
  const byDifferentSource = await findCached(entries, 100, 'futuristic city', {
    provider: 'custom',
    model: 'model-v1',
    format: 'png',
    aspectRatio: '1:1',
    sourceHash: 'sha256-bytes-v2',
  })
  assert.equal(byDifferentSource, undefined, 'Must reject cache when source image bytes differ')

  // 3. Same seed and prompt, but different cacheHash -> MUST REJECT
  const byDifferentHash = await findCached(entries, 100, 'futuristic city', {
    provider: 'custom',
    model: 'model-v1',
    cacheHash: 'hash-entry-different',
    format: 'png',
    aspectRatio: '1:1',
    sourceHash: 'sha256-bytes-v1',
  })
  assert.equal(byDifferentHash, undefined, 'Must reject cache when cacheHash differs')

  // 4. Same seed, prompt, model, sourceHash, format, and aspect ratio -> MUST MATCH
  const matching = await findCached(entries, 100, 'futuristic city', {
    provider: 'custom',
    model: 'model-v1',
    format: 'png',
    aspectRatio: '1:1',
    sourceHash: 'sha256-bytes-v1',
    cacheHash: 'hash-entry-1',
  })
  assert.ok(matching, 'Must find matching entry when model, bytes, and criteria match')
  assert.equal(matching.seed, 100)
  assert.equal(matching.prompt, 'futuristic city')
})

test('Issue #404: findCachedByPrompt invalidates when model or source bytes differ', async () => {
  const entries = [
    {
      prompt: 'neon cat',
      provider: 'fal',
      model: 'fal-ai/flux/dev',
      format: 'png',
      aspectRatio: '16:9',
      sourceHash: 'sha256-original',
      cacheHash: 'cache-neon-cat',
      path: '/tmp/cat.png',
    },
  ]

  // Model change invalidates
  const diffModel = await findCachedByPrompt(entries, 'neon cat', {
    provider: 'fal',
    model: 'fal-ai/flux/schnell',
    format: 'png',
    aspectRatio: '16:9',
    sourceHash: 'sha256-original',
  })
  assert.equal(diffModel, undefined, 'findCachedByPrompt must reject when model changes')

  // Source bytes change invalidates
  const diffSource = await findCachedByPrompt(entries, 'neon cat', {
    provider: 'fal',
    model: 'fal-ai/flux/dev',
    format: 'png',
    aspectRatio: '16:9',
    sourceHash: 'sha256-modified',
  })
  assert.equal(diffSource, undefined, 'findCachedByPrompt must reject when source bytes change')

  // Matching criteria returns entry
  const hit = await findCachedByPrompt(entries, 'neon cat', {
    provider: 'fal',
    model: 'fal-ai/flux/dev',
    format: 'png',
    aspectRatio: '16:9',
    sourceHash: 'sha256-original',
  })
  assert.ok(hit, 'findCachedByPrompt must match when model and sourceHash align')
})
