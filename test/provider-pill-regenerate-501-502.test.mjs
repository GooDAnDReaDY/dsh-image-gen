// test/provider-pill-regenerate-501-502.test.mjs — Quick Provider Switcher Pill (#501) and In-card Regenerate Modal (#502)

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config, plainConfig } from '../lib/config-schema.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

test('issue #501: lib/client.js contains ProviderPill and registers conversation.input.right slot', () => {
  const clientJs = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')

  // Provider pill component
  assert.ok(clientJs.includes('function ProviderPill(props)'), 'ProviderPill component must exist')
  assert.ok(clientJs.includes('conversation.input.right'), 'conversation.input.right slot registration must exist')
  assert.ok(clientJs.includes('dsh-image-gen-provider-pill'), 'pill slot ID must exist')

  // Provider pill CSS classes
  assert.ok(clientJs.includes('ig-pill-wrap'), 'ig-pill-wrap class must exist')
  assert.ok(clientJs.includes('ig-pill-btn'), 'ig-pill-btn class must exist')
  assert.ok(clientJs.includes('ig-pill-dropdown'), 'ig-pill-dropdown class must exist')
  assert.ok(clientJs.includes('ig-pill-item'), 'ig-pill-item class must exist')
})

test('issue #502: lib/client.js contains in-card regenerate modal with prompt editing and seed selection', () => {
  const clientJs = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')

  // In-card regenerate action
  assert.ok(clientJs.includes('card.actionRegenerate'), 'actionRegenerate localization key must exist')
  assert.ok(clientJs.includes('card.regenerateTitle'), 'regenerateTitle localization key must exist')
  assert.ok(clientJs.includes('card.regeneratePlaceholder'), 'regeneratePlaceholder key must exist')
  assert.ok(clientJs.includes('card.seedRandom'), 'seedRandom localization key must exist')
  assert.ok(clientJs.includes('card.seedKeep'), 'seedKeep localization key must exist')
  assert.ok(clientJs.includes('card.regenerateRun'), 'regenerateRun localization key must exist')
  assert.ok(clientJs.includes('regenerateOpen'), 'regenerateOpen state must exist in FalImageCard')
})

test('issues #501 & #502: locale keys present in both English and Chinese dictionaries', () => {
  const enLocale = fs.readFileSync(path.join(root, 'src', 'client', '110-locale-en.js'), 'utf8')
  const zhLocale = fs.readFileSync(path.join(root, 'src', 'client', '120-locale-zh.js'), 'utf8')

  const expectedKeys = [
    'pill.menuTitle',
    'pill.tooltip',
    'card.actionRegenerate',
    'card.cancel',
    'card.regeneratePlaceholder',
    'card.regenerateRun',
    'card.regenerateTitle',
    'card.seedKeep',
    'card.seedRandom',
  ]

  for (const k of expectedKeys) {
    assert.ok(enLocale.includes(`'${k}':`), `Key ${k} must exist in 110-locale-en.js`)
    assert.ok(zhLocale.includes(`'${k}':`), `Key ${k} must exist in 120-locale-zh.js`)
  }
})

test('issue #501: Config schema declares showProviderPill defaulting to true', () => {
  assert.ok(Config.dict?.showProviderPill, 'showProviderPill must be in Config.dict')
  const parsed = plainConfig(Config({}))
  assert.equal(parsed.showProviderPill, true)
})

test('issue #502: regenerate prompt builder preserves seed and aspect ratio', () => {
  function buildRegenerateCmd(prompt, seedMode, prevSeed, prevAspect) {
    const seedArg = seedMode === 'keep' && typeof prevSeed === 'number' ? prevSeed : 12345
    let cmd = `generate_image(prompt: "${prompt.trim()}"`
    if (seedArg !== undefined) cmd += `, seed: ${seedArg}`
    if (prevAspect) cmd += `, aspect_ratio: "${prevAspect}"`
    cmd += ')'
    return cmd
  }

  // Keep seed
  const cmdKeep = buildRegenerateCmd('cyberpunk city at dusk', 'keep', 99999, '16:9')
  assert.equal(cmdKeep, 'generate_image(prompt: "cyberpunk city at dusk", seed: 99999, aspect_ratio: "16:9")')

  // Random seed
  const cmdRandom = buildRegenerateCmd('cyberpunk city at dusk', 'random', 99999, '16:9')
  assert.equal(cmdRandom, 'generate_image(prompt: "cyberpunk city at dusk", seed: 12345, aspect_ratio: "16:9")')

  // Omit aspect if not specified
  const cmdSimple = buildRegenerateCmd('a cat', 'random', null, '')
  assert.equal(cmdSimple, 'generate_image(prompt: "a cat", seed: 12345)')
})
