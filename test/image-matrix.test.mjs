// @ts-check
// test/image-matrix.test.mjs — Test suite for generate_image_matrix tool (#461).

import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import {
  buildVariationPlan,
  createTileBadgeSvg,
  compositeContactSheet,
  formatImageMatrixMarkdown,
} from '../lib/image-matrix-helpers.js'
import { registerImageMatrixTools } from '../lib/tools/image-matrix.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==',
  'base64',
)

test('image-matrix: buildVariationPlan generates deterministic seed sequence for count=4 and count=9', () => {
  const plan4 = buildVariationPlan({
    prompt: 'cyberpunk street',
    count: 4,
    vary: 'seed',
    baseSeed: 1000,
  })

  assert.equal(plan4.gridRows, 2)
  assert.equal(plan4.gridCols, 2)
  assert.equal(plan4.variants.length, 4)
  assert.equal(plan4.variants[0].seed, 1000)
  assert.equal(plan4.variants[1].seed, 2013)
  assert.equal(plan4.variants[2].seed, 3026)
  assert.equal(plan4.variants[3].seed, 4039)
  assert.ok(plan4.variants[0].label.includes('Seed: 1000'))

  const plan9 = buildVariationPlan({
    prompt: 'cyberpunk street',
    count: 9,
    vary: 'seed',
    baseSeed: 5000,
  })
  assert.equal(plan9.gridRows, 3)
  assert.equal(plan9.gridCols, 3)
  assert.equal(plan9.variants.length, 9)
  assert.equal(plan9.variants[0].seed, 5000)
  assert.equal(plan9.variants[8].seed, 5000 + 8 * 1013)
})

test('image-matrix: buildVariationPlan generates guidance scale range for vary="cfg"', () => {
  const plan = buildVariationPlan({
    prompt: 'neon katana',
    count: 4,
    vary: 'cfg',
    baseSeed: 42,
  })

  assert.equal(plan.variants.length, 4)
  assert.equal(plan.variants[0].guidanceScale, 3.5)
  assert.equal(plan.variants[1].guidanceScale, 7.0)
  assert.equal(plan.variants[2].guidanceScale, 10.5)
  assert.equal(plan.variants[3].guidanceScale, 14.0)
  assert.ok(plan.variants[0].label.includes('CFG: 3.5'))
})

test('image-matrix: compositeContactSheet renders 2x2 grid with overlay badges', async () => {
  // Generate 4 colored tile buffers
  const tileBuffers = await Promise.all([
    sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(),
    sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } }).png().toBuffer(),
    sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toBuffer(),
    sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 255, b: 0, alpha: 1 } } }).png().toBuffer(),
  ])

  const tiles = [
    { bytes: tileBuffers[0], label: '[V1] Seed: 1000' },
    { bytes: tileBuffers[1], label: '[V2] Seed: 2013' },
    { bytes: tileBuffers[2], label: '[V3] Seed: 3026' },
    { bytes: tileBuffers[3], label: '[V4] Seed: 4039' },
  ]

  const sheet = await compositeContactSheet({
    tiles,
    tileWidth: 100,
    tileHeight: 100,
    rows: 2,
    cols: 2,
  })

  assert.ok(Buffer.isBuffer(sheet))
  const meta = await sharp(sheet).metadata()
  assert.equal(meta.width, 200)
  assert.equal(meta.height, 200)
  assert.equal(meta.format, 'png')
})

test('image-matrix: tool generate_image_matrix executes end-to-end and saves contact sheet + manifest', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-matrix-test-'))
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
    outputDir: tmpDir,
    dailyBudgetUsd: 10,
  }

  registerImageMatrixTools(ctx, {
    live: () => liveConfig,
    slugify: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey: () => 'mock-fal-key',
  })

  assert.ok(registeredTool)
  assert.equal(registeredTool.name, 'generate_image_matrix')

  // Mock global fetch for FAL queue
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
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
      prompt: 'a futuristic solar observatory on moon',
      count: 4,
      vary: 'seed',
      base_seed: 7777,
      aspect_ratio: '1:1',
      output_dir: tmpDir,
    }, {
      agent: { session: { header: { cwd: tmpDir } } },
    })

    assert.ok(result.matrix_id)
    assert.equal(result.count, 4)
    assert.equal(result.vary, 'seed')
    assert.equal(result.grid.rows, 2)
    assert.equal(result.grid.cols, 2)
    assert.equal(result.variants.length, 4)
    assert.ok(result.contact_sheet.path)
    assert.ok(result.manifest_path)

    // Verify manifest contents on disk
    const manifestJson = JSON.parse(await readFile(result.manifest_path, 'utf-8'))
    assert.equal(manifestJson.matrix_id, result.matrix_id)
    assert.equal(manifestJson.variants.length, 4)
    assert.equal(manifestJson.variants[0].seed, 7777)

    // Test renderer
    const rendered = registeredTool.output.render({}, result)
    assert.ok(Array.isArray(rendered))
    assert.ok(rendered[0].text.includes('Image Variation Matrix (4 Variants'))
    assert.ok(rendered[0].text.includes('<dsh-image-gen-matrix>'))
  } finally {
    globalThis.fetch = origFetch
    await rm(tmpDir, { recursive: true, force: true })
  }
})

