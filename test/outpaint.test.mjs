// @ts-check
// test/outpaint.test.mjs — tests for outpaint_image tool (#459).
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import {
  buildOutpaintMaskSvg,
  registerOutpaintTools,
} from '../lib/tools/outpaint.js'

const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==',
  'base64',
)

test('outpaint_image: buildOutpaintMaskSvg generates valid SVG with black core and white perimeter (#459)', () => {
  const svg = buildOutpaintMaskSvg(1200, 800, 200, 100, 800, 600, 16)
  assert.ok(svg.includes('width="1200"'))
  assert.ok(svg.includes('height="800"'))
  assert.ok(svg.includes('fill="#FFFFFF"'), 'Perimeter must be white for inpaint synthesis')
  assert.ok(svg.includes('fill="#000000"'), 'Core must be black to preserve original content')
  // Keep rectangle coordinates
  assert.ok(svg.includes('x="216"'))
  assert.ok(svg.includes('y="116"'))
})

test('outpaint_image: tool registers with schema and renders output (#459)', () => {
  let registeredTool = null
  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) { registeredTool = def },
    },
  }

  registerOutpaintTools(ctx, {
    live: () => ({ enabled: true }),
    saveAndAttachResult: async () => {},
    slugify: (s) => s,
    resolveApiKey: async () => 'test-key',
  })

  assert.ok(registeredTool, 'outpaint_image must be registered')
  assert.equal(registeredTool.name, 'outpaint_image')
  assert.ok(registeredTool.parameters.properties.image)
  assert.ok(registeredTool.parameters.properties.prompt)
  assert.ok(registeredTool.parameters.properties.directions)
  assert.ok(typeof registeredTool.output.render === 'function')

  const rendered = registeredTool.output.render(null, {
    summary: 'Canvas expanded to 1200x800',
    path: '/path/to/outpaint.png',
  })
  assert.ok(Array.isArray(rendered))
  assert.ok(rendered.length >= 1)
})

test('outpaint_image: executes directional canvas expansion, produces mask and saves asset (#459)', async () => {
  let registeredTool = null
  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) { registeredTool = def },
    },
    logger: {
      debug() {},
      warn() {},
      info() {},
    },
    attachments: {
      async saveImage({ bytes, mediaType, name }) {
        return {
          attachment: {
            attachmentId: `att-${name}`,
            url: `https://test-cdn.local/${name}`,
            mediaType,
            width: 512,
            height: 512,
          },
          localUrl: `https://test-cdn.local/${name}`,
        }
      },
    },
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'outpaint-test-'))
  const testImgPath = path.join(tmpDir, 'source.png')
  await writeFile(testImgPath, TEST_PNG)

  let attachedMeta = null
  const deps = {
    live: () => ({ enabled: true, provider: 'fal', outputDir: tmpDir }),
    saveAndAttachResult: async (_ctx, _exec, _cfg, meta) => {
      attachedMeta = meta
      return {
        path: path.join(tmpDir, meta.name),
        url: `file://${path.join(tmpDir, meta.name)}`,
        attachment: { attachmentId: 'att-outpaint', url: 'https://test-cdn.local/outpaint.png' },
      }
    },
    slugify: (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey: async () => 'test-api-key',
  }

  registerOutpaintTools(ctx, deps)

  const execCtx = {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: tmpDir }, id: 'sess-outpaint' } },
  }

  try {
    const result = await registeredTool.execute(
      {
        image: testImgPath,
        prompt: 'Lush tropical forest expanding on both sides with misty mountains in background',
        directions: { left: 120, right: 120, top: 40, bottom: 40 },
      },
      execCtx,
    )

    assert.ok(result.width > 0)
    assert.ok(result.height > 0)
    assert.ok(result.maskAttachment, 'Must generate and attach outpaint mask')
    assert.ok(attachedMeta, 'saveAndAttachResult must be invoked')
    assert.equal(attachedMeta.action, 'outpainted')
    assert.ok(attachedMeta.prompt.includes('Lush tropical forest'))
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
})

