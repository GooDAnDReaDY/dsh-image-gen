import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateGenerationParams,
  prepareGenerationPrompt,
} from '../lib/generation-helpers.js'
import { buildSidecar } from '../lib/providers.js'
import { formatA1111Parameters } from '../lib/provider-utils.js'
import { createFalGenerator } from '../lib/providers/backends/fal.js'
import { createSeedreamGenerator } from '../lib/providers/backends/seedream.js'
import { createCustomGenerator } from '../lib/providers/backends/custom.js'

const ONE_PIXEL_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const ONE_PIXEL_PNG_BYTES = Buffer.from(ONE_PIXEL_PNG_B64, 'base64')

test('reference-consistency #458: validateGenerationParams validates reference_strength in 0.1..1.0 range', () => {
  const cfg = { provider: 'fal', defaultSize: 'square_hd', defaultFormat: 'png' }

  // Valid values
  const valid1 = validateGenerationParams(cfg, { prompt: 'hero', reference_strength: 0.1 })
  assert.equal(valid1.referenceStrength, 0.1)

  const valid2 = validateGenerationParams(cfg, { prompt: 'hero', reference_strength: 0.85 })
  assert.equal(valid2.referenceStrength, 0.85)

  const valid3 = validateGenerationParams(cfg, { prompt: 'hero', reference_strength: 1.0 })
  assert.equal(valid3.referenceStrength, 1.0)

  // Undefined / null are optional
  const validNone = validateGenerationParams(cfg, { prompt: 'hero' })
  assert.equal(validNone.referenceStrength, undefined)

  // Invalid values
  assert.throws(() => validateGenerationParams(cfg, { prompt: 'hero', reference_strength: 0.05 }), /Invalid reference_strength/)
  assert.throws(() => validateGenerationParams(cfg, { prompt: 'hero', reference_strength: 1.5 }), /Invalid reference_strength/)
  assert.throws(() => validateGenerationParams(cfg, { prompt: 'hero', reference_strength: 'abc' }), /Invalid reference_strength/)
})

test('reference-consistency #458: prepareGenerationPrompt enriches prompt with character/subject consistency reference', async () => {
  const ctx = {}
  const cfg = { enhancePrompt: false }
  const exec = { signal: null }
  const args = {
    prompt: 'warrior standing in a rainy city',
    reference_image: 'https://example.com/character-ref.png',
    reference_strength: 0.8,
  }

  const res = await prepareGenerationPrompt({
    ctx,
    cfg,
    args,
    exec,
    sessionId: 'session-123',
    provider: 'fal',
    resolveSource: async (_c, _e, src) => ({ url: src }),
  })

  assert.ok(res.effectivePrompt.includes('visual character/subject consistency reference'), 'Should add consistency reference directive')
  assert.ok(res.effectivePrompt.includes('consistency weight 0.8'), 'Should include consistency weight')
  assert.equal(res.resolvedRefImage?.url, 'https://example.com/character-ref.png')
})

test('reference-consistency #458: buildSidecar and formatA1111Parameters retain reference image and strength', () => {
  const sidecar = buildSidecar({
    prompt: 'cyberpunk detective',
    size: '1024x1024',
    format: 'png',
    seed: 42,
    provider: 'fal',
    deliverAs: 'image',
    width: 1024,
    height: 1024,
    mediaType: 'image/png',
    attachmentId: 'sha256:1234',
    url: '/dsh-image-gen/image?id=sha256:1234',
    cost: 0.03,
    referenceImage: 'https://example.com/hero.png',
    referenceStrength: 0.75,
  })

  assert.equal(sidecar.referenceImage, 'https://example.com/hero.png')
  assert.equal(sidecar.referenceStrength, 0.75)

  const a1111 = formatA1111Parameters({
    prompt: 'cyberpunk detective',
    seed: 42,
    reference_image: 'hero.png',
    reference_strength: 0.75,
  })
  assert.ok(a1111.includes('Reference: hero.png (strength 0.75)'))
})

test('reference-consistency #458: FAL backend auto-routes default flux/dev to flux/dev/redux when referenceImage is provided', async () => {
  let submittedModel = null
  let submittedBody = null

  const mockFetch = async (url, opts) => {
    if (url.endsWith('/res')) {
      return {
        ok: true,
        json: async () => ({
          images: [{ url: 'https://example.com/out.png', width: 1024, height: 1024 }],
          seed: 42,
        }),
      }
    }
    if (url.endsWith('/out.png')) {
      return {
        ok: true,
        arrayBuffer: async () => ONE_PIXEL_PNG_BYTES,
      }
    }
    if (url.includes('/requests/') || url.includes('/status')) {
      return {
        ok: true,
        json: async () => ({ status: 'COMPLETED', request_id: 'req-123', response_url: 'https://fal.run/res' }),
      }
    }
    // Submit
    const parts = url.replace('https://queue.fal.run/', '').split('/')
    submittedModel = parts.join('/')
    if (opts?.body) {
      submittedBody = JSON.parse(opts.body)
    }
    return {
      ok: true,
      json: async () => ({
        status: 'IN_QUEUE',
        request_id: 'req-123',
        response_url: 'https://fal.run/res',
        status_url: 'https://queue.fal.run/requests/req-123/status',
      }),
    }
  }

  const deps = {
    fetchImpl: mockFetch,
    resolveKey: async () => 'mock-fal-key',
    cfg: { baseURL: 'https://queue.fal.run', model: 'fal-ai/flux/dev' },
  }
  const job = {
    prompt: 'a portrait in armor',
    size: '1024x1024',
    format: 'png',
    seed: 42,
    referenceImage: { url: 'https://example.com/ref.png' },
    referenceStrength: 0.85,
  }

  const gen = createFalGenerator(deps, job)
  await gen(42, 'a portrait in armor')

  assert.equal(submittedModel, 'fal-ai/flux/dev/redux', 'Must automatically select flux/dev/redux')
  assert.equal(submittedBody.image_url, 'https://example.com/ref.png')
  assert.equal(submittedBody.reference_weight, 0.85)
  assert.equal(submittedBody.redux_weight, 0.85)
})

test('reference-consistency #458: Seedream backend passes multimodal reference in request body', async () => {
  let requestPayload = null

  const mockFetch = async (url, opts) => {
    requestPayload = JSON.parse(opts.body)
    return {
      ok: true,
      json: async () => ({
        data: [{ b64_json: ONE_PIXEL_PNG_B64 }],
      }),
    }
  }

  const deps = {
    fetchImpl: mockFetch,
    resolveKey: async () => 'mock-seedream-key',
    cfg: { seedreamBaseURL: 'https://api.bytedanceapi.com/v1', seedreamModel: 'seedream-4.0' },
  }
  const job = {
    prompt: 'character exploring forest',
    size: 'square_hd',
    format: 'png',
    seed: 100,
    referenceImage: { url: 'https://example.com/character.png' },
    referenceStrength: 0.7,
  }

  const gen = createSeedreamGenerator(deps, job)
  await gen(100, 'character exploring forest')

  assert.ok(requestPayload !== null)
  assert.equal(requestPayload.image, 'https://example.com/character.png')
  assert.equal(requestPayload.reference_image, 'https://example.com/character.png')
  assert.equal(requestPayload.reference_strength, 0.7)
})

test('reference-consistency #458: Custom backend passes --cref for Midjourney and reference_image for standard APIs', async () => {
  let mjBody = null
  let standardBody = null

  const mockFetchMj = async (url, opts) => {
    mjBody = JSON.parse(opts.body)
    return { ok: true, json: async () => ({ data: [{ b64_json: ONE_PIXEL_PNG_B64 }] }) }
  }
  const depsMj = {
    fetchImpl: mockFetchMj,
    resolveKey: async () => 'key',
    cfg: { customBaseURL: 'https://api.mj-proxy.com/v1', customModel: 'midjourney-v6' },
  }
  const jobMj = {
    prompt: 'fashion model in kimono',
    size: 'square_hd',
    format: 'png',
    seed: 1,
    referenceImage: { url: 'https://example.com/face.jpg' },
    referenceStrength: 0.8,
  }
  const genMj = createCustomGenerator(depsMj, jobMj)
  await genMj(1, 'fashion model in kimono')

  assert.ok(mjBody.prompt.includes('--cref https://example.com/face.jpg --cw 80'), 'Midjourney model should append --cref and --cw')

  const mockFetchStd = async (url, opts) => {
    standardBody = JSON.parse(opts.body)
    return { ok: true, json: async () => ({ data: [{ b64_json: ONE_PIXEL_PNG_B64 }] }) }
  }
  const depsStd = {
    fetchImpl: mockFetchStd,
    resolveKey: async () => 'key',
    cfg: { customBaseURL: 'https://api.openai-proxy.com/v1', customModel: 'custom-flux' },
  }
  const jobStd = {
    prompt: 'robot mascot',
    size: 'square_hd',
    format: 'png',
    seed: 2,
    referenceImage: { url: 'https://example.com/mascot.png' },
    referenceStrength: 0.65,
  }
  const genStd = createCustomGenerator(depsStd, jobStd)
  await genStd(2, 'robot mascot')

  assert.equal(standardBody.reference_image, 'https://example.com/mascot.png')
  assert.equal(standardBody.reference_strength, 0.65)
})