// test/inpaint-ui.test.mjs — Regression test suite for Inpaint UI and Mask Normalization (#285, #328, #380)

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { normalizeMaskAlpha } from '../lib/providers/shared-helpers.js'
import { createCustomGenerator } from '../lib/providers/backends/custom.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

test('inpaint (#380): client generates typed edit_image instruction with "image" parameter (not "source_image")', () => {
  const inpaintSrc = fs.readFileSync(path.join(root, 'src', 'client', '105-inpaint-canvas.js'), 'utf8')
  assert.match(inpaintSrc, /function buildEditInstruction/)
  assert.match(inpaintSrc, /image:\s*"\s*'\s*\+\s*img/)
  assert.match(inpaintSrc, /image:\s*effectiveTargetRef/)
  assert.doesNotMatch(inpaintSrc, /source_image/)

  const clientBundle = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
  assert.match(clientBundle, /Use edit_image with prompt:/)
  assert.match(clientBundle, /image:\s*"\s*'\s*\+\s*img/)
  assert.match(clientBundle, /image:\s*effectiveTargetRef/)
  assert.doesNotMatch(clientBundle, /source_image/)
})

test('inpaint (#380): card passes canonical targetRef and sendActionPrompt to InpaintCanvas', () => {
  const cardSrc = fs.readFileSync(path.join(root, 'src', 'client', '100-image-card.js'), 'utf8')
  assert.match(cardSrc, /targetRef:\s*\(parsed\.attachment\s*&&\s*\(parsed\.attachment\.attachmentId\s*\|\|\s*parsed\.attachment\.id\)\)/)
  assert.match(cardSrc, /sendActionPrompt/)
})

test('inpaint (#380): canvas preserves intrinsic dimensions without 768px downscaling clamp', () => {
  const inpaintSrc = fs.readFileSync(path.join(root, 'src', 'client', '105-inpaint-canvas.js'), 'utf8')
  assert.doesNotMatch(inpaintSrc, /768\s*\/\s*Math\.max/)
  assert.match(inpaintSrc, /setCanvasDims\(\{\s*width:\s*nw,\s*height:\s*nh/)
})

test('inpaint (#380): normalizeMaskAlpha converts opaque B&W mask to transparent inpaint region for OpenAI', async () => {
  // Create an opaque 64x64 PNG: left half black (0), right half white (255)
  const rawBytes = Buffer.alloc(64 * 64 * 4)
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const idx = (y * 64 + x) * 4
      const val = x >= 32 ? 255 : 0
      rawBytes[idx] = val     // R
      rawBytes[idx + 1] = val // G
      rawBytes[idx + 2] = val // B
      rawBytes[idx + 3] = 255 // Opaque alpha
    }
  }

  const opaquePng = await sharp(rawBytes, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer()

  // Normalize
  const normalizedPng = await normalizeMaskAlpha(opaquePng)
  assert.ok(normalizedPng)

  const { data, info } = await sharp(normalizedPng).raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, 64)
  assert.equal(info.height, 64)
  assert.equal(info.channels, 4)

  // Black side (x < 32): should remain opaque (alpha = 255)
  const blackIdx = (10 * 64 + 10) * 4
  assert.equal(data[blackIdx + 3], 255, 'Black pixel must stay opaque (keep original)')

  // White side (x >= 32): should become transparent (alpha = 0) for OpenAI inpainting
  const whiteIdx = (10 * 64 + 40) * 4
  assert.equal(data[whiteIdx + 3], 0, 'White pixel must become transparent (edit target)')
})

test('inpaint (#380): normalizeMaskAlpha preserves masks that already contain alpha transparency', async () => {
  const rawBytes = Buffer.alloc(32 * 32 * 4)
  for (let i = 0; i < rawBytes.length; i += 4) {
    rawBytes[i] = 255
    rawBytes[i + 1] = 0
    rawBytes[i + 2] = 0
    rawBytes[i + 3] = 120 // existing alpha
  }

  const transparentPng = await sharp(rawBytes, { raw: { width: 32, height: 32, channels: 4 } }).png().toBuffer()
  const resultPng = await normalizeMaskAlpha(transparentPng)
  const { data } = await sharp(resultPng).raw().toBuffer({ resolveWithObject: true })
  assert.equal(data[3], 120, 'Existing alpha transparency must be preserved')
})

test('inpaint (#380): custom provider normalizes mask and submits multipart edit form with image and mask', async () => {
  let submittedFormData = null
  const mockFetch = async (url, opts) => {
    submittedFormData = opts.body
    return {
      ok: true,
      json: async () => ({
        data: [{ b64_json: Buffer.from('fake-result-png').toString('base64') }],
      }),
    }
  }

  const sourceBytes = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 100, g: 100, b: 100, alpha: 1 } },
  }).png().toBuffer()

  const maskBytes = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).png().toBuffer()

  const gen = createCustomGenerator(
    { fetchImpl: mockFetch, resolveKey: async () => 'test-key', cfg: { customBaseURL: 'https://api.openai.com/v1', customModel: 'dall-e-2' } },
    {
      prompt: 'add a red hat',
      source: { bytes: sourceBytes, mediaType: 'image/png' },
      mask: { bytes: maskBytes, mediaType: 'image/png' },
      size: '64x64',
    },
  )

  const res = await gen()
  assert.ok(res.bytes)
  assert.ok(submittedFormData instanceof FormData)
  assert.ok(submittedFormData.has('image'))
  assert.ok(submittedFormData.has('mask'))
  assert.equal(submittedFormData.get('prompt'), 'add a red hat')
})
