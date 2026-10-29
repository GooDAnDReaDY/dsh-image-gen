// @ts-check
// test/wireframe-design.test.mjs — tests for render_wireframe_asset tool (#455).
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import {
  DESIGN_SYSTEM_PRESETS,
  SUPPORTED_DESIGN_SYSTEMS,
  registerWireframeDesignTools,
} from '../lib/tools/wireframe-design.js'

const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==',
  'base64',
)

test('render_wireframe_asset: all 4 design systems are defined with descriptive styling (#455)', () => {
  assert.deepEqual(SUPPORTED_DESIGN_SYSTEMS.sort(), [
    'apple_minimal',
    'brutalist',
    'dark_glassmorphism',
    'modern_saas',
  ])
  for (const key of SUPPORTED_DESIGN_SYSTEMS) {
    const preset = DESIGN_SYSTEM_PRESETS[key]
    assert.ok(preset.name, `Preset ${key} must have name`)
    assert.ok(preset.prompt, `Preset ${key} must have prompt`)
    assert.ok(preset.prompt.length > 30, `Preset ${key} prompt must be detailed`)
  }
})

test('render_wireframe_asset: tool registers with schema and renders output (#455)', () => {
  let registeredTool = null
  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) { registeredTool = def },
    },
  }

  registerWireframeDesignTools(ctx, {
    live: () => ({ enabled: true }),
    saveAndAttachResult: async () => {},
    slugify: (s) => s,
    resolveApiKey: async () => 'test-key',
  })

  assert.ok(registeredTool, 'render_wireframe_asset must be registered')
  assert.equal(registeredTool.name, 'render_wireframe_asset')
  assert.ok(registeredTool.parameters.properties.wireframe_image)
  assert.ok(registeredTool.parameters.properties.design_system)
  assert.ok(registeredTool.parameters.properties.fidelity)
  assert.ok(typeof registeredTool.output.render === 'function')

  const rendered = registeredTool.output.render(null, {
    summary: 'Rendered Modern SaaS wireframe asset',
    path: '/path/to/asset.png',
  })
  assert.ok(Array.isArray(rendered))
  assert.ok(rendered.length >= 1)
})

test('render_wireframe_asset: executes synthesis with preset, applies calibrated fidelity (#455)', async () => {
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

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'wireframe-test-'))
  const wireframePath = path.join(tmpDir, 'sketch-layout.png')
  await writeFile(wireframePath, TEST_PNG)

  let attachedMeta = null
  const deps = {
    live: () => ({ enabled: true, provider: 'fal', outputDir: tmpDir }),
    saveAndAttachResult: async (_ctx, _exec, _cfg, meta) => {
      attachedMeta = meta
      return {
        path: path.join(tmpDir, meta.name),
        url: `file://${path.join(tmpDir, meta.name)}`,
        attachment: { attachmentId: 'att-wireframe', url: 'https://test-cdn.local/wireframe.png' },
      }
    },
    slugify: (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey: async () => 'test-api-key',
  }

  registerWireframeDesignTools(ctx, deps)

  // Mock global fetch for fal img2img provider
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('requests/')) {
      return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED', response_url: 'https://cdn/wireframe.png' }) }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => TEST_PNG.buffer.slice(TEST_PNG.byteOffset, TEST_PNG.byteOffset + TEST_PNG.byteLength),
      json: async () => ({
        request_id: 'req-wireframe-1',
        status_url: 'https://queue.fal.run/requests/req-wireframe-1/status',
        response_url: 'https://cdn/wireframe.png',
        images: [{ url: 'https://cdn/wireframe.png', width: 512, height: 512 }],
        seed: 777,
      }),
    }
  }

  const execCtx = {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: tmpDir }, id: 'sess-wireframe' } },
  }

  try {
    const result = await registeredTool.execute(
      {
        wireframe_image: wireframePath,
        design_system: 'dark_glassmorphism',
        fidelity: 0.7,
        style: 'fintech neon indicators',
        prompt: 'Crypto portfolio card with buy and sell action buttons',
      },
      execCtx,
    )

    assert.equal(result.designSystem, 'dark_glassmorphism')
    assert.equal(result.fidelity, 0.7)
    // Denoise strength: 1.0 - (0.7 * 0.65) = 1.0 - 0.455 = 0.54 or 0.55
    assert.ok(result.strength <= 0.6 && result.strength >= 0.5)
    assert.ok(attachedMeta, 'saveAndAttachResult must be invoked')
    assert.equal(attachedMeta.action, 'wireframe_to_design')
    assert.ok(attachedMeta.prompt.includes('Dark Glassmorphism'))
    assert.ok(attachedMeta.prompt.includes('Crypto portfolio card'))
  } finally {
    globalThis.fetch = origFetch
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
})

