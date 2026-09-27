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
