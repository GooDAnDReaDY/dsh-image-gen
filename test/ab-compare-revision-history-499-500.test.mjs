// test/ab-compare-revision-history-499-500.test.mjs — Interactive A/B Comparison Slider (#499) and Revision Switcher Carousel (#500)

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPresentationMeta } from '../lib/attachment-helper.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

test('issue #499 & #500: lib/client.js contains A/B comparison slider and persistent revision history', () => {
  const clientJs = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')

  // A/B comparison slider elements
  assert.ok(clientJs.includes('function ImageCompareSlider(props)'), 'ImageCompareSlider component must exist')
  assert.ok(clientJs.includes('ig-ab-container'), 'ig-ab-container CSS class must exist')
  assert.ok(clientJs.includes('ig-ab-divider'), 'ig-ab-divider CSS class must exist')
  assert.ok(clientJs.includes('ig-ab-handle'), 'ig-ab-handle element must exist')
  assert.ok(clientJs.includes('card.compare'), 't("card.compare") localization call must exist')
  assert.ok(clientJs.includes('card.hideCompare'), 't("card.hideCompare") localization call must exist')
  assert.ok(clientJs.includes('card.before'), 't("card.before") localization call must exist')
  assert.ok(clientJs.includes('card.after'), 't("card.after") localization call must exist')

  // Revision persistence elements
  assert.ok(clientJs.includes('loadStoredRevisions'), 'loadStoredRevisions helper must exist')
  assert.ok(clientJs.includes('saveStoredRevisions'), 'saveStoredRevisions helper must exist')
  assert.ok(clientJs.includes('dsh_image_gen_revisions:'), 'dsh_image_gen_revisions: prefix must exist')
  assert.ok(clientJs.includes('MAX_STORED_REVISIONS = 20'), '20-item revision cap must exist')
})

test('issue #499 & #500: locales en & zh contain comparison keys', () => {
  const enLocale = fs.readFileSync(path.join(root, 'src', 'client', '110-locale-en.js'), 'utf8')
  const zhLocale = fs.readFileSync(path.join(root, 'src', 'client', '120-locale-zh.js'), 'utf8')

  for (const key of ['card.compare', 'card.hideCompare', 'card.before', 'card.after']) {
    assert.ok(enLocale.includes(`'${key}':`), `en locale must contain key ${key}`)
    assert.ok(zhLocale.includes(`'${key}':`), `zh locale must contain key ${key}`)
  }
})

test('issue #499: buildPresentationMeta includes before_image, beforeUrl, and sourceUrl', () => {
  const meta = buildPresentationMeta({
    url: 'https://cdn.example.com/restored.png',
    path: '/output/restored.png',
    before_image: 'https://cdn.example.com/orig.png',
    beforeUrl: 'https://cdn.example.com/orig2.png',
    sourceUrl: 'https://cdn.example.com/source.png',
    prompt: 'restore face details',
  })

  assert.equal(meta.before_image, 'https://cdn.example.com/orig.png')
  assert.equal(meta.beforeUrl, 'https://cdn.example.com/orig2.png')
  assert.equal(meta.sourceUrl, 'https://cdn.example.com/source.png')
  assert.equal(meta.url, 'https://cdn.example.com/restored.png')
})

test('issue #500: revision persistence storage semantics simulation', () => {
  const mockStorage = new Map()
  const PREFIX = 'dsh_image_gen_revisions:'
  const MAX = 20

  function loadStored(cardId) {
    if (!cardId) return []
    const raw = mockStorage.get(PREFIX + cardId)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch (_) {
      return []
    }
  }

  function saveStored(cardId, revisions) {
    if (!cardId) return
    const list = Array.isArray(revisions) ? revisions.slice(-MAX) : []
    mockStorage.set(PREFIX + cardId, JSON.stringify(list))
  }

  // Initial load on empty
  assert.deepEqual(loadStored('card-1'), [])

  // Save 3 revisions
  const list3 = [
    { url: 'u1', seed: 100 },
    { url: 'u2', seed: 101 },
    { url: 'u3', seed: 102 },
  ]
  saveStored('card-1', list3)
  assert.deepEqual(loadStored('card-1'), list3)

  // Cap at 20 items
  const bigList = []
  for (let i = 0; i < 30; i++) bigList.push({ url: `url-${i}`, seed: i })
  saveStored('card-2', bigList)
  const loadedBig = loadStored('card-2')
  assert.equal(loadedBig.length, 20)
  assert.equal(loadedBig[0].url, 'url-10')
  assert.equal(loadedBig[19].url, 'url-29')

  // Corrupted JSON returns empty array gracefully
  mockStorage.set(PREFIX + 'corrupted', 'INVALID_JSON{')
  assert.deepEqual(loadStored('corrupted'), [])
})
