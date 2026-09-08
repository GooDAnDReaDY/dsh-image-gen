import test from 'node:test'
import assert from 'node:assert/strict'
import {
  supportsNegativePrompt,
  splitTerms,
  contradictsPositive,
  sanitizeNegativePrompt,
  DEFAULT_DEFECT_TERMS,
} from '../lib/negative-sanitizer.js'

test('supportsNegativePrompt: detects diffusion vs direct models', () => {
  assert.equal(supportsNegativePrompt('fal', 'fal-ai/flux/dev'), false)
  assert.equal(supportsNegativePrompt('fal', 'fal-ai/recraft-v3'), false)
  assert.equal(supportsNegativePrompt('custom', 'dall-e-3'), false)
  assert.equal(supportsNegativePrompt('grok', 'aurora'), false)

  assert.equal(supportsNegativePrompt('local', 'sdxl_base'), true)
  assert.equal(supportsNegativePrompt('seedream', 'seedream-4.0'), true)
  assert.equal(supportsNegativePrompt('replicate', 'stability-ai/sdxl'), true)
  assert.equal(supportsNegativePrompt('custom', 'custom-sdxl-v1'), true)
})

test('splitTerms: splits by comma, semicolon, newline and trims', () => {
  assert.deepEqual(splitTerms('bad hands, blurry; low quality\nugly'), ['bad hands', 'blurry', 'low quality', 'ugly'])
  assert.deepEqual(splitTerms(''), [])
  assert.deepEqual(splitTerms(null), [])
})

test('contradictsPositive: detects when negative term contradicts intentional style', () => {
  assert.equal(contradictsPositive('grainy', 'vintage 35mm photograph, grainy film texture'), true)
  assert.equal(contradictsPositive('blurry', 'motion blur speed photo'), true)
  assert.equal(contradictsPositive('monochrome', 'clean monochrome black and white ink sketch'), true)
  assert.equal(contradictsPositive('bad anatomy', 'vintage 35mm photograph'), false)
})

test('sanitizeNegativePrompt: deduplicates and merges user terms first', () => {
  const res = sanitizeNegativePrompt({
    positivePrompt: 'A beautiful mountain landscape at sunset',
    userNegative: 'ugly, blurry, bad quality',
    additionalTerms: ['blurry', 'watermark'],
    autoInjectDefects: true,
  })

  // User terms preserved first
  assert.ok(res.startsWith('ugly, blurry, bad quality'))
  // No duplicated 'blurry'
  const occurrences = res.split(', ').filter(t => t === 'blurry').length
  assert.equal(occurrences, 1)
  // Built-in defect terms included
  assert.ok(res.includes('watermark'))
  assert.ok(res.includes('deformed'))
  assert.ok(res.includes('jpeg artifacts'))
})

test('sanitizeNegativePrompt: filters conflicting terms if user explicitly requested them positively', () => {
  const res = sanitizeNegativePrompt({
    positivePrompt: 'Moody dark shadowy vintage retro grainy poster',
    userNegative: 'watermark',
    autoInjectDefects: true,
  })

  // 'grainy', 'dark', 'vintage' must not be added to negative prompt
  assert.ok(!res.toLowerCase().includes('grainy'))
  assert.ok(res.includes('watermark'))
  assert.ok(res.includes('low quality'))
})
