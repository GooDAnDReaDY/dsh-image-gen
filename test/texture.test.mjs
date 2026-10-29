// @ts-check
// test/texture.test.mjs — Test suite for generate_seamless_texture tool (#468).

import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  buildTexturePrompt,
  shiftImageToroidal,
  blendSeamCross,
  render3x3TiledPreview,
  formatTextureMarkdown,
} from '../lib/texture-helpers.js'
import { registerTextureTools } from '../lib/tools/texture.js'

test('texture: buildTexturePrompt generates wrap directives and orthographic material constraints', () => {
  const pXY = buildTexturePrompt({
    prompt: 'weathered cobblestone street',
    tileMode: 'xy',
    style: 'photorealistic PBR',
  })
  assert.ok(pXY.includes('omnidirectional seamless'))
  assert.ok(pXY.includes('weathered cobblestone street'))
  assert.ok(pXY.includes('photorealistic PBR'))
  assert.ok(pXY.includes('Orthographic surface material'))

  const pX = buildTexturePrompt({
    prompt: 'horizontal wood planks',
    tileMode: 'x',
  })
  assert.ok(pX.includes('horizontally seamless'))

  const pY = buildTexturePrompt({
    prompt: 'vertical waterfall stream',
    tileMode: 'y',
  })
  assert.ok(pY.includes('vertically seamless'))
})

test('texture: shiftImageToroidal wraps quadrants by 50% across boundaries', async () => {
  const img = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 50, g: 100, b: 150, alpha: 1 } },
  }).png().toBuffer()

  const shifted = await shiftImageToroidal(img, 0.5, 0.5)
  assert.ok(Buffer.isBuffer(shifted))
  const meta = await sharp(shifted).metadata()
  assert.equal(meta.width, 100)
  assert.equal(meta.height, 100)
})

test('texture: blendSeamCross smooths boundary discontinuities at the central cross', async () => {
  const img = await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 200, g: 150, b: 100, alpha: 1 } },
  }).png().toBuffer()

  const blended = await blendSeamCross(img, { seamWidth: 16, tileMode: 'xy' })
  assert.ok(Buffer.isBuffer(blended))
  const meta = await sharp(blended).metadata()
  assert.equal(meta.width, 128)
  assert.equal(meta.height, 128)
})

test('texture: render3x3TiledPreview assembles 3x3 repetition grid for inspection', async () => {
  const tile = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 80, g: 90, b: 100, alpha: 1 } },
  }).png().toBuffer()

  const preview = await render3x3TiledPreview(tile, 100)
  assert.ok(Buffer.isBuffer(preview))
  const meta = await sharp(preview).metadata()
  assert.equal(meta.width, 300) // 100 * 3
  assert.equal(meta.height, 300)
})

test('texture: formatTextureMarkdown formats preview grid, tile asset, and CSS repeat rule', () => {
  const md = formatTextureMarkdown({
    prompt: 'obsidian cybernetic plating',
    tileMode: 'xy',
    texturePath: '/assets/texture-tile.png',
    previewPath: '/assets/preview-3x3.png',
    textureId: 'att-tex-1',
    previewId: 'att-prev-1',
    seamScore: 0.98,
  })

  assert.ok(md.includes('Seamless Tiling Texture (XY)'))
  assert.ok(md.includes('obsidian cybernetic plating'))
  assert.ok(md.includes('98%'))
  assert.ok(md.includes('3×3 Tiled Inspection Grid'))
  assert.ok(md.includes('background-repeat: repeat'))
  assert.ok(md.includes('/assets/preview-3x3.png'))
})

test('texture: tool execute generates seamless tile and 3x3 preview grid', async () => {
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

  const mockTileBuffer = await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 120, g: 140, b: 160, alpha: 1 } },
  }).png().toBuffer()

  const deps = {
    live: () => ({ enabled: true, provider: 'fal' }),
    resolveApiKey: () => 'fake-fal-key',
  }

  registerTextureTools(fakeCtx, deps)
  assert.ok(registeredTool, 'Tool must be registered')
  assert.equal(registeredTool.name, 'generate_seamless_texture')

  // Mock global fetch
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('requests/')) {
      return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED', response_url: 'https://queue.fal.run/res' }) }
    }
    if (u === 'https://queue.fal.run/res') {
      return { ok: true, status: 200, json: async () => ({ images: [{ url: 'https://cdn/tile.png', width: 512, height: 512 }], seed: 42 }) }
    }
    if (u === 'https://cdn/tile.png') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => mockTileBuffer.buffer.slice(mockTileBuffer.byteOffset, mockTileBuffer.byteOffset + mockTileBuffer.byteLength),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        request_id: 'req-mock-1',
        status_url: 'https://queue.fal.run/requests/req-mock-1/status',
        response_url: 'https://queue.fal.run/res',
        images: [{ url: 'https://cdn/tile.png', width: 512, height: 512 }],
        seed: 42,
      }),
    }
  }

  try {
    const res = await registeredTool.execute(
      {
        prompt: 'sci-fi metallic grid plating',
        tile_mode: 'xy',
        offset_blend: true,
        preview_grid: true,
      },
      {}
    )

    assert.equal(res.tile_mode, 'xy')
    assert.ok(res.texture_image)
    assert.ok(res.preview_image)
    assert.ok(typeof res.seam_score === 'number')

    // Verify render output
    const rendered = registeredTool.output.render({}, res)
    assert.ok(rendered[0].text.includes('Seamless Tiling Texture'))
    assert.ok(rendered[0].text.includes('<dsh-image-gen-texture>'))
  } finally {
    globalThis.fetch = origFetch
  }
})