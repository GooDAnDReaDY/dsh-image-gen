import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateGenerationParams } from '../lib/generation-helpers.js'
import { applyNegativeFallbackToPrompt, supportsNegativePrompt } from '../lib/negative-sanitizer.js'
import { createFalGenerator } from '../lib/providers/backends/fal.js'
import { createReplicateGenerator } from '../lib/providers/backends/replicate.js'
import { createCustomGenerator } from '../lib/providers/backends/custom.js'
import { createLocalGenerator } from '../lib/providers/backends/local.js'
import { createSeedreamGenerator } from '../lib/providers/backends/seedream.js'
import { formatA1111Parameters, computeGenerationHash } from '../lib/provider-utils.js'
import { buildSidecar } from '../lib/providers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(here, '..', 'lib')

test('generation-params #466: validateGenerationParams validates steps ranges', () => {
  const cfg = { enabled: true, provider: 'fal', defaultSize: 'square_hd', defaultFormat: 'png' }

  // Valid steps
  const valid1 = validateGenerationParams(cfg, { steps: 20 })
  assert.equal(valid1.steps, 20)
  const valid2 = validateGenerationParams(cfg, { steps: 1 })
  assert.equal(valid2.steps, 1)
  const valid3 = validateGenerationParams(cfg, { steps: 150 })
  assert.equal(valid3.steps, 150)

  // Invalid steps
  assert.throws(() => validateGenerationParams(cfg, { steps: 0 }), /Invalid steps/)
  assert.throws(() => validateGenerationParams(cfg, { steps: 151 }), /Invalid steps/)
  assert.throws(() => validateGenerationParams(cfg, { steps: -5 }), /Invalid steps/)
  assert.throws(() => validateGenerationParams(cfg, { steps: 25.5 }), /Invalid steps/)
  assert.throws(() => validateGenerationParams(cfg, { steps: 'not-a-number' }), /Invalid steps/)
})

test('generation-params #466: validateGenerationParams validates guidance_scale ranges', () => {
  const cfg = { enabled: true, provider: 'fal', defaultSize: 'square_hd', defaultFormat: 'png' }

  // Valid guidance
  const valid1 = validateGenerationParams(cfg, { guidance_scale: 7.5 })
  assert.equal(valid1.guidanceScale, 7.5)
  const valid2 = validateGenerationParams(cfg, { guidance_scale: 1.0 })
  assert.equal(valid2.guidanceScale, 1.0)
  const valid3 = validateGenerationParams(cfg, { guidance_scale: 30.0 })
  assert.equal(valid3.guidanceScale, 30.0)

  // Invalid guidance
  assert.throws(() => validateGenerationParams(cfg, { guidance_scale: 0.5 }), /Invalid guidance_scale/)
  assert.throws(() => validateGenerationParams(cfg, { guidance_scale: 35 }), /Invalid guidance_scale/)
  assert.throws(() => validateGenerationParams(cfg, { guidance_scale: 'abc' }), /Invalid guidance_scale/)
})

test('generation-params #466: validateGenerationParams validates seed and sampler_name', () => {
  const cfg = { enabled: true, provider: 'fal', defaultSize: 'square_hd', defaultFormat: 'png' }

  assert.equal(validateGenerationParams(cfg, { seed: 12345 }).seed, 12345)
  assert.throws(() => validateGenerationParams(cfg, { seed: 12.34 }), /Invalid seed/)

  assert.equal(validateGenerationParams(cfg, { sampler_name: 'euler_ancestral' }).samplerName, 'euler_ancestral')
  assert.throws(() => validateGenerationParams(cfg, { sampler_name: '   ' }), /Invalid sampler_name/)
})

test('generation-params #466: negative fallback embeds constraints for non-negative providers', () => {
  assert.equal(supportsNegativePrompt('custom', 'dall-e-3'), false)
  assert.equal(supportsNegativePrompt('fal', 'fal-ai/flux/dev'), false)

  const prompt = 'A serene Japanese garden with cherry blossoms'
  const neg = 'blurry, distorted, ugly, plastic'
  const fallback = applyNegativeFallbackToPrompt(prompt, neg)

  assert.ok(fallback.startsWith(prompt))
  assert.ok(fallback.includes('Do not include or avoid:'))
  assert.ok(fallback.includes('blurry'))
  assert.ok(fallback.includes('plastic'))

  // Contradiction protection: user wanting vintage film should not have vintage excluded
  const vintagePrompt = 'Vintage 35mm grainy film portrait'
  const vintageNeg = 'blurry, vintage, extra fingers'
  const protectedRes = applyNegativeFallbackToPrompt(vintagePrompt, vintageNeg)
  assert.ok(!protectedRes.includes('avoid: vintage'))
  assert.ok(protectedRes.includes('extra fingers'))
})

test('generation-params #466: backends receive and pass steps and sampler_name in payloads', async () => {
  let capturedBody = null
  const mockFetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body)
    return {
      ok: true,
      json: async () => ({
        data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }],
        images: ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
      }),
    }
  }

  // 1. Custom backend
  const customGen = createCustomGenerator(
    { fetchImpl: mockFetch, resolveKey: async () => 'test-key', cfg: { customBaseURL: 'https://mock.api', customModel: 'test-model' } },
    { prompt: 'test', size: 'square_hd', format: 'png', seed: 42, steps: 35, samplerName: 'dpmpp_2m', guidanceScale: 8.0 }
  )
  await customGen(42, 'test')
  assert.equal(capturedBody.steps, 35)
  assert.equal(capturedBody.sampler_name, 'dpmpp_2m')
  assert.equal(capturedBody.guidance_scale, 8.0)
  assert.equal(capturedBody.seed, 42)

  // 2. Local A1111 backend
  const localA1111Gen = createLocalGenerator(
    { fetchImpl: mockFetch, resolveKey: async () => '', cfg: { localBaseURL: 'http://127.0.0.1:7860', localKind: 'a1111' } },
    { prompt: 'test', size: 'square_hd', format: 'png', seed: 99, steps: 28, samplerName: 'euler_ancestral', guidanceScale: 6.5 }
  )
  await localA1111Gen(99, 'test')
  assert.equal(capturedBody.steps, 28)
  assert.equal(capturedBody.cfg_scale, 6.5)
  assert.equal(capturedBody.sampler_name, 'euler_ancestral')
  assert.equal(capturedBody.seed, 99)
})

test('generation-params #466: sidecar and PNG metadata persist tuning parameters', () => {
  const sidecar = buildSidecar({
    prompt: 'castle in the sky',
    size: '1024x1024',
    format: 'png',
    seed: 777,
    provider: 'local',
    deliverAs: 'image',
    width: 1024,
    height: 1024,
    mediaType: 'image/png',
    steps: 30,
    samplerName: 'dpmpp_sde',
    guidanceScale: 7.5,
    negativePrompt: 'blurry, deformed',
    stylePreset: 'anime',
  })
  assert.equal(sidecar.steps, 30)
  assert.equal(sidecar.samplerName, 'dpmpp_sde')
  assert.equal(sidecar.guidanceScale, 7.5)
  assert.equal(sidecar.negativePrompt, 'blurry, deformed')
  assert.equal(sidecar.stylePreset, 'anime')

  const a1111Text = formatA1111Parameters({
    prompt: 'castle in the sky',
    negativePrompt: 'blurry, deformed',
    seed: 777,
    steps: 30,
    sampler: 'dpmpp_sde',
    guidance_scale: 7.5,
    width: 1024,
    height: 1024,
    model: 'sdxl',
  })
  assert.ok(a1111Text.includes('Steps: 30'))
  assert.ok(a1111Text.includes('Sampler: dpmpp_sde'))
  assert.ok(a1111Text.includes('CFG scale: 7.5'))
  assert.ok(a1111Text.includes('Seed: 777'))

  // computeGenerationHash differentiates by steps, sampler, and guidance
  const h1 = computeGenerationHash({ prompt: 'test', seed: 1, steps: 20 })
  const h2 = computeGenerationHash({ prompt: 'test', seed: 1, steps: 40 })
  const h3 = computeGenerationHash({ prompt: 'test', seed: 1, steps: 20, samplerName: 'ddim' })
  assert.notEqual(h1, h2)
  assert.notEqual(h1, h3)
})

test('generation-params #466: lib/tools/generation.js declares new parameters in schema', () => {
  const src = readFileSync(path.join(lib, 'tools', 'generation.js'), 'utf8')
  assert.match(src, /steps:\s*\{/)
  assert.match(src, /sampler_name:\s*\{/)
  assert.match(src, /guidance_scale:\s*\{/)
  assert.match(src, /negative_prompt:\s*\{/)
  assert.match(src, /steps: args\.steps/)
  assert.match(src, /samplerName: args\.sampler_name/)
})
