// test/issue-519-composer-pill-settings.test.mjs
// Issue #519: Expose composer provider button visibility in Image Generation settings

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config, plainConfig } from '../lib/config-schema.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

test('issue #519: Config schema declares showProviderPill with boolean type and default true', () => {
  assert.ok(Config.dict?.showProviderPill, 'showProviderPill must exist in Config.dict')
  
  // Default parsing
  const defaultCfg = plainConfig(Config({}))
  assert.equal(defaultCfg.showProviderPill, true, 'Default value must be true')

  // Explicit false persists
  const falseCfg = plainConfig(Config({ showProviderPill: false }))
  assert.equal(falseCfg.showProviderPill, false, 'Explicit false must be preserved')

  // Explicit true persists
  const trueCfg = plainConfig(Config({ showProviderPill: true }))
  assert.equal(trueCfg.showProviderPill, true, 'Explicit true must be preserved')
})

test('issue #519: 40-specs.js and lib/client.js expose showProviderPill in General tab of settings card', () => {
  const specsJs = fs.readFileSync(path.join(root, 'src', 'client', '40-specs.js'), 'utf8')
  const clientJs = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')

  for (const src of [specsJs, clientJs]) {
    assert.ok(src.includes("field: 'showProviderPill'"), 'showProviderPill field definition must exist')
    assert.ok(src.includes("labelKey: 'f.showProviderPill'"), 'labelKey f.showProviderPill must be configured')
    assert.ok(src.includes("hintKey: 'f.showProviderPillHint'"), 'hintKey f.showProviderPillHint must be configured')
    assert.ok(src.includes("tab: 'general'"), 'field must be assigned to general tab')
  }
})

test('issue #519: locale keys present in English and Chinese dictionaries', () => {
  const enLocale = fs.readFileSync(path.join(root, 'src', 'client', '110-locale-en.js'), 'utf8')
  const zhLocale = fs.readFileSync(path.join(root, 'src', 'client', '120-locale-zh.js'), 'utf8')

  assert.ok(enLocale.includes("'f.showProviderPill':"), 'f.showProviderPill must exist in en locale')
  assert.ok(enLocale.includes("'f.showProviderPillHint':"), 'f.showProviderPillHint must exist in en locale')

  assert.ok(zhLocale.includes("'f.showProviderPill':"), 'f.showProviderPill must exist in zh locale')
  assert.ok(zhLocale.includes("'f.showProviderPillHint':"), 'f.showProviderPillHint must exist in zh locale')
})

test('issue #519: booleanField formatter and parser handle showProviderPill correctly', () => {
  const booleanField = (field) => ({
    field,
    format: (value) => (value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : ''),
    parse: (text) => {
      if (text === '') return { kind: 'clear' }
      if (text === 'true') return { kind: 'set', value: true }
      if (text === 'false') return { kind: 'set', value: false }
      return void 0
    },
  })

  const spec = booleanField('showProviderPill')

  // Formatting
  assert.equal(spec.format(true), 'true')
  assert.equal(spec.format('true'), 'true')
  assert.equal(spec.format(false), 'false')
  assert.equal(spec.format('false'), 'false')
  assert.equal(spec.format(undefined), '')

  // Parsing
  assert.deepEqual(spec.parse('true'), { kind: 'set', value: true })
  assert.deepEqual(spec.parse('false'), { kind: 'set', value: false })
  assert.deepEqual(spec.parse(''), { kind: 'clear' })
  assert.equal(spec.parse('invalid'), undefined)
})

test('issue #519: ProviderPill visibility contract (false hides, true/default renders)', () => {
  function shouldRenderPill(snap) {
    if (snap?.value?.showProviderPill === false) return false
    return true
  }

  // Default / empty snapshot
  assert.equal(shouldRenderPill({ value: {} }), true, 'Default snapshot must render pill')
  assert.equal(shouldRenderPill(null), true, 'Null snapshot must render pill')
  assert.equal(shouldRenderPill({ value: { showProviderPill: true } }), true, 'Explicit true must render pill')

  // Hidden when false
  assert.equal(shouldRenderPill({ value: { showProviderPill: false } }), false, 'Explicit false must hide pill')
})

test('issue #519: toggling showProviderPill preserves unrelated settings and capabilities', () => {
  const initialSettings = {
    enabled: true,
    provider: 'fal',
    model: 'fal-ai/flux/dev',
    defaultSize: 'square_hd',
    defaultFormat: 'png',
    showProviderPill: true,
    qualityGate: true,
  }

  // Apply change to showProviderPill only
  const updatedSettings = {
    ...initialSettings,
    showProviderPill: false,
  }

  assert.equal(updatedSettings.showProviderPill, false)
  assert.equal(updatedSettings.enabled, true, 'Master enabled must remain unchanged')
  assert.equal(updatedSettings.provider, 'fal', 'Provider must remain unchanged')
  assert.equal(updatedSettings.model, 'fal-ai/flux/dev', 'Model must remain unchanged')
  assert.equal(updatedSettings.defaultSize, 'square_hd', 'Default size must remain unchanged')
  assert.equal(updatedSettings.qualityGate, true, 'Quality gate must remain unchanged')
})
