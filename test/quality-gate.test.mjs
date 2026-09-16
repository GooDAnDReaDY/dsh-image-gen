import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateImageQuality, executeWithQualityGate } from '../lib/quality-gate.js'

test('evaluateImageQuality: rejects corrupt or tiny buffers', async () => {
  const result = await evaluateImageQuality(Buffer.from([0, 1, 2, 3]))
  assert.equal(result.passed, false)
  assert.equal(result.defect, 'corrupt_buffer')
})

test('evaluateImageQuality: rejects solid monochrome or blank images', async () => {
  // 1024 bytes of identical bytes (zero variance)
  const blankBuf = Buffer.alloc(1024, 128)
  const result = await evaluateImageQuality(blankBuf)
  assert.equal(result.passed, false)
  assert.equal(result.defect, 'blank_or_solid_frame')
})

test('evaluateImageQuality: accepts high-entropy varied image buffers', async () => {
  const variedBuf = Buffer.alloc(2048)
  for (let i = 0; i < variedBuf.length; i++) {
    variedBuf[i] = (i * 37) % 256
  }
  const result = await evaluateImageQuality(variedBuf)
  assert.equal(result.passed, true)
  assert.equal(result.defect, null)
  assert.ok(result.score >= 0.5)
})

test('executeWithQualityGate: passes through immediately when quality is good', async () => {
  const goodBuf = Buffer.alloc(2048)
  for (let i = 0; i < goodBuf.length; i++) goodBuf[i] = (i * 43) % 256

  let callCount = 0
  const generateFn = async (seed) => {
    callCount++
    return { seed, bytes: goodBuf, width: 512, height: 512 }
  }

  const { generated, qualityReport } = await executeWithQualityGate(generateFn, {
    initialSeed: 12345,
    enabled: true,
  })

  assert.equal(callCount, 1)
  assert.equal(qualityReport.passed, true)
  assert.equal(qualityReport.rerolls, 0)
  assert.equal(generated.seed, 12345)
})

test('executeWithQualityGate: performs silent re-roll when first attempt fails', async () => {
  const badBuf = Buffer.alloc(1024, 0) // blank
  const goodBuf = Buffer.alloc(2048)
  for (let i = 0; i < goodBuf.length; i++) goodBuf[i] = (i * 17) % 256

  let callCount = 0
  const generateFn = async (seed) => {
    callCount++
    if (callCount === 1) {
      return { seed, bytes: badBuf, width: 512, height: 512 }
    }
    return { seed, bytes: goodBuf, width: 512, height: 512 }
  }

  const { generated, qualityReport } = await executeWithQualityGate(generateFn, {
    initialSeed: 100,
    enabled: true,
    maxRerolls: 2,
  })

  assert.equal(callCount, 2)
  assert.equal(qualityReport.passed, true)
  assert.equal(qualityReport.rerolls, 1)
  assert.notEqual(generated.seed, 100) // Changed seed on re-roll
})

test('executeWithQualityGate: respects enabled=false and skips checking', async () => {
  const badBuf = Buffer.alloc(1024, 0)
  const generateFn = async (seed) => ({ seed, bytes: badBuf })

  const { qualityReport } = await executeWithQualityGate(generateFn, {
    initialSeed: 55,
    enabled: false,
  })

  assert.equal(qualityReport.passed, true)
  assert.equal(qualityReport.skipped, true)
  assert.equal(qualityReport.rerolls, 0)
})
