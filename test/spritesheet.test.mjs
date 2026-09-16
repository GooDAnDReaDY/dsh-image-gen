// generate_spritesheet helpers (#177)

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSpritesheetCss,
  buildSpritesheetSvg,
  buildFramePrompts,
} from '../lib/spritesheet-helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))

test('buildSpritesheetCss: steps keyframes and frame box', () => {
  const css = buildSpritesheetCss({ frameCount: 8, frameW: 512, frameH: 512, durationSec: 0.8, name: 'hero' })
  assert.match(css, /animation: hero 0\.8s steps\(8\) infinite/)
  assert.match(css, /@keyframes hero/)
  assert.match(css, /background-position: -4096px 0/)
  assert.match(css, /width: 512px/)
})

test('buildSpritesheetSvg: one image per frame on horizontal strip', () => {
  const frames = [
    { bytes: Buffer.from('a'), mediaType: 'image/png' },
    { bytes: Buffer.from('b'), mediaType: 'image/png' },
    { bytes: Buffer.from('c'), mediaType: 'image/png' },
    { bytes: Buffer.from('d'), mediaType: 'image/png' },
  ]
  const svg = buildSpritesheetSvg(frames, { frameW: 64, frameH: 64 })
  assert.match(svg, /width="256" height="64"/)
  assert.equal((svg.match(/<image /g) || []).length, 4)
  assert.match(svg, /x="192"/)
})

test('buildFramePrompts: frame count and animation phase', () => {
  const prompts = buildFramePrompts('pixel knight', 'walk', 8)
  assert.equal(prompts.length, 8)
  assert.match(prompts[0], /frame 1 of 8/)
  assert.match(prompts[0], /pixel knight/)
})

test('spritesheet tool file declares tool name; helpers clamp frames', () => {
  const src = readFileSync(path.join(here, '..', 'lib', 'tools', 'spritesheet.js'), 'utf8')
  assert.match(src, /name: 'generate_spritesheet'/)
  assert.match(src, /from '\.\.\/spritesheet-helpers\.js'/)
  const helpers = readFileSync(path.join(here, '..', 'lib', 'spritesheet-helpers.js'), 'utf8')
  assert.match(helpers, /v === 4 \|\| v === 8 \|\| v === 12/)
})
