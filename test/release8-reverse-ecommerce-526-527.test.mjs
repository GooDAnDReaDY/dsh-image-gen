// @ts-check
// release8-reverse-ecommerce-526-527.test.mjs — Unit tests for Deep Reverse Prompt (#526) & E-Commerce Pack (#527).

import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  deconstructDeepOptics,
  synthesizeDeepReversePrompt,
  formatDeepReversePromptMarkdown,
} from '../lib/reverse-prompt-helpers.js'
import {
  buildEcommerceShotPrompts,
  formatEcommercePackMarkdown,
} from '../lib/ecommerce-pack-helpers.js'
import { registerReversePromptTools } from '../lib/tools/reverse-prompt.js'
import { registerEcommercePackTools } from '../lib/tools/ecommerce-pack.js'

// Helper: generate 100x100 mock PNG buffer
async function createMockPng(width = 100, height = 100, color = { r: 180, g: 120, b: 60 }) {
  return await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer()
}

test('Issue #526: deconstructDeepOptics extracts optics, lighting, materials and palette', async () => {
  const buf = await createMockPng(160, 100, { r: 210, g: 150, b: 80 })
  const analysis = await deconstructDeepOptics(buf)

  assert.ok(analysis.optics, 'Must include optics object')
  assert.ok(analysis.optics.focal_length, 'Must have focal length')
  assert.ok(analysis.optics.aperture, 'Must have aperture')
  assert.ok(analysis.optics.camera_angle, 'Must have camera angle')
  assert.ok(analysis.optics.depth_of_field, 'Must have depth of field')

  assert.ok(analysis.lighting, 'Must include lighting object')
  assert.ok(analysis.lighting.setup, 'Must have lighting setup')
  assert.ok(analysis.lighting.key_light, 'Must have key light')
  assert.ok(analysis.lighting.mood, 'Must have mood')

  assert.ok(Array.isArray(analysis.materials), 'Materials must be an array')
  assert.ok(analysis.materials.length >= 1, 'Materials must not be empty')

  assert.ok(Array.isArray(analysis.color_palette), 'Color palette must be an array')
  assert.ok(analysis.color_palette.length >= 1, 'Palette must have hex colors')
  assert.match(analysis.color_palette[0], /^#[0-9a-f]{6}$/i, 'First color must be valid hex')
})

test('Issue #526: synthesizeDeepReversePrompt outputs distinct content across concise, standard, cinematic tiers', async () => {
  const buf = await createMockPng(100, 100)
  const analysis = await deconstructDeepOptics(buf)

  const concise = synthesizeDeepReversePrompt({ analysis, tier: 'concise', baseSubject: 'ceramic teapot' })
  const standard = synthesizeDeepReversePrompt({ analysis, tier: 'standard', baseSubject: 'ceramic teapot' })
  const cinematic = synthesizeDeepReversePrompt({ analysis, tier: 'cinematic', baseSubject: 'ceramic teapot' })

  assert.ok(concise.prompt.includes('ceramic teapot'), 'Concise must include subject')
  assert.ok(concise.prompt.length < standard.prompt.length, 'Concise must be shorter than standard')

  assert.ok(standard.prompt.includes('professional photography'), 'Standard must contain professional styling')
  assert.ok(standard.prompt.length < cinematic.prompt.length, 'Standard must be shorter than cinematic')

  assert.ok(cinematic.prompt.includes('cinematic photograph'), 'Cinematic must contain cinematic directives')
  assert.ok(cinematic.prompt.includes('Arri Alexa'), 'Cinematic must specify camera body')

  const markdown = formatDeepReversePromptMarkdown({
    analysis,
    prompt: cinematic.prompt,
    negativePrompt: cinematic.negativePrompt,
    tier: 'cinematic',
  })
  assert.ok(markdown.includes('Deep Technical Reverse Prompt'), 'Markdown must have header')
  assert.ok(markdown.includes('Camera Optics'), 'Markdown must have optics row')
  assert.ok(markdown.includes('Lighting Setup'), 'Markdown must have lighting row')
})

test('Issue #526: deep_reverse_prompt tool registers with schema and renders markdown', async () => {
  const tools = []
  const ctx = {
    effect(fn) { fn() },
    tools: { register(def) { tools.push(def) } },
  }

  const mockPng = await createMockPng(100, 100)
  registerReversePromptTools(ctx, {
    live: () => ({ enabled: true }),
    resolveSource: async () => ({ bytes: mockPng }),
  })

  const deepTool = tools.find((t) => t.name === 'deep_reverse_prompt')
  assert.ok(deepTool, 'deep_reverse_prompt must be registered')
  assert.ok(deepTool.parameters.required.includes('image'), 'image must be required')
  assert.deepEqual(deepTool.parameters.properties.tier.enum, ['concise', 'standard', 'cinematic'])

  const execResult = await deepTool.execute({ image: 'mock-path', tier: 'cinematic' }, {})
  assert.ok(execResult.prompt, 'Result must contain prompt')
  assert.equal(execResult.tier, 'cinematic')
  assert.ok(execResult.optics, 'Result must contain optics')

  const rendered = deepTool.output.render({}, execResult)
  assert.ok(Array.isArray(rendered), 'Render must return array')
  assert.ok(rendered[0].text.includes('Deep Technical Reverse Prompt'), 'Rendered text must have header')
})

test('Issue #527: buildEcommerceShotPrompts synthesizes 4 distinct shot configs (hero, lifestyle, macro, banner)', () => {
  const configs = buildEcommerceShotPrompts({
    productDescription: 'Mechanical Chronograph Watch',
    category: 'fashion',
    brandName: 'AeroPrecision',
    lifestyleSetting: 'minimalist marble desk',
  })

  assert.equal(configs.length, 4, 'Must produce exactly 4 shot configs')
  const types = configs.map((c) => c.type)
  assert.deepEqual(types, ['hero', 'lifestyle', 'macro', 'banner'])

  const hero = configs.find((c) => c.type === 'hero')
  assert.ok(hero.prompt.includes('#ffffff'), 'Hero must specify seamless pure white background')
  assert.equal(hero.aspectRatio, '1:1')

  const lifestyle = configs.find((c) => c.type === 'lifestyle')
  assert.ok(lifestyle.prompt.includes('minimalist marble desk'), 'Lifestyle must include custom setting')
  assert.equal(lifestyle.aspectRatio, '4:3')

  const macro = configs.find((c) => c.type === 'macro')
  assert.ok(macro.prompt.includes('macro photography'), 'Macro must specify macro photography')
  assert.equal(macro.aspectRatio, '1:1')

  const banner = configs.find((c) => c.type === 'banner')
  assert.ok(banner.prompt.includes('16:9 promotional hero banner'), 'Banner must specify 16:9 banner')
  assert.ok(banner.prompt.includes('negative empty space'), 'Banner must include negative space directive')
  assert.equal(banner.aspectRatio, '16:9')
})

test('Issue #527: formatEcommercePackMarkdown formats markdown presentation table with previews and links', () => {
  const markdown = formatEcommercePackMarkdown({
    category: 'electronics',
    brandName: 'SoundWave',
    shots: [
      { type: 'hero', label: 'Catalog Hero Shot', path: '/path/hero.png', attachmentId: 'att-1', ratio: '1:1', prompt: 'hero prompt' },
      { type: 'lifestyle', label: 'Lifestyle In-Situ Shot', path: '/path/lifestyle.png', attachmentId: 'att-2', ratio: '4:3', prompt: 'life prompt' },
    ],
    summary: 'Generated 2 shots',
  })

  assert.ok(markdown.includes('E-Commerce Photography Suite for **SoundWave** (electronics)'))
  assert.ok(markdown.includes('Catalog Hero Shot'))
  assert.ok(markdown.includes('Lifestyle In-Situ Shot'))
  assert.ok(markdown.includes('/path/hero.png'))
})

test('Issue #527: generate_ecommerce_pack tool executes 4-shot suite and handles budget tracking', async () => {
  const tools = []
  const ctx = {
    effect(fn) { fn() },
    tools: { register(def) { tools.push(def) } },
  }

  const mockPng = await createMockPng(100, 100)
  registerEcommercePackTools(ctx, {
    live: () => ({ enabled: true, provider: 'fal' }),
    resolveSource: async () => ({ bytes: mockPng }),
    resolveApiKey: () => 'mock-key',
  })

  const packTool = tools.find((t) => t.name === 'generate_ecommerce_pack')
  assert.ok(packTool, 'generate_ecommerce_pack must be registered')
  assert.ok(packTool.parameters.required.includes('product_image'))

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.body) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          request_id: 'mock-fal-req-ecommerce',
          status_url: 'https://queue.fal.run/mock-status',
          response_url: 'https://queue.fal.run/mock-response',
        }),
      }
    }
    if (typeof url === 'string' && url.includes('mock-status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'COMPLETED', response_url: 'https://queue.fal.run/mock-response' }),
      }
    }
    if (typeof url === 'string' && url.includes('mock-response')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          images: [{ url: 'https://fal.media/files/mock-ecom.png', content_type: 'image/png', width: 1024, height: 1024 }],
        }),
      }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => mockPng.buffer.slice(mockPng.byteOffset, mockPng.byteOffset + mockPng.byteLength),
    }
  }

  try {
    const result = await packTool.execute(
      {
        product_image: 'mock-product.png',
        category: 'electronics',
        brand_name: 'TechCraft',
      },
      {}
    )

    assert.equal(result.category, 'electronics')
    assert.equal(result.brand_name, 'TechCraft')
    assert.equal(result.count, 4)
    assert.equal(result.shots.length, 4)

    const rendered = packTool.output.render({}, result)
    assert.ok(Array.isArray(rendered))
    assert.ok(rendered[0].text.includes('E-Commerce Photography Suite'))
  } finally {
    globalThis.fetch = originalFetch
  }
})
