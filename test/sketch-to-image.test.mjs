// sketch_to_image schema and helper checks (#146)

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(here, '..', 'lib')

test('sketch_to_image: tool file declares required parameters and lower default strength', () => {
  const src = readFileSync(path.join(lib, 'tools', 'sketch.js'), 'utf8')
  assert.match(src, /name: 'sketch_to_image'/)
  assert.match(src, /prompt:\s*\{[\s\S]*?required: true/)
  assert.match(src, /image:\s*\{/)
  assert.match(src, /strength:\s*\{/)
  assert.match(src, /args\.strength \?\? 0\.45/)
  assert.match(src, /SKETCH_PROMPT_SUFFIX/)
  assert.match(src, /Preserve the original composition/)
})

test('sketch_to_image: registered from register-tools and listed in lifecycle tools', () => {
  const reg = readFileSync(path.join(lib, 'register-tools.js'), 'utf8')
  assert.match(reg, /registerSketchTools/)
  const life = readFileSync(path.join(here, 'lifecycle-structure.test.mjs'), 'utf8')
  assert.match(life, /'sketch_to_image'/)
})

test('sketch_to_image: SVG detection accepts svg media type and <svg sniff', () => {
  const src = readFileSync(path.join(lib, 'tools', 'sketch.js'), 'utf8')
  assert.match(src, /function isSvgSource/)
  assert.match(src, /image\/svg\+xml/)
  assert.match(src, /<svg/)
})
