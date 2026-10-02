import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeBbox,
  buildTextInpaintMaskSvg,
  buildTextOverlaySvg,
} from '../lib/vision-ocr-helpers.js'
import { registerVisionOcrTools } from '../lib/tools/vision-ocr.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(here, '..', 'lib')

test('vision-ocr: normalizeBbox parses arrays and strings and clamps safely', () => {
  assert.deepEqual(normalizeBbox([100, 200, 500, 600]), [100, 200, 500, 600])
  assert.deepEqual(normalizeBbox('[50, 80, 400, 250]'), [50, 80, 400, 250])
  assert.deepEqual(normalizeBbox('100,200,300,400'), [100, 200, 300, 400])

  // Normalizes large pixel coordinates
  const pixelNorm = normalizeBbox([1200, 400, 1800, 600], 2000, 1000)
  assert.deepEqual(pixelNorm, [600, 400, 900, 600])

  assert.equal(normalizeBbox(null), null)
  assert.equal(normalizeBbox([10, 20]), null)
})

test('vision-ocr: buildTextInpaintMaskSvg produces valid black-and-white inpaint mask', () => {
  const svg = buildTextInpaintMaskSvg(800, 600, [[100, 200, 500, 300]])
  assert.ok(svg.includes('width="800"'))
  assert.ok(svg.includes('height="600"'))
  assert.ok(svg.includes('fill="#000000"'))
  assert.ok(svg.includes('fill="#FFFFFF"'))
  assert.ok(svg.includes('<rect'))
})

test('vision-ocr: buildTextOverlaySvg renders styled text nodes with XML escaping', () => {
  const svg = buildTextOverlaySvg(1000, 1000, [
    { text: 'Hello <World> & Co', bbox: [200, 300, 800, 400], color: '#FFCC00' }
  ])
  assert.ok(svg.includes('Hello &lt;World&gt; &amp; Co'))
  assert.ok(svg.includes('fill="#FFCC00"'))
  assert.ok(svg.includes('text-anchor="middle"'))
  assert.ok(svg.includes('<text'))
})

test('vision-ocr: tool file declares replace_image_text with valid schema and render (#180)', () => {
  const src = fs.readFileSync(path.join(lib, 'tools', 'vision-ocr.js'), 'utf8')
  assert.match(src, /name:\s*'replace_image_text'/)
  assert.match(src, /image:\s*\{/)
  assert.match(src, /replacements:\s*\{/)
  assert.match(src, /additionalProperties:\s*true/)

  const registered = []
  const mockCtx = {
    effect(fn) { fn() },
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
  }

  registerVisionOcrTools(mockCtx, {
    live: { value: {} },
    resolveSource: async () => ({ bytes: Buffer.alloc(10), mediaType: 'image/png' }),
    slugify: (s) => s.toLowerCase().replace(/\s+/g, '-'),
    resolveApiKey: () => 'fake-key',
  })

  assert.equal(registered.length, 1)
  const tool = registered[0]
  assert.equal(tool.name, 'replace_image_text')
  assert.equal(typeof tool.output.render, 'function')
  assert.equal(tool.output.schema.type, 'object')
  assert.equal(tool.output.schema.additionalProperties, true)

  const sampleRender = tool.output.render(null, {
    summary: 'OK',
    replacedCount: 2,
    bboxes: [[100, 200, 400, 300], [500, 600, 800, 700]],
  })
  assert.ok(Array.isArray(sampleRender))
  assert.equal(sampleRender[0]?.text, 'OK')
  assert.ok(sampleRender.length >= 1)
})

test('vision-ocr: registered execute runs through OCR grounding, inpaint, composite and storage (#360)', async () => {
  const registered = []
  const mockCtx = {
    effect(fn) { fn() },
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
    logger: {
      warn() {},
      info() {},
    },
  }

  const liveConfig = {
    enabled: true,
    provider: 'fal',
    outputDir: 'tmp-vision-ocr-test',
    dailyBudgetUsd: 10,
    model: 'fal-ai/flux-2/klein/9b',
  }

  const mockSourcePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

  registerVisionOcrTools(mockCtx, {
    live: () => liveConfig,
    resolveSource: async () => ({
      bytes: mockSourcePng,
      mediaType: 'image/png',
      width: 800,
      height: 600,
      ref: 'test-source.png',
    }),
    slugify: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey: () => 'fake-key',
  })

  const tool = registered[0]
  assert.ok(tool)

  const originalFetch = globalThis.fetch
  const mockInpaintedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5])
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.includes('fal-ai/flux')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ request_id: 'r1', status_url: 'https://q/status', response_url: 'https://q/result' }),
      }
    }
    if (s === 'https://q/status') {
      return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED', response_url: 'https://q/result' }) }
    }
    if (s === 'https://q/result') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ images: [{ url: 'https://example.com/inpainted.png', width: 800, height: 600 }], seed: 42 }),
      }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => mockInpaintedPng.buffer.slice(mockInpaintedPng.byteOffset, mockInpaintedPng.byteOffset + mockInpaintedPng.byteLength),
    }
  }

  try {
    const result = await tool.execute({
      image: 'test-source.png',
      replacements: [
        { find: 'Old Title', replace: 'New Title', bbox: [100, 100, 400, 200] },
      ],
      target_language: 'ru',
      seed: 42,
    }, {
      signal: new AbortController().signal,
      agent: { session: { header: { cwd: process.cwd() } } },
    })

    assert.ok(result)
    assert.equal(result.replacedCount, 1)
    assert.equal(result.targetLanguage, 'ru')
    assert.equal(result.provider, 'fal')
    assert.ok(result.path)
    assert.ok(result.attachment)
    assert.ok(result.maskAttachment)
    assert.ok(result.overlayAttachment)
  } finally {
    globalThis.fetch = originalFetch
  }
})
