import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { traceToSvg } from '../lib/providers.js'

test('vectorize (#373): traces raster to vector paths without embedded raster', async () => {
  // Create a 16x16 icon with red center
  const raw = Buffer.alloc(16 * 16 * 4, 0)
  for (let y = 4; y < 12; y++) {
    for (let x = 4; x < 12; x++) {
      const idx = (y * 16 + x) * 4
      raw[idx] = 255
      raw[idx + 1] = 0
      raw[idx + 2] = 0
      raw[idx + 3] = 255
    }
  }

  const png = await sharp(raw, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer()

  const res = await traceToSvg(png, { colorMode: 'color' })
  assert.equal(res.mediaType, 'image/svg+xml')
  assert.ok(res.svg.includes('<svg'))
  assert.ok(res.svg.includes('<path d="'), 'Must generate vector path element')
  assert.ok(!res.svg.includes('<image'), 'Must NOT embed raster <image> element')
  assert.ok(!res.svg.includes('data:image/'), 'Must NOT contain base64 raster data')
})

test('vectorize (#373): binary mode produces solid black vector geometry', async () => {
  const raw = Buffer.alloc(8 * 8 * 4, 255) // white background
  // 2x2 black square in center
  for (let y = 3; y < 5; y++) {
    for (let x = 3; x < 5; x++) {
      const idx = (y * 8 + x) * 4
      raw[idx] = 0
      raw[idx + 1] = 0
      raw[idx + 2] = 0
      raw[idx + 3] = 255
    }
  }

  const png = await sharp(raw, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer()
  const res = await traceToSvg(png, { colorMode: 'binary' })

  assert.ok(res.svg.includes('<path d="'))
  assert.ok(res.svg.includes('fill="#000000"'), 'Binary vector must be filled with black')
  assert.ok(!res.svg.includes('<image'))
})

test('vectorize (#373): palette size and colors influence vector layers', async () => {
  const raw = Buffer.alloc(16 * 16 * 4, 0)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 16; x++) {
      const idx = (y * 16 + x) * 4
      raw[idx] = 255; raw[idx + 1] = 0; raw[idx + 2] = 0; raw[idx + 3] = 255 // Red
    }
  }
  for (let y = 8; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const idx = (y * 16 + x) * 4
      raw[idx] = 0; raw[idx + 1] = 0; raw[idx + 2] = 255; raw[idx + 3] = 255 // Blue
    }
  }

  const png = await sharp(raw, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer()
  const res = await traceToSvg(png, { colorMode: 'color', paletteSize: 4 })

  assert.ok(res.palette.length <= 4)
  assert.ok(res.svg.includes('<path d="'))
  assert.ok(!res.svg.includes('<image'))
})
