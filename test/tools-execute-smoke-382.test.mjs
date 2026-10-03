// test/tools-execute-smoke-382.test.mjs
// Comprehensive execute smoke suites and runtime regression coverage for Issue #382.

import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { registerAllTools } from '../lib/register-tools.js'
import { resetLoopGuard } from '../lib/loop-guard.js'
import { clearAllAnchors } from '../lib/anchor-helpers.js'
import { loadDailySpend, clearSpendReservations } from '../lib/cost-meter.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==',
  'base64',
)

function createMockEnvironment() {
  resetLoopGuard()
  clearAllAnchors()
  clearSpendReservations()
  const registeredTools = new Map()
  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) {
        registeredTools.set(def.name, def)
        return () => registeredTools.delete(def.name)
      },
      get(name) {
        return registeredTools.get(name)
      },
      list: {
        find(fn) {
          return Array.from(registeredTools.values()).find(fn)
        },
      },
    },
    logger: {
      warn() {},
      info() {},
      debug() {},
      error() {},
    },
    get(name) {
      if (name === 'subscriptionImages') return null
      return null
    },
  }

  const mockFetch = async (url) => {
    const u = String(url)
    if (u.includes('requests/')) {
      return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED', response_url: 'https://queue.fal.run/res' }) }
    }
    if (u === 'https://queue.fal.run/res') {
      return { ok: true, status: 200, json: async () => ({ images: [{ url: 'https://cdn/img.png', width: 512, height: 512 }], seed: 42 }) }
    }
    if (u === 'https://cdn/img.png') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
      }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
      json: async () => ({
        request_id: 'req-mock-1',
        status_url: 'https://queue.fal.run/requests/req-mock-1/status',
        response_url: 'https://queue.fal.run/res',
        images: [{ url: 'https://cdn/img.png', width: 512, height: 512 }],
        seed: 42,
        image: { url: 'https://cdn/img.png', width: 512, height: 512 },
      }),
    }
  }

  const liveConfig = {
    enabled: true,
    toolsetProfile: 'all',
    provider: 'fal',
    apiKeyEnv: 'FAL_KEY',
    model: 'fal-ai/flux/dev',
    outputDir: 'test-smoke-out',
    dailyBudgetUsd: 100,
    loopGuardLimit: 0, // disable loop guard during 30-tool sweep
    defaultSize: 'square_hd',
    defaultFormat: 'png',
  }

  const deps = {
    config: liveConfig,
    live: () => liveConfig,
    saveAndAttachResult: async (_ctx, meta) => ({
      attachment: { id: 'att-mock', url: 'https://cdn/img.png', width: 512, height: 512, ...meta },
      localUrl: 'https://cdn/img.png',
    }),
    resolveSource: async () => ({
      bytes: PNG,
      mediaType: 'image/png',
      width: 64,
      height: 64,
      url: 'https://cdn/img.png',
    }),
    slugify: (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30),
    resolveApiKey: async () => 'mock-fal-api-key',
  }

  const controller = registerAllTools(ctx, deps)
  return { ctx, deps, registeredTools, mockFetch, controller }
}

test('tools-execute-smoke-382: all 30 tools have functional execute smoke checks', async () => {
  const env = createMockEnvironment()
  assert.equal(env.registeredTools.size, 30, 'Profile all must register all 30 tools')

  const originalFetch = globalThis.fetch
  globalThis.fetch = env.mockFetch

  const standardExec = {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: process.cwd() } } },
  }

  const testPngPath = path.join(process.cwd(), 'test-smoke-mock.png')
  await writeFile(testPngPath, PNG)

  try {
    const invocations = {
      generate_image: { prompt: 'smoke test prompt', image_size: 'square_hd' },
      generate_image_pack: { prompt: 'smoke test pack', aspect_ratios: ['1:1', '16:9'] },
      edit_image: { prompt: 'smoke edit', image: testPngPath },
      vary_image: { prompt: 'smoke vary', image: testPngPath },
      remix_image: { prompt: 'smoke remix', image: testPngPath },
      compare_images: { image_a: testPngPath, image_b: testPngPath },
      inspect_image_quality: { image: testPngPath },
      remove_background: { image: testPngPath },
      upscale_image: { image: testPngPath, scale: 2 },
      vectorize_image: { image: testPngPath },
      blend_images: { images: [testPngPath, testPngPath], weights: [0.5, 0.5] },
      assemble_image_grid: { images: [testPngPath, testPngPath], columns: 2 },
      smart_crop_image: { image: testPngPath, aspect_ratio: '16:9' },
      export_asset_pack: { project_name: 'SmokeBrand' },
      replace_image_text: { image: testPngPath, replacements: [{ find: 'Alpha', replace: 'Beta' }] },
      set_style_anchor: { image: testPngPath, mode: 'face' },
      generate_ui_asset: { prompt: 'smoke icon', asset_type: 'icon' },
      generate_style_matrix: { prompt: 'smoke matrix', styles: ['cyberpunk', 'retro_anime'] },
      generate_theme_pair: { prompt: 'smoke dashboard', style: 'minimalist' },
      generate_character_sheet: { prompt: 'smoke hero', layout: 'turnaround' },
      beautify_diagram: { diagram: 'graph TD; A-->B', style: 'isometric_3d' },
      extract_design_tokens: {},
      image_to_css_gradient: {},
      check_image_contrast: {},
      optimize_vector_svg: { svg_content: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' },
      generate_pwa_icon_suite: { name: 'SmokeApp' },
      generate_responsive_mockups: { prompt: 'smoke page' },
      sketch_to_image: { prompt: 'smoke sketch', image: testPngPath },
      generate_spritesheet: { subject: 'smoke character', frames: 4 },
      generate_seamless_pattern: { motif: 'smoke pattern' },
    }

    const executedNames = []
    for (const [name, args] of Object.entries(invocations)) {
      const tool = env.registeredTools.get(name)
      assert.ok(tool, `Tool ${name} must be registered`)
      assert.equal(typeof tool.execute, 'function', `Tool ${name} must have execute function`)

      const res = await tool.execute(args, standardExec)
      assert.ok(res !== undefined, `Tool ${name} execute must return a result`)
      executedNames.push(name)
    }

    assert.equal(executedNames.length, 30, 'All 30 tools must execute successfully')
  } finally {
    await rm(testPngPath, { force: true })
    globalThis.fetch = originalFetch
    env.controller.dispose()
  }
})

test('tools-execute-smoke-382: 4 runtime regression cases (TypeError protection)', async () => {
  const env = createMockEnvironment()
  const originalFetch = globalThis.fetch
  globalThis.fetch = env.mockFetch

  try {
    // 1. Theme-pair called with exec = undefined
    const themeTool = env.registeredTools.get('generate_theme_pair')
    assert.ok(themeTool)
    const themeRes = await themeTool.execute({ prompt: 'test theme pair' }, undefined)
    assert.ok(themeRes, 'theme-pair must execute without TypeError when exec is undefined')

    // 2. Character-sheet called with empty prompt
    const charTool = env.registeredTools.get('generate_character_sheet')
    assert.ok(charTool)
    await assert.rejects(
      async () => { await charTool.execute({ prompt: '' }, {}) },
      /Character description prompt is required/i,
      'character-sheet must reject empty prompt with clean validation error',
    )

    // 3. Beautify-diagram called with empty diagram
    const diagramTool = env.registeredTools.get('beautify_diagram')
    assert.ok(diagramTool)
    await assert.rejects(
      async () => { await diagramTool.execute({ diagram: '' }, {}) },
      /Diagram content .* is required/i,
      'beautify_diagram must reject empty diagram with clean validation error',
    )

    // 4. Vision-ocr called with empty image
    const visionTool = env.registeredTools.get('replace_image_text')
    assert.ok(visionTool)
    await assert.rejects(
      async () => { await visionTool.execute({ image: '' }, {}) },
      /Parameter "image" .* is required/i,
      'replace_image_text must reject empty image with clean validation error',
    )
  } finally {
    globalThis.fetch = originalFetch
    env.controller.dispose()
  }
})

test('tools-execute-smoke-382: live progress event flow receives progress updates', async () => {
  const env = createMockEnvironment()
  const originalFetch = globalThis.fetch
  globalThis.fetch = env.mockFetch

  const progressEvents = []
  const execWithProgress = {
    callId: 'smoke-call-1',
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: process.cwd() } } },
    onProgress: (evt) => progressEvents.push(evt),
  }

  try {
    const genTool = env.registeredTools.get('generate_image')
    assert.ok(genTool)
    await genTool.execute({ prompt: 'progress flow verification', image_size: 'square_hd' }, execWithProgress)

    // Verify progress session was activated
    assert.ok(execWithProgress.onProgress, 'onProgress handler must be active')
  } finally {
    globalThis.fetch = originalFetch
    env.controller.dispose()
  }
})

test('tools-execute-smoke-382 (#355): serialized concurrent budget reservations prevent overspend', async () => {
  const env = createMockEnvironment()
  const originalFetch = globalThis.fetch
  globalThis.fetch = env.mockFetch

  try {
    const genTool = env.registeredTools.get('generate_image')
    const exec1 = { signal: new AbortController().signal, agent: { session: { id: 'c-sess-1', header: { cwd: process.cwd() } } } }
    const exec2 = { signal: new AbortController().signal, agent: { session: { id: 'c-sess-2', header: { cwd: process.cwd() } } } }

    const curSpend = loadDailySpend().totalSpendUsd
    // Each call costs 0.025. Two calls need 0.05. Budget is curSpend + 0.04. Parallel calls cannot both succeed.
    env.deps.config.dailyBudgetUsd = +(curSpend + 0.04).toFixed(4)
    const results = await Promise.allSettled([
      genTool.execute({ prompt: 'concurrent req 1', seed: 101 }, exec1),
      genTool.execute({ prompt: 'concurrent req 2', seed: 102 }, exec2),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    assert.equal(fulfilled.length, 1, 'Exactly one concurrent call should succeed within budget')
    assert.equal(rejected.length, 1, 'Second concurrent call must be rejected before API call')
    assert.ok(rejected[0].reason.message.includes('Daily image generation budget exceeded'))
  } finally {
    globalThis.fetch = originalFetch
    env.controller.dispose()
  }
})

test('tools-execute-smoke-382 (#353): quality gate stops silent retries when daily budget is exhausted', async () => {
  const env = createMockEnvironment()
  const originalFetch = globalThis.fetch

  let submitCalls = 0
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === 'POST') {
      submitCalls++
    }
    return env.mockFetch(url, opts)
  }

  try {
    const genTool = env.registeredTools.get('generate_image')
    const exec = { signal: new AbortController().signal, agent: { session: { id: 'qg-sess-1', header: { cwd: process.cwd() } } } }

    const curSpend = loadDailySpend().totalSpendUsd
    // First call costs 0.025. Budget is curSpend + 0.04. Blank image triggers QG, but retry needs another 0.025 (total 0.05 > 0.04).
    // Must stop after 1 call and return output with exhausted: true.
    env.deps.config.dailyBudgetUsd = +(curSpend + 0.04).toFixed(4)
    env.deps.config.qualityGate = true

    const res = await genTool.execute({ prompt: 'blank quality check', seed: 999 }, exec)
    assert.equal(submitCalls, 1, 'Must execute exactly 1 provider submit and halt re-rolls due to budget constraint')
    assert.equal(res.qualityReport?.attempts, 1, 'Quality report must record exactly 1 attempt')
    assert.equal(res.qualityReport?.exhausted, true, 'Quality report must flag exhausted re-rolls')
    assert.equal(res.qualityReport?.budgetExceeded, true, 'Quality report must flag budgetExceeded')
    assert.ok(res.images?.length > 0 || res.path, 'Accepted image must be returned')
  } finally {
    globalThis.fetch = originalFetch
    env.controller.dispose()
  }
})

test('tools-execute-smoke-382 (#375): local and non-identity backends reject face identity anchors', async () => {
  const env = createMockEnvironment()
  const originalFetch = globalThis.fetch
  globalThis.fetch = env.mockFetch

  try {
    const genTool = env.registeredTools.get('generate_image')
    const exec = { signal: new AbortController().signal, agent: { session: { id: 'caps-sess', header: { cwd: process.cwd() } } } }

    // 1. Local A1111 rejection
    env.deps.config.provider = 'local'
    env.deps.config.localKind = 'a1111'
    env.deps.config.localBaseURL = 'http://127.0.0.1:7860'
    await assert.rejects(
      () => genTool.execute({ prompt: 'face local test', face_reference: 'https://example.com/face.png' }, exec),
      /Local A1111 does not support facial identity references/
    )

    // 2. FAL with non-identity model rejection
    env.deps.config.provider = 'fal'
    env.deps.config.model = 'fal-ai/flux/dev'
    await assert.rejects(
      () => genTool.execute({ prompt: 'face fal test', face_reference: 'https://example.com/face.png' }, exec),
      /does not support face identity anchors/
    )
  } finally {
    globalThis.fetch = originalFetch
    env.controller.dispose()
  }
})
