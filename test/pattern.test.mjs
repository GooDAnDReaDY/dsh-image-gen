// generate_seamless_pattern helpers (#178)

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSeamlessPrompt,
  buildPatternCss,
  normalizeDensity,
} from '../lib/pattern-helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))

test('buildSeamlessPrompt: wrap + density + style', () => {
  const p = buildSeamlessPrompt('terrazzo chips', 'flat vector', 'high')
  assert.match(p, /terrazzo chips/)
  assert.match(p, /flat vector/)
  assert.match(p, /wrap continuously/)
  assert.match(p, /dense repeating/)
  assert.match(p, /No vignette/)
})

test('normalizeDensity: only low/medium/high', () => {
  assert.equal(normalizeDensity('high'), 'high')
  assert.equal(normalizeDensity('LOW'), 'low')
  assert.equal(normalizeDensity('nope'), 'medium')
  assert.equal(normalizeDensity(undefined), 'medium')
})

test('buildPatternCss: repeat and size', () => {
  const css = buildPatternCss({ className: 'tiles', sizePx: 512, imagePath: './tiles.png' })
  assert.match(css, /background-repeat: repeat/)
  assert.match(css, /background-size: 512px 512px/)
  assert.match(css, /url\('\.\/tiles\.png'\)/)
})

test('pattern tool is registered', () => {
  const src = readFileSync(path.join(here, '..', 'lib', 'tools', 'pattern.js'), 'utf8')
  assert.match(src, /name: 'generate_seamless_pattern'/)
  const reg = readFileSync(path.join(here, '..', 'lib', 'register-tools.js'), 'utf8')
  assert.match(reg, /registerPatternTools/)
})
