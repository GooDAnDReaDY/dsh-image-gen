// @ts-check
// test/turnaround.test.mjs — Test suite for generate_turnaround_sheet tool (#464).

import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import {
  DEFAULT_TURNAROUND_ANGLES,
  buildTurnaroundPrompt,
  sliceTurnaroundSheet,
  formatTurnaroundMarkdown,
} from '../lib/turnaround-helpers.js'
import { registerTurnaroundTools } from '../lib/tools/turnaround.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==',
  'base64',
)

test('turnaround: buildTurnaroundPrompt generates calibrated model sheet prompt for subjects', () => {
  const pChar = buildTurnaroundPrompt({
    prompt: 'cyberpunk warrior',
    subjectType: 'character',
    angles: ['front', 'side', 'back', 'three_quarter'],
  })
  assert.ok(pChar.includes('cyberpunk warrior'))
  assert.ok(pChar.includes('3D model sheet turnaround for character'))
  assert.ok(pChar.includes('neutral T-pose'))
  assert.ok(pChar.includes('front view, side view, back view, three quarter view'))

  const pProp = buildTurnaroundPrompt({
    prompt: 'sci-fi assault rifle',
    subjectType: 'prop',
    angles: ['front', 'side', 'back', 'iso_45'],
  })
  assert.ok(pProp.includes('3D model sheet turnaround for prop'))
  assert.ok(pProp.includes('neutral upright orthographic alignment'))
})

test('turnaround: sliceTurnaroundSheet extracts horizontal perspective slices with Sharp', async () => {
  // Create synthetic panoramic image (400x100)
  const syntheticSheet = await sharp({
    create: { width: 400, height: 100, channels: 4, background: { r: 50, g: 100, b: 150, alpha: 1 } },
  }).png().toBuffer()

  const angles = ['front', 'side', 'back', 'three_quarter']
  const slices = await sliceTurnaroundSheet({
    sheetBuffer: syntheticSheet,
    angles,
  })

  assert.equal(slices.length, 4)
  for (let i = 0; i < 4; i++) {
    assert.equal(slices[i].angle, angles[i])
    assert.equal(slices[i].index, i)
    assert.equal(slices[i].width, 100)
    assert.equal(slices[i].height, 100)
    assert.ok(Buffer.isBuffer(slices[i].buffer))
  }
})

test('turnaround: formatTurnaroundMarkdown generates table and manifest references', () => {
  const md = formatTurnaroundMarkdown({
    prompt: 'cyberpunk droid',
    subjectType: 'character',
    angles: ['front', 'side'],
    sheetUrl: 'https://cdn/sheet.png',
    slices: [
      { angle: 'front', width: 256, height: 512, path: '/tmp/f.png' },
      { angle: 'side', width: 256, height: 512, path: '/tmp/s.png' },
    ],
    manifestPath: '/tmp/manifest.json',
  })

  assert.ok(md.includes('Multi-Angle Turnaround Model Sheet (CHARACTER)'))
  assert.ok(md.includes('![Full Turnaround Sheet]'))
  assert.ok(md.includes('| **front** | `256×512` | `/tmp/f.png` |'))
  assert.ok(md.includes('**Model Sheet Manifest:** `/tmp/manifest.json`'))
})

test('turnaround: tool generate_turnaround_sheet executes end-to-end and saves sheet, slices, and manifest', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-turnaround-test-'))
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

  registerTurnaroundTools(ctx, {
    live: () => liveConfig,
    slugify: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey: () => 'mock-fal-key',
  })

  assert.ok(registeredTool)
  assert.equal(registeredTool.name, 'generate_turnaround_sheet')

  // Mock panoramic 800x400 sheet from provider
  const mockSheetBuffer = await sharp({
    create: { width: 800, height: 400, channels: 4, background: { r: 80, g: 120, b: 160, alpha: 1 } },
  }).png().toBuffer()

  const origFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('requests/')) {
      return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED', response_url: 'https://queue.fal.run/res' }) }
    }
    if (u === 'https://queue.fal.run/res') {
      return { ok: true, status: 200, json: async () => ({ images: [{ url: 'https://cdn/sheet.png', width: 800, height: 400 }], seed: 42 }) }
    }
    if (u === 'https://cdn/sheet.png') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => mockSheetBuffer.buffer.slice(mockSheetBuffer.byteOffset, mockSheetBuffer.byteOffset + mockSheetBuffer.byteLength),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        request_id: 'req-mock-1',
        status_url: 'https://queue.fal.run/requests/req-mock-1/status',
        response_url: 'https://queue.fal.run/res',
        images: [{ url: 'https://cdn/sheet.png', width: 800, height: 400 }],
        seed: 42,
      }),
    }
  }

  try {
    const result = await registeredTool.execute({
      prompt: 'cyberpunk tactical recon drone',
      subject_type: 'vehicle',
      angles: ['front', 'side', 'back', 'three_quarter'],
      output_dir: tmpDir,
    }, {
      agent: { session: { header: { cwd: tmpDir } } },
    })

    assert.equal(result.subject_type, 'vehicle')
    assert.equal(result.angles.length, 4)
    assert.ok(result.sheet.path)
    assert.equal(result.slices.length, 4)
    assert.ok(result.manifest_path)

    // Verify manifest contents
    const manifest = JSON.parse(await readFile(result.manifest_path, 'utf-8'))
    assert.equal(manifest.subject_type, 'vehicle')
    assert.equal(manifest.slices.length, 4)
    assert.equal(manifest.slices[0].angle, 'front')

    // Verify individual sliced files exist on disk
    for (const slice of result.slices) {
      const sliceBytes = await readFile(slice.path)
      assert.ok(sliceBytes.length > 0)
    }

    // Verify renderer
    const rendered = registeredTool.output.render({}, result)
    assert.ok(Array.isArray(rendered))
    assert.ok(rendered[0].text.includes('Multi-Angle Turnaround Model Sheet (VEHICLE)'))
    assert.ok(rendered[0].text.includes('<dsh-image-gen-turnaround>'))
  } finally {
    globalThis.fetch = origFetch
    await rm(tmpDir, { recursive: true, force: true })
  }
})

