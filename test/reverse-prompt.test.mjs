// @ts-check
// test/reverse-prompt.test.mjs — Test suite for reverse_prompt_and_recreate tool (#465).

import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  deconstructImageAesthetics,
  synthesizeReversePrompt,
  formatReversePromptMarkdown,
} from '../lib/reverse-prompt-helpers.js'
import { registerReversePromptTools } from '../lib/tools/reverse-prompt.js'

test('reverse-prompt: deconstructImageAesthetics extracts lighting, optics, and palette mood', async () => {
  // Synthetic high-key warm image (200x100)
  const syntheticImg = await sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 240, g: 200, b: 180 } },
  }).png().toBuffer()

  const analysis = await deconstructImageAesthetics(syntheticImg)
  assert.ok(analysis.lighting.includes('high-key'))
  assert.ok(analysis.optics.includes('anamorphic') || analysis.optics.includes('cinematic'))
  assert.ok(analysis.paletteMood.includes('warm') || analysis.paletteMood.includes('natural'))
  assert.ok(analysis.brightness > 175)
  assert.ok(Array.isArray(analysis.dominantHexes))
  assert.equal(analysis.dominantHexes.length, 3)
})

test('reverse-prompt: synthesizeReversePrompt combines aesthetics with custom subject and modifications', () => {
  const mockAesthetics = {
    lighting: 'dramatic volumetric rim lighting',
    optics: '85mm f/1.4 telephoto lens',
    paletteMood: 'cyberpunk neon palette',
    composition: 'centered portrait framing',
    medium: 'editorial digital masterpiece',
    sharpnessLevel: 'ultra-high micro-contrast',
    brightness: 80,
    saturationRatio: 0.5,
    dominantHexes: ['#ff0055', '#00ffcc', '#112233'],
  }

  const { extractedPrompt, negativePrompt } = synthesizeReversePrompt({
    aesthetics: mockAesthetics,
    baseSubject: 'cybernetic android samurai',
    styleModifications: 'add gold filigree accents',
  })

  assert.ok(extractedPrompt.includes('cybernetic android samurai'))
  assert.ok(extractedPrompt.includes('dramatic volumetric rim lighting'))
  assert.ok(extractedPrompt.includes('85mm f/1.4 telephoto lens'))
  assert.ok(extractedPrompt.includes('[artistic adjustment: add gold filigree accents]'))
  assert.ok(negativePrompt.includes('blurry'))
  assert.ok(negativePrompt.includes('low quality'))
})

test('reverse-prompt: formatReversePromptMarkdown renders structured markdown', () => {
  const md = formatReversePromptMarkdown({
    extractedPrompt: 'cinematic cyberpunk samurai, volumetric rim light',
    negativePrompt: 'blurry, deformed',
    aesthetics: {
      lighting: 'volumetric light',
      optics: '50mm prime',
      paletteMood: 'neon magenta and cyan',
      composition: 'rule of thirds',
      sharpnessLevel: 'crisp focus',
      brightness: 120,
      saturationRatio: 0.3,
      dominantHexes: ['#112233', '#445566', '#778899'],
      medium: 'editorial digital masterpiece',
    },
    recreatedPath: '/assets/recreated-123.png',
    recreatedId: 'att-999',
    recreated: true,
  })

  assert.ok(md.includes('Reverse Prompt & Aesthetic Reconstruction'))
  assert.ok(md.includes('Deconstructed Aesthetics'))
  assert.ok(md.includes('Recovered Prompt'))
  assert.ok(md.includes('Recommended Negative Prompt'))
  assert.ok(md.includes('/assets/recreated-123.png'))
  assert.ok(md.includes('att-999'))
})

test('reverse-prompt: tool execute analyzes reference image and synthesizes recreation', async () => {
  let registeredTool = null
  const fakeCtx = {
    effect: (fn) => fn(),
    tools: {
      register: (tool) => {
        registeredTool = tool
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }

  const samplePng = await sharp({
    create: { width: 128, height: 128, channels: 3, background: { r: 100, g: 150, b: 200 } },
  }).png().toBuffer()

  const deps = {
    live: () => ({ enabled: true, provider: 'fal' }),
    resolveSource: async (_c, _e, ref) => ({
      path: typeof ref === 'string' ? ref : 'sample.png',
      bytes: samplePng,
    }),
    resolveApiKey: () => 'fake-key',
  }

  registerReversePromptTools(fakeCtx, deps)
  assert.ok(registeredTool, 'Tool must be registered')
  assert.equal(registeredTool.name, 'reverse_prompt_and_recreate')

  // Mock global fetch for FAL backend
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('requests/')) {
      return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED', response_url: 'https://queue.fal.run/res' }) }
    }
    if (u === 'https://queue.fal.run/res') {
      return { ok: true, status: 200, json: async () => ({ images: [{ url: 'https://cdn/recreated.png', width: 512, height: 512 }], seed: 42 }) }
    }
    if (u === 'https://cdn/recreated.png') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => samplePng.buffer.slice(samplePng.byteOffset, samplePng.byteOffset + samplePng.byteLength),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        request_id: 'req-mock-1',
        status_url: 'https://queue.fal.run/requests/req-mock-1/status',
        response_url: 'https://queue.fal.run/res',
        images: [{ url: 'https://cdn/recreated.png', width: 512, height: 512 }],
        seed: 42,
      }),
    }
  }

  try {
    const res = await registeredTool.execute(
      {
        image: 'ref.png',
        style_modifications: 'oil painting texture',
        subject: 'mystic forest lake',
        recreate: true,
      },
      {}
    )

    assert.equal(res.recreated, true)
    assert.ok(res.extracted_prompt.includes('mystic forest lake'))
    assert.ok(res.extracted_prompt.includes('oil painting texture'))
    assert.ok(res.aesthetics)

    // Verify render
    const rendered = registeredTool.output.render({}, res)
    assert.ok(rendered[0].text.includes('Reverse Prompt & Aesthetic Reconstruction'))
    assert.ok(rendered[0].text.includes('<dsh-image-gen-reverse-prompt>'))
  } finally {
    globalThis.fetch = origFetch
  }
})