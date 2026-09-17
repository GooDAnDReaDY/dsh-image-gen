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
  scoreEdgeWrap,
  tilePixels,
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

test('scoreEdgeWrap: identical edges score 1, opposite edges lower', () => {
  const w = 4, h = 4, ch = 4
  const solid = new Uint8Array(w * h * ch).fill(200)
  assert.equal(scoreEdgeWrap(solid, w, h, ch), 1)
  const split = new Uint8Array(w * h * ch)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * ch
      const v = x < w / 2 ? 0 : 255
      split[o] = split[o + 1] = split[o + 2] = v
      split[o + 3] = 255
    }
  }
  assert.ok(scoreEdgeWrap(split, w, h, ch) < 1)
})

test('tilePixels: 2x2 and 3x3 keep tile dimensions', () => {
  const w = 2, h = 2, ch = 4
  const px = new Uint8Array(w * h * ch).fill(10)
  const t2 = tilePixels(px, w, h, ch, 2, 2)
  assert.equal(t2.width, 4)
  assert.equal(t2.height, 4)
  assert.equal(t2.pixels.length, 4 * 4 * ch)
  const t3 = tilePixels(px, w, h, ch, 3, 3)
  assert.equal(t3.width, 6)
  assert.equal(t3.height, 6)
  assert.equal(scoreEdgeWrap(t2.pixels, t2.width, t2.height, ch), 1)
})
