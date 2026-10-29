// @ts-check
// test/semantic-router.test.mjs — Test suite for Smart prompt-to-model semantic router (#462).

import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import {
  classifyPromptIntent,
  resolveOptimalProvider,
} from '../lib/semantic-router.js'
import { registerGenerationTools } from '../lib/tools/generation.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==',
  'base64',
)

test('semantic-router: classifyPromptIntent classifies typography with quotes or lettering keywords', () => {
  const r1 = classifyPromptIntent('a neon signboard saying "OPEN 24 HOURS" on rainy street')
  assert.equal(r1.intent, 'typography')
  assert.ok(r1.confidence >= 0.7)
  assert.equal(r1.hasQuotedText, true)

  const r2 = classifyPromptIntent('vintage t-shirt graphic with bold font and typography slogan')
  assert.equal(r2.intent, 'typography')
  assert.ok(r2.matchedKeywords.includes('typography'))
})

test('semantic-router: classifyPromptIntent classifies photorealism, vector_icon, and schematics', () => {
  const photo = classifyPromptIntent('candid 35mm dslr portrait photograph of an elderly fisherman with realistic skin texture')
  assert.equal(photo.intent, 'photorealism')
  assert.ok(photo.matchedKeywords.includes('photograph') || photo.matchedKeywords.includes('35mm'))

  const vector = classifyPromptIntent('minimalist flat vector icon of a cloud server, clean svg style, symbol')
  assert.equal(vector.intent, 'vector_icon')
  assert.ok(vector.matchedKeywords.includes('vector') || vector.matchedKeywords.includes('icon'))

  const diagram = classifyPromptIntent('architectural blueprint schematic flowchart of data center cooling')
  assert.equal(diagram.intent, 'diagram_schematic')

  const draft = classifyPromptIntent('quick rough sketch and draft thumbnail doodle of a robot')
  assert.equal(draft.intent, 'fast_draft')

  const general = classifyPromptIntent('an ancient mythical dragon sleeping in obsidian cave')
  assert.equal(general.intent, 'general_art')
})

test('semantic-router: resolveOptimalProvider selects optimal provider and model based on intent and available providers', () => {
  const available = ['fal', 'gemini', 'custom', 'local']

  // 1. Typography -> fal/flux/dev
  const typoRoute = resolveOptimalProvider({
    prompt: 'billboard with text "DISCOVER FUTURE"',
    cfg: { provider: 'fal' },
    availableProviders: available,
  })
  assert.equal(typoRoute.detected_intent, 'typography')
  assert.equal(typoRoute.selected_provider, 'fal')
  assert.equal(typoRoute.selected_model, 'fal-ai/flux/dev')
  assert.ok(typoRoute.reasoning.includes('FLUX'))

  // 2. Vector icon -> fal/recraft-v3
  const vectorRoute = resolveOptimalProvider({
    prompt: 'flat vector icon glyph for shopping cart',
    cfg: { provider: 'fal' },
    availableProviders: available,
  })
  assert.equal(vectorRoute.detected_intent, 'vector_icon')
  assert.equal(vectorRoute.selected_provider, 'fal')
  assert.equal(vectorRoute.selected_model, 'fal-ai/recraft-v3')

  // 3. Fast draft -> local
  const draftRoute = resolveOptimalProvider({
    prompt: 'quick rough draft sketch of a chair',
    cfg: { provider: 'fal' },
    availableProviders: available,
  })
  assert.equal(draftRoute.detected_intent, 'fast_draft')
  assert.equal(draftRoute.selected_provider, 'local')

  // 4. Custom override mapping in config
  const customOverrideRoute = resolveOptimalProvider({
    prompt: 'neon typography letters on wall',
    cfg: {
      provider: 'fal',
      semanticRouting: {
        typography: { provider: 'gemini', model: 'imagen-custom-v1' },
      },
    },
    availableProviders: available,
  })
  assert.equal(customOverrideRoute.selected_provider, 'gemini')
  assert.equal(customOverrideRoute.selected_model, 'imagen-custom-v1')
})

test('semantic-router: generate_image routes automatically with model: "auto" or provider: "auto" and returns diagnostics', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-router-test-'))
  let registeredTool = null

  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) { registeredTool = def },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  }

  const liveConfig = {
    enabled: true,
    provider: 'fal',
    defaultSize: 'square_hd',
    defaultFormat: 'png',
    outputDir: tmpDir,
    dailyBudgetUsd: 10,
  }

  registerGenerationTools(ctx, {
    config: liveConfig,
    live: () => liveConfig,
    slugify: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey: () => 'mock-fal-key',
    resolveSource: async () => undefined,
  }, { coreOnly: true })

  assert.ok(registeredTool)
  assert.equal(registeredTool.name, 'generate_image')

  // Mock global fetch
  const origFetch = globalThis.fetch
  let capturedModelUrl = ''
  globalThis.fetch = async (url, opts) => {
    capturedModelUrl = String(url)
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
      json: async () => ({
        request_id: 'req-mock-1',
        status_url: 'https://queue.fal.run/requests/req-mock-1/status',
        response_url: 'https://queue.fal.run/res',
        images: [{ url: 'https://cdn/img.png', width: 512, height: 512 }],
        seed: 42,
      }),
    }
  }

  try {
    const result = await registeredTool.execute({
      prompt: 'a stylish coffee mug with typography quote saying "CODE AND COFFEE"',
      model: 'auto',
      output_dir: tmpDir,
    }, {
      agent: { session: { header: { cwd: tmpDir } } },
    })

    assert.ok(result.router, 'Output must include router diagnostics')
    assert.equal(result.router.auto_routed, true)
    assert.equal(result.router.detected_intent, 'typography')
    assert.equal(result.router.selected_provider, 'fal')
    assert.equal(result.router.selected_model, 'fal-ai/flux/dev')
    assert.ok(result.router.reasoning.includes('typography') || result.router.reasoning.includes('FLUX'))

    // Verify render includes Smart Router tip
    const rendered = registeredTool.output.render({}, result)
    assert.ok(Array.isArray(rendered))
    assert.ok(rendered[0].text.includes('Smart Router'))
    assert.ok(rendered[0].text.includes('fal-ai/flux/dev'))
  } finally {
    globalThis.fetch = origFetch
    await rm(tmpDir, { recursive: true, force: true })
  }
})

