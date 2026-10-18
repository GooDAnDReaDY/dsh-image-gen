import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CANONICAL_STYLE_PRESETS,
  SUPPORTED_STYLE_PRESET_NAMES,
  STYLE_PRESETS,
  normalizeStyleKey,
  resolveStylePreset,
  applyStylePreset,
} from '../lib/style-presets.js'
import { polishPrompt, CURATED_STYLES } from '../lib/prompt-polisher.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(here, '..', 'lib')

test('style-presets #457: dictionary defines all 8 required canonical presets', () => {
  const required = [
    'photorealistic',
    'anime',
    'isometric_3d',
    'pixel_art',
    'cinematic',
    'minimalist_vector',
    'claymation',
    'cyberpunk',
  ]
  for (const req of required) {
    assert.ok(SUPPORTED_STYLE_PRESET_NAMES.includes(req), `Missing required preset: ${req}`)
    const preset = CANONICAL_STYLE_PRESETS[req]
    assert.ok(preset, `Preset object missing for ${req}`)
    assert.equal(typeof preset.promptSuffix, 'string')
    assert.ok(preset.promptSuffix.length > 5)
    assert.equal(typeof preset.negativePrompt, 'string')
    assert.ok(preset.negativePrompt.length > 5)
    assert.equal(typeof preset.guidanceScale, 'number')
    assert.ok(preset.guidanceScale >= 1 && preset.guidanceScale <= 20)
  }
})

test('style-presets #457: normalizeStyleKey maps canonical keys and aliases', () => {
  assert.equal(normalizeStyleKey('photorealistic'), 'photorealistic')
  assert.equal(normalizeStyleKey('photo'), 'photorealistic')
  assert.equal(normalizeStyleKey('realism'), 'photorealistic')

  assert.equal(normalizeStyleKey('anime'), 'anime')

  assert.equal(normalizeStyleKey('isometric_3d'), 'isometric_3d')
  assert.equal(normalizeStyleKey('isometric'), 'isometric_3d')
  assert.equal(normalizeStyleKey('isometric-3d'), 'isometric_3d')

  assert.equal(normalizeStyleKey('pixel_art'), 'pixel_art')
  assert.equal(normalizeStyleKey('pixel'), 'pixel_art')

  assert.equal(normalizeStyleKey('minimalist_vector'), 'minimalist_vector')
  assert.equal(normalizeStyleKey('vector'), 'minimalist_vector')
  assert.equal(normalizeStyleKey('minimalist'), 'minimalist_vector')

  assert.equal(normalizeStyleKey('claymation'), 'claymation')
  assert.equal(normalizeStyleKey('clay'), 'claymation')

  assert.equal(normalizeStyleKey('analog_film'), 'analog_film')
  assert.equal(normalizeStyleKey('film'), 'analog_film')
  assert.equal(normalizeStyleKey('analog'), 'analog_film')

  assert.equal(normalizeStyleKey(null), null)
  assert.equal(normalizeStyleKey(undefined), null)
})

test('style-presets #457: resolveStylePreset returns positive modifiers, merged negative and guidance', () => {
  const animeRes = resolveStylePreset('anime')
  assert.ok(animeRes.promptSuffix.includes('clean anime aesthetic'))
  assert.ok(animeRes.negativePrompt.includes('photorealistic'))
  assert.equal(animeRes.guidanceScale, 7.0)

  // Merging user negative with preset negative without duplication
  const combinedNeg = resolveStylePreset('photorealistic', 'watermark, text', 8.5)
  assert.ok(combinedNeg.negativePrompt.startsWith('watermark, text'))
  assert.ok(combinedNeg.negativePrompt.includes('illustration'))
  assert.equal(combinedNeg.guidanceScale, 8.5) // user guidance scale takes precedence

  // Handles 'none' and empty gracefully
  assert.deepEqual(resolveStylePreset('none', 'blurry', 7), {
    promptSuffix: '',
    negativePrompt: 'blurry',
    guidanceScale: 7,
  })
  assert.deepEqual(resolveStylePreset(null), {
    promptSuffix: '',
    negativePrompt: undefined,
    guidanceScale: undefined,
  })
})

test('style-presets #457: applyStylePreset enriches base prompt', () => {
  const base = 'a cat sitting on a windowsill'
  const enriched = applyStylePreset(base, 'cyberpunk')
  assert.ok(enriched.startsWith('a cat sitting on a windowsill, cyberpunk aesthetic'))

  assert.equal(applyStylePreset(base, null), base)
})

test('style-presets #457: prompt-polisher re-exports and integrates presets', () => {
  assert.ok(CURATED_STYLES.claymation)
  assert.ok(CURATED_STYLES.pixel_art)

  const polished = polishPrompt('cyber dragon', 'pixel_art')
  assert.ok(polished.prompt.includes('cyber dragon'))
  assert.ok(polished.prompt.includes('pixel art'))
  assert.ok(polished.negativePrompt.includes('smooth vector'))
  assert.equal(polished.styleApplied, 'pixel_art')
})

test('style-presets #457: lib/tools/generation.js declares style_preset in tool schema', () => {
  const src = readFileSync(path.join(lib, 'tools', 'generation.js'), 'utf8')
  assert.match(src, /style_preset:\s*\{/)
  assert.match(src, /photorealistic/)
  assert.match(src, /isometric_3d/)
  assert.match(src, /pixel_art/)
  assert.match(src, /claymation/)
})
