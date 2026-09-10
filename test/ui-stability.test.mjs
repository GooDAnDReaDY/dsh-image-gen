import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { sanitizeErrorAndLogs } from '../lib/security.js'
import { trackAndAssertLoopGuard, resetLoopGuard } from '../lib/loop-guard.js'
import { calculateGenerationCost, assertBudgetAvailable } from '../lib/cost-meter.js'

test('ui-stability: Config schema has all required keys synchronized with client fields', () => {
  const indexCode = fs.readFileSync('lib/index.js', 'utf8')
  const clientCode = fs.readFileSync('lib/client.js', 'utf8')

  const expectedKeys = [
    'enabled', 'provider', 'defaultSize', 'defaultFormat', 'deliverAs', 'outputDir', 'historyLimit', 'pruneDays',
    'model', 'apiKeyEnv', 'baseURL', 'pollIntervalMs', 'timeoutMs',
    'customBaseURL', 'customModel', 'customKeyEnv', 'customSize',
    'replicateModel', 'replicateKeyEnv',
    'seedreamModel', 'seedreamKeyEnv', 'seedreamBaseURL',
    'geminiModel', 'geminiKeyEnv',
    'localKind', 'localBaseURL', 'localModel', 'localSteps', 'localCfg',
    'subscriptionQuality',
    'enhancePrompt', 'enhanceModel', 'enhanceBelowChars', 'stylePreset',
    'qualityGate', 'dailyBudgetUsd', 'loopGuardLimit',
    'diskCache', 'cacheBySeed', 'cacheByPrompt',
  ]

  for (const k of expectedKeys) {
    assert.ok(indexCode.includes(`${k}: z`), `index.js Config missing key: ${k}`)
    assert.ok(clientCode.includes(`field: '${k}'`), `client.js FIELDS missing key: ${k}`)
  }
})

test('ui-stability: client.js declares all 5 organized tabs', () => {
  const clientCode = fs.readFileSync('lib/client.js', 'utf8')
  const tabs = ['general', 'provider', 'enhancer', 'safety', 'cache']
  for (const t of tabs) {
    assert.ok(clientCode.includes(`tab: '${t}'`), `Missing tab '${t}' in FIELDS definition`)
    assert.ok(clientCode.includes(`'tab.${t}'`), `Missing translation key 'tab.${t}'`)
  }
})

test('ui-stability: client.js registers toolviews for all 8 visual tools', () => {
  const clientCode = fs.readFileSync('lib/client.js', 'utf8')
  const tools = [
    'generate_image',
    'edit_image',
    'vary_image',
    'blend_images',
    'generate_image_pack',
    'remove_background',
    'upscale_image',
    'vectorize_image',
  ]
  for (const tool of tools) {
    assert.ok(clientCode.includes(`'${tool}'`), `toolview must include tool: ${tool}`)
  }
})

test('ui-stability: ErrorBoundary is defined and wraps SettingsCard and Toolviews', () => {
  const clientCode = fs.readFileSync('lib/client.js', 'utf8')
  assert.ok(clientCode.includes('function createErrorBoundary()'), 'must declare createErrorBoundary')
  assert.ok(clientCode.includes('react.createElement(ErrorBoundary'), 'must wrap slots in ErrorBoundary')
  assert.ok(clientCode.includes('ig-alert-err'), 'must use ig-alert-err for fallback UI')
})

test('ui-stability: Quick stats row and DSH design tokens are present in CSS', () => {
  const clientCode = fs.readFileSync('lib/client.js', 'utf8')
  assert.ok(clientCode.includes('.ig-page'), 'must include .ig-page class')
  assert.ok(clientCode.includes('.ig-grid-4'), 'must include .ig-grid-4 class')
  assert.ok(clientCode.includes('.ig-stat-box'), 'must include .ig-stat-box class')
  assert.ok(clientCode.includes('.ig-badge-ok'), 'must include .ig-badge-ok class')
  assert.ok(clientCode.includes('.ig-badge-warn'), 'must include .ig-badge-warn class')
  assert.ok(clientCode.includes('.ig-badge-bad'), 'must include .ig-badge-bad class')
  assert.ok(clientCode.includes('var(--dsw-alias-border-l2)'), 'must use DSH design token border-l2')
  assert.ok(clientCode.includes('var(--dsw-alias-bg-layer-3)'), 'must use DSH design token bg-layer-3')
  assert.ok(clientCode.includes('var(--dsw-alias-label-primary)'), 'must use DSH design token label-primary')
})

test('ui-stability: security masking covers API keys in complex error structures', () => {
  const leakedKey = 'sk-proj-abc123456789XYZabcdefghij'
  const text = `Failed generation with ${leakedKey} on route https://fal.run?key=fal_test_secret_key_8899`
  const masked = sanitizeErrorAndLogs(text)
  assert.ok(!masked.includes(leakedKey), 'Leaked OpenAI project key must be masked')
  assert.ok(!masked.includes('fal_test_secret_key_8899'), 'Leaked FAL query key must be masked')
})

test('ui-stability: budget and loop guard throw descriptive errors when limits are reached', () => {
  const sid = 'loop_guard_test_' + Math.random().toString(36).slice(2)
  resetLoopGuard(sid)

  trackAndAssertLoopGuard(sid, { limit: 2, prompt: 'cat' })
  trackAndAssertLoopGuard(sid, { limit: 2, prompt: 'cat' })
  assert.throws(
    () => trackAndAssertLoopGuard(sid, { limit: 2, prompt: 'cat' }),
    /Generation loop limit reached/
  )

  assert.throws(
    () => assertBudgetAvailable(5.00, 1.00),
    /Daily image generation budget exceeded/
  )
})
