import test from 'node:test'
import assert from 'node:assert/strict'
import {
  setSessionAnchor,
  getSessionAnchor,
  clearSessionAnchor,
  clearAllAnchors,
  normalizeAnchorStrength,
  applyAnchorPromptHints,
} from '../lib/anchor-helpers.js'

test('anchor-helpers: normalizeAnchorStrength clamps within [0.1, 1.0]', () => {
  assert.equal(normalizeAnchorStrength(undefined), 0.65)
  assert.equal(normalizeAnchorStrength(-0.5), 0.1)
  assert.equal(normalizeAnchorStrength(2.5), 1.0)
  assert.equal(normalizeAnchorStrength(0.85), 0.85)
})

test('anchor-helpers: setSessionAnchor and getSessionAnchor manage session state', () => {
  clearAllAnchors()
  const anchor = setSessionAnchor('session-1', {
    image: 'sha256:abcd1234ef',
    label: 'Cyberpunk Protagonist',
    mode: 'character',
    strength: 0.8,
  })

  assert.equal(anchor.image, 'sha256:abcd1234ef')
  assert.equal(anchor.label, 'Cyberpunk Protagonist')
  assert.equal(anchor.mode, 'character')
  assert.equal(anchor.strength, 0.8)

  const retrieved = getSessionAnchor('session-1')
  assert.deepEqual(retrieved, anchor)

  // Different session returns null
  assert.equal(getSessionAnchor('session-2'), null)
})

test('anchor-helpers: clearSessionAnchor removes active anchor', () => {
  clearAllAnchors()
  setSessionAnchor('session-abc', { image: 'https://example.com/mascot.png' })
  assert.ok(getSessionAnchor('session-abc'))

  const cleared = clearSessionAnchor('session-abc')
  assert.equal(cleared, true)
  assert.equal(getSessionAnchor('session-abc'), null)

  const clearedAgain = clearSessionAnchor('session-abc')
  assert.equal(clearedAgain, false)
})

test('anchor-helpers: applyAnchorPromptHints injects character and style hints without duplicates', () => {
  const charAnchor = { label: 'Neon Samurai', mode: 'character' }
  const styled1 = applyAnchorPromptHints(charAnchor, 'Standing in the rain')
  assert.ok(styled1.includes('visual character anchor: Neon Samurai'))
  assert.ok(styled1.includes('consistent facial features'))

  // Avoid duplicate injection
  const styled2 = applyAnchorPromptHints(charAnchor, 'Neon Samurai drinking tea')
  assert.equal(styled2, 'Neon Samurai drinking tea')

  const styleAnchor = { label: 'Pastel Watercolor', mode: 'style' }
  const styled3 = applyAnchorPromptHints(styleAnchor, 'A serene mountain lake')
  assert.ok(styled3.includes('visual style anchor: Pastel Watercolor'))
  assert.ok(styled3.includes('consistent aesthetic palette'))
})
