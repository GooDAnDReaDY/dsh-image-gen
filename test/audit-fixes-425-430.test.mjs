import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())

test('audit-fixes #425: en and zh dictionaries have 100% key parity and cover all t() literals', () => {
  const enSrc = readFileSync(join(root, 'src/client/110-locale-en.js'), 'utf8')
  const zhSrc = readFileSync(join(root, 'src/client/120-locale-zh.js'), 'utf8')

  const extractKeys = (src) => {
    const keys = new Set()
    for (const line of src.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('//')) continue
      const m = trimmed.match(/^['"]([a-zA-Z0-9_.-]+)['"]\s*:/)
      if (m) keys.add(m[1])
    }
    return keys
  }

  const enKeys = extractKeys(enSrc)
  const zhKeys = extractKeys(zhSrc)

  assert.ok(enKeys.size >= 300, `Expected at least 300 keys, got ${enKeys.size}`)
  assert.equal(enKeys.size, zhKeys.size, `Dictionary sizes differ: en=${enKeys.size}, zh=${zhKeys.size}`)

  const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k))
  const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k))
  assert.deepEqual(missingInZh, [], `Keys present in en but missing in zh: ${missingInZh.join(', ')}`)
  assert.deepEqual(missingInEn, [], `Keys present in zh but missing in en: ${missingInEn.join(', ')}`)

  // Check all t() calls across all src/client files
  const clientFiles = readdirSync(join(root, 'src/client')).filter((f) => f.endsWith('.js'))
  const missingLiterals = new Set()

  for (const f of clientFiles) {
    const fc = readFileSync(join(root, 'src/client', f), 'utf8')
    const matches = fc.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g)
    for (const m of matches) {
      const key = m[1]
      if (!enKeys.has(key)) missingLiterals.add(key)
    }
  }

  assert.deepEqual([...missingLiterals], [], `Unlocalized t() calls: ${[...missingLiterals].join(', ')}`)
})

test('audit-fixes #426: client fetch calls use fetchJson with timeout and no raw fetch remains', () => {
  const clientFiles = readdirSync(join(root, 'src/client')).filter((f) => f.endsWith('.js'))
  let rawFetchCount = 0

  for (const f of clientFiles) {
    if (f === '00-runtime.js') continue // 00-runtime.js defines fetchJson which wraps fetch
    const fc = readFileSync(join(root, 'src/client', f), 'utf8')
    const matches = fc.match(/\bfetch\(/g)
    if (matches) {
      rawFetchCount += matches.length
    }
  }

  assert.equal(rawFetchCount, 0, `Expected 0 raw fetch() calls in src/client, found ${rawFetchCount}`)

  // Verify fetchJson is defined in 00-runtime.js with timeout support
  const runtimeSrc = readFileSync(join(root, 'src/client/00-runtime.js'), 'utf8')
  assert.ok(runtimeSrc.includes('async function fetchJson('), 'fetchJson should be declared in 00-runtime.js')
  assert.ok(runtimeSrc.includes('timeoutMs = 15000'), 'fetchJson should define default 15s timeout')
  assert.ok(runtimeSrc.includes('AbortSignal.timeout'), 'fetchJson should support AbortSignal.timeout')
})

test('audit-fixes #427: 90-settings-card.js does not contain hardcoded English strings', () => {
  const cardSrc = readFileSync(join(root, 'src/client/90-settings-card.js'), 'utf8')

  assert.ok(!cardSrc.includes("'Gate Active'"), "Should not contain hardcoded 'Gate Active'")
  assert.ok(!cardSrc.includes("'Cache ON'"), "Should not contain hardcoded 'Cache ON'")
  assert.ok(!cardSrc.includes("'No limit'"), "Should not contain hardcoded 'No limit'")
  assert.ok(!cardSrc.includes("'Settings Sections'"), "Should not contain hardcoded 'Settings Sections'")
  assert.ok(!cardSrc.includes("'Guard ' +"), "Should not contain hardcoded 'Guard ' +")

  assert.ok(cardSrc.includes("t('stat.gateActive'"), "Should use t('stat.gateActive')")
  assert.ok(cardSrc.includes("t('stat.cacheOn'"), "Should use t('stat.cacheOn')")
  assert.ok(cardSrc.includes("t('stat.noLimit'"), "Should use t('stat.noLimit')")
  assert.ok(cardSrc.includes("t('label.settingsSections'"), "Should use t('label.settingsSections')")
  assert.ok(cardSrc.includes("t('stat.guard'"), "Should use t('stat.guard')")
})

test('audit-fixes #428: lib/providers/backends/custom.js has no mojibake', () => {
  const customSrc = readFileSync(join(root, 'lib/providers/backends/custom.js'), 'utf8')

  // Check for broken UTF-8 sequences
  assert.ok(!customSrc.includes('в†’'), 'Should not contain mojibake for arrow')
  assert.ok(!customSrc.includes('вЂ”'), 'Should not contain mojibake for dash')
  assert.ok(customSrc.includes('Settings -> Image generation') || customSrc.includes('Settings → Image generation'), 'Should have valid settings arrow path')
})

test('audit-fixes #429: clearSpendReservations and getLiveProgress are integrated in prod runtime', () => {
  const indexSrc = readFileSync(join(root, 'lib/index.js'), 'utf8')
  const liveSrc = readFileSync(join(root, 'lib/live-progress.js'), 'utf8')

  assert.ok(indexSrc.includes('clearSpendReservations()'), 'clearSpendReservations should be called in dispose cleanup in index.js')
  assert.ok(liveSrc.includes('getLiveProgress(callId)'), 'getLiveProgress should be called on SSE connection in live-progress.js')
})

test('audit-fixes #430: class fal_head is completely replaced by ig-card-head', () => {
  const clientBundle = readFileSync(join(root, 'lib/client.js'), 'utf8')
  const cssSrc = readFileSync(join(root, 'src/client/10-css.js'), 'utf8')

  assert.ok(!cssSrc.includes('.fal_head'), 'CSS should not contain .fal_head')
  assert.ok(cssSrc.includes('.ig-card-head'), 'CSS should contain .ig-card-head')
  assert.ok(!clientBundle.includes('fal_head'), 'client.js bundle should not contain fal_head')
  assert.ok(clientBundle.includes('ig-card-head'), 'client.js bundle should contain ig-card-head')
})
