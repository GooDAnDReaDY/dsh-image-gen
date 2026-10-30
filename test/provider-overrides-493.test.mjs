// test/provider-overrides-493.test.mjs
// Verifies Issue #493: FAL aspect_ratio mapping, Replicate model override & aspect_ratio string formatting.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createFalGenerator } from '../lib/providers/backends/fal.js'
import { createReplicateGenerator } from '../lib/providers/backends/replicate.js'

const ONE_PIXEL_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const ONE_PIXEL_BUF = Buffer.from(ONE_PIXEL_PNG_B64, 'base64')

test('Issue #493: FAL generator maps custom size + aspect_ratio to named FAL sizes', async () => {
  let submittedBody = null
  const deps = {
    fetchImpl: async (url, options) => {
      const urlStr = String(url || '')
      if (options?.body) {
        submittedBody = JSON.parse(options.body)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            request_id: 'req_123',
            status_url: 'https://queue.fal.run/status',
            response_url: 'https://queue.fal.run/response',
          }),
        }
      }
      if (urlStr.includes('status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'COMPLETED',
            response_url: 'https://queue.fal.run/response',
          }),
        }
      }
      if (urlStr.includes('response')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            images: [{ url: 'https://fal.media/files/img.png' }],
            seed: 1234,
          }),
        }
      }
      // Image download
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => ONE_PIXEL_BUF,
      }
    },
    resolveKey: async () => 'test-fal-key',
    cfg: { apiKeyEnv: 'FAL_API_KEY', model: 'fal-ai/flux/dev' },
  }

  // 16:9
  const gen169 = createFalGenerator(deps, {
    prompt: 'wide scene',
    size: 'custom',
    aspectRatio: '16:9',
    format: 'png',
  })
  await gen169()
  assert.equal(submittedBody.image_size, 'landscape_16_9', '16:9 should map to landscape_16_9')

  // 9:16
  const gen916 = createFalGenerator(deps, {
    prompt: 'portrait scene',
    size: 'custom',
    aspectRatio: '9:16',
    format: 'png',
  })
  await gen916()
  assert.equal(submittedBody.image_size, 'portrait_16_9', '9:16 should map to portrait_16_9')

  // 1:1
  const gen11 = createFalGenerator(deps, {
    prompt: 'square scene',
    size: 'custom',
    aspectRatio: '1:1',
    format: 'png',
  })
  await gen11()
  assert.equal(submittedBody.image_size, 'square_hd', '1:1 should map to square_hd')
})

test('Issue #493: Replicate generator respects cfg.model fallback and formats aspect_ratio', async () => {
  let submittedModel = null
  let submittedBody = null

  const deps = {
    fetchImpl: async (url, options) => {
      const urlStr = String(url || '')
      if (options?.body) {
        submittedModel = urlStr.replace('https://api.replicate.com/v1/models/', '').replace('/predictions', '')
        submittedBody = JSON.parse(options.body)
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'pred_123',
            status: 'succeeded',
            output: ['https://replicate.delivery/out.png'],
          }),
        }
      }
      // Image download
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => ONE_PIXEL_BUF,
      }
    },
    resolveKey: async () => 'test-replicate-key',
    cfg: {
      replicateKeyEnv: 'REPLICATE_API_TOKEN',
      replicateModel: 'stability-ai/sdxl',
    },
  }

  const gen = createReplicateGenerator(deps, {
    prompt: 'test prompt',
    size: 'custom',
    aspectRatio: '16:9',
    format: 'png',
  })
  await gen()

  assert.equal(submittedModel, 'stability-ai/sdxl', 'Replicate must fall back to cfg.model')
  assert.equal(submittedBody.input.aspect_ratio, '16:9', 'Replicate aspect_ratio should be ratio string')
})
