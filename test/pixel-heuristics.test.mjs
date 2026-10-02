import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { estimateSharpnessAndVariance } from '../lib/provider-utils.js'
import { pixelDiff } from '../lib/providers.js'
import { scoreEdgeWrap, scoreImageEdgeWrap } from '../lib/pattern-helpers.js'
import { evaluateImageQuality } from '../lib/quality-gate.js'

test('heuristics (#371): tiny valid 95-byte PNG is not marked corrupt', async () => {
  const tinyPng = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer()

  assert.ok(tinyPng.length < 150, 'Tiny PNG should be small')
  const evalResult = await evaluateImageQuality(tinyPng)
  // It is a solid red frame, so it should be blank_or_solid_frame, NOT corrupt_buffer
  assert.notEqual(evalResult.defect, 'corrupt_buffer', 'Tiny valid PNG must not be marked corrupt_buffer')
  assert.equal(evalResult.defect, 'blank_or_solid_frame')
})

test('heuristics (#371): random 2048 bytes non-image data is rejected as corrupt', async () => {
  const randomBytes = crypto.randomBytes(2048)
  const analysis = await estimateSharpnessAndVariance(randomBytes)
  assert.equal(analysis.passed, false)
  assert.equal(analysis.score, 0)
  assert.equal(analysis.reason, 'Unsupported or corrupt image data')

  const evalResult = await evaluateImageQuality(randomBytes)
  assert.equal(evalResult.passed, false)
  assert.equal(evalResult.defect, 'corrupt_buffer')
})

test('heuristics (#371): identical pixels with different compression levels produce identical scores', async () => {
  const rawPixels = Buffer.alloc(64 * 64)
  for (let i = 0; i < rawPixels.length; i++) {
    rawPixels[i] = (i % 64) * 4
  }

  const comp0 = await sharp(rawPixels, { raw: { width: 64, height: 64, channels: 1 } })
    .png({ compressionLevel: 0 })
    .toBuffer()

  const comp9 = await sharp(rawPixels, { raw: { width: 64, height: 64, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer()

  assert.notEqual(comp0.length, comp9.length, 'Compressed sizes must differ')

  const res0 = await estimateSharpnessAndVariance(comp0)
  const res9 = await estimateSharpnessAndVariance(comp9)

  assert.equal(res0.score, res9.score, 'Scores must be identical')
  assert.equal(res0.variance, res9.variance, 'Variances must be identical')
  assert.equal(res0.avgDiff, res9.avgDiff, 'Average differences must be identical')
  assert.equal(res0.passed, true)
})

test('heuristics (#371): pixelDiff decodes image containers and reports 0 diff for different compression', async () => {
  const rawPixels = Buffer.alloc(16 * 16)
  for (let i = 0; i < rawPixels.length; i++) {
    rawPixels[i] = (i * 19 + 5) % 256
  }

  const comp0 = await sharp(rawPixels, { raw: { width: 16, height: 16, channels: 1 } })
    .png({ compressionLevel: 0 })
    .toBuffer()

  const comp9 = await sharp(rawPixels, { raw: { width: 16, height: 16, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer()

  const diff = await pixelDiff(comp0, comp9)
  assert.equal(diff.diffRatio, 0, 'Identical image pixels must report 0 diff regardless of compression')
})

test('heuristics (#371): pixelDiff calculates real pixel diff ratio between differing images', async () => {
  const raw1 = Buffer.alloc(4 * 4 * 4, 0) // 16 black pixels RGBA
  const raw2 = Buffer.alloc(4 * 4 * 4, 0)
  // Change 4 out of 16 pixels to white
  for (let i = 0; i < 4; i++) {
    const off = i * 4
    raw2[off] = 255
    raw2[off + 1] = 255
    raw2[off + 2] = 255
    raw2[off + 3] = 255
  }

  const img1 = await sharp(raw1, { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer()
  const img2 = await sharp(raw2, { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer()

  const diff = await pixelDiff(img1, img2)
  assert.equal(diff.diffRatio, 4 / 16, 'Should detect exactly 4/16 differing pixels')
})

test('heuristics (#371): scoreImageEdgeWrap evaluates actual image container pixel continuity', async () => {
  // Create a perfectly seamless 16x16 gradient (wraps top-to-bottom and left-to-right)
  const seamlessRaw = Buffer.alloc(16 * 16 * 4)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const idx = (y * 16 + x) * 4
      seamlessRaw[idx] = 128
      seamlessRaw[idx + 1] = 128
      seamlessRaw[idx + 2] = 128
      seamlessRaw[idx + 3] = 255
    }
  }

  const seamlessPng = await sharp(seamlessRaw, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer()
  const score = await scoreImageEdgeWrap(seamlessPng)
  assert.equal(score, 1, 'Solid color has perfect seam wrap continuity')
})
