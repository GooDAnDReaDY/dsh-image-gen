import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_MATRIX_STYLES,
  MATRIX_PRESET_PROMPTS,
  normalizeMatrixStyles,
  buildMatrixCellPrompt,
  formatMatrixMarkdown,
} from '../lib/style-matrix-helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(here, '..', 'lib')

test('style-matrix: normalizeMatrixStyles returns exactly 4 unique styles', () => {
  const norm1 = normalizeMatrixStyles(['anime', 'cyberpunk'])
  assert.equal(norm1.length, 4)
  assert.equal(norm1[0], 'anime')
  assert.equal(norm1[1], 'cyberpunk')
  assert.equal(new Set(norm1).size, 4)

  const norm2 = normalizeMatrixStyles(['a', 'b', 'c', 'd', 'e'])
  assert.equal(norm2.length, 4)
  assert.deepEqual(norm2, ['a', 'b', 'c', 'd'])

  const norm3 = normalizeMatrixStyles(undefined)
  assert.equal(norm3.length, 4)
  assert.deepEqual(norm3, DEFAULT_MATRIX_STYLES)
})

test('style-matrix: buildMatrixCellPrompt combines base and preset directive', () => {
  const cellPrompt = buildMatrixCellPrompt('a serene samurai garden', 'flat_vector')
  assert.ok(cellPrompt.includes('a serene samurai garden'))
  assert.ok(cellPrompt.includes('minimal flat vector art'))
})

test('style-matrix: formatMatrixMarkdown formats 2x2 presentation grid', () => {
  const cells = [
    { id: 'A', style: 'editorial_photo', seed: 100, path: '/tmp/a.png' },
    { id: 'B', style: 'flat_vector', seed: 200, path: '/tmp/b.png' },
    { id: 'C', style: 'clay_3d', seed: 300, path: '/tmp/c.png' },
    { id: 'D', style: 'cyberpunk', seed: 400, path: '/tmp/d.png' },
  ]

  const normalMd = formatMatrixMarkdown({ basePrompt: 'cosmic whale', blindMode: false, cells })
  assert.ok(normalMd.includes('**editorial_photo**'))
  assert.ok(normalMd.includes('| **A** |'))

  const blindMd = formatMatrixMarkdown({ basePrompt: 'cosmic whale', blindMode: true, cells })
  assert.ok(blindMd.includes('Option A'))
  assert.ok(blindMd.includes('Blind Comparison Mode'))
  assert.ok(!blindMd.includes('**editorial_photo**'))
})

test('style-matrix: tool file declares generate_style_matrix and parameters', () => {
  const src = readFileSync(path.join(lib, 'tools', 'style-matrix.js'), 'utf8')
  assert.match(src, /name: 'generate_style_matrix'/)
  assert.match(src, /prompt:\s*\{[\s\S]*?required: true/)
  assert.match(src, /styles:\s*\{/)
  assert.match(src, /blind_mode:\s*\{/)
  assert.match(src, /executeWithFallback/)
})
