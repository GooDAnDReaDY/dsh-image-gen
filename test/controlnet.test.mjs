// @ts-check
// test/controlnet.test.mjs — Test suite for generate_with_control tool (#463).

import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import {
  preprocessControlImage,
  buildControlPrompt,
  formatControlNetMarkdown,
} from '../lib/controlnet-helpers.js'
import { registerControlNetTools } from '../lib/tools/controlnet.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==',
  'base64',
)

test('controlnet: preprocessControlImage handles canny, depth, pose, and sketch modes', async () => {
  // Synthetic 128x128 image with center square
  const testInput = await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{
      input: await sharp({
        create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
      }).png().toBuffer(),
      top: 44,
      left: 44,
    }])
    .png()
    .toBuffer()

  // 1. Canny
  const canny = await preprocessControlImage(testInput, 'canny')
  assert.equal(canny.mode, 'canny')
  assert.equal(canny.width, 128)
  assert.equal(canny.height, 128)
  assert.ok(Buffer.isBuffer(canny.controlMapBuffer))

  // 2. Depth
  const depth = await preprocessControlImage(testInput, 'depth')
  assert.equal(depth.mode, 'depth')
  assert.ok(Buffer.isBuffer(depth.controlMapBuffer))

  // 3. Pose
  const pose = await preprocessControlImage(testInput, 'pose')
  assert.equal(pose.mode, 'pose')

  // 4. Sketch
  const sketch = await preprocessControlImage(testInput, 'sketch')
  assert.equal(sketch.mode, 'sketch')
})

test('controlnet: buildControlPrompt injects appropriate mode directive', () => {
  const p1 = buildControlPrompt('cyberpunk car', 'canny', 0.9)
  assert.ok(p1.includes('precise structural contour alignment'))
  assert.ok(p1.includes('strict'))

  const p2 = buildControlPrompt('hero pose', 'pose', 0.6)
  assert.ok(p2.includes('exact anatomical pose alignment'))
  assert.ok(p2.includes('calibrated'))
})

test('controlnet: formatControlNetMarkdown produces clean markdown presentation', () => {
  const md = formatControlNetMarkdown({
    prompt: 'warrior standing',
    mode: 'pose',
    controlStrength: 0.85,
    controlMapUrl: 'https://cdn/map.png',
    finalImageUrl: 'https://cdn/out.png',
    path: '/path/out.png',
    seed: 42,
  })

  assert.ok(md.includes('ControlNet Guided Generation (POSE)'))
  assert.ok(md.includes('![Control Map]'))
  assert.ok(md.includes('![Generated Output]'))
  assert.ok(md.includes('`0.85`'))
})

test('controlnet: tool generate_with_control executes end-to-end and saves control map + final image', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-control-test-'))
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

  // Create a real PNG file for control input
  const inputImagePath = path.join(tmpDir, 'input-geometry.png')
  const testInput = await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).png().toBuffer()
  await writeFile(inputImagePath, testInput)

  registerControlNetTools(ctx, {
    live: () => liveConfig,
    slugify: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey: () => 'mock-fal-key',
  })

  assert.ok(registeredTool)
  assert.equal(registeredTool.name, 'generate_with_control')

  // Mock global fetch
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
      control_image: inputImagePath,
      prompt: 'a futuristic architectural pavilion with glowing arches',
      mode: 'canny',
      control_strength: 0.85,
      output_dir: tmpDir,
    }, {
      agent: { session: { header: { cwd: tmpDir } } },
    })

    assert.equal(result.mode, 'canny')
    assert.equal(result.control_strength, 0.85)
    assert.ok(result.control_map.path)
    assert.ok(result.image.path)

    // Verify files on disk
    const mapBytes = await readFile(result.control_map.path)
    assert.ok(mapBytes.length > 0)

    const finalBytes = await readFile(result.image.path)
    assert.ok(finalBytes.length > 0)

    // Verify renderer
    const rendered = registeredTool.output.render({}, result)
    assert.ok(Array.isArray(rendered))
    assert.ok(rendered[0].text.includes('ControlNet Guided Generation (CANNY)'))
  } finally {
    globalThis.fetch = origFetch
    await rm(tmpDir, { recursive: true, force: true })
  }
})

