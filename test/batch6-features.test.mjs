import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { polishPrompt, CURATED_STYLES, normalizeStyleKey } from '../lib/prompt-polisher.js'
import { testProviderConnection } from '../lib/providers.js'

test('prompt-polisher: CURATED_STYLES catalog contains all 10 curated presets', () => {
  const expected = [
    'cinematic',
    'photorealistic',
    'anime',
    'minimalist_vector',
    'isometric_3d',
    'analog_film',
    'cyberpunk',
    'pixel_art',
    'oil_painting',
    'claymation',
  ]
  for (const id of expected) {
    assert.ok(CURATED_STYLES[id], `Missing curated style: ${id}`)
    assert.ok(CURATED_STYLES[id].promptSuffix, `Style ${id} missing promptSuffix`)
    assert.ok(CURATED_STYLES[id].negativePrompt, `Style ${id} missing negativePrompt`)
    assert.ok(CURATED_STYLES[id].guidanceScale > 0, `Style ${id} invalid guidanceScale`)
  }
})

test('prompt-polisher: normalizeStyleKey maps aliases correctly', () => {
  assert.equal(normalizeStyleKey('cinematic'), 'cinematic')
  assert.equal(normalizeStyleKey('isometric-3d'), 'isometric_3d')
  assert.equal(normalizeStyleKey('isometric'), 'isometric_3d')
  assert.equal(normalizeStyleKey('vector'), 'minimalist_vector')
  assert.equal(normalizeStyleKey('analog-film'), 'analog_film')
  assert.equal(normalizeStyleKey('film'), 'analog_film')
  assert.equal(normalizeStyleKey('photo'), 'photorealistic')
  assert.equal(normalizeStyleKey('unknown_style'), 'unknown_style')
  assert.equal(normalizeStyleKey(null), null)
})

test('prompt-polisher: polishPrompt applies style preset, auto-enhancement and palette constraints', () => {
  const base = 'futuristic flying vehicle over neo tokyo'
  const res = polishPrompt(base, 'cinematic', {
    autoEnhance: true,
    paletteColors: ['#1e1b4b', '#6366f1'],
    existingNegative: 'low quality, blurry',
  })

  assert.ok(res.prompt.includes(base))
  assert.ok(res.prompt.includes('cinematic 35mm film still'))
  assert.ok(res.prompt.includes('chromatic palette strictly dominated by #1E1B4B, #6366F1'))
  assert.ok(res.negativePrompt.includes('low quality, blurry'))
  assert.ok(res.negativePrompt.includes('cartoon, illustration'))
  assert.ok(res.negativePrompt.includes('clashing foreign colors'))
  assert.equal(res.styleApplied, 'cinematic')
  assert.equal(res.guidanceScale, 6.5)
})

test('prompt-polisher: polishPrompt handles clean passthrough when no style or palette provided', () => {
  const base = 'minimalist icon of a cup of coffee'
  const res = polishPrompt(base, 'none', { autoEnhance: false })
  assert.equal(res.prompt, base)
  assert.equal(res.styleApplied, undefined)
})

test('diagnostics: testProviderConnection correctly tests Fal, ComfyUI, and Custom endpoints', async () => {
  // 1. Fal success mock
  const falDeps = {
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: async () => ({ status: 'IN_QUEUE' }),
    }),
    resolveKey: async () => 'test_fal_key',
    cfg: { apiKeyEnv: 'FAL_KEY' },
  }
  const falResult = await testProviderConnection(falDeps, 'fal')
  assert.equal(falResult.ok, true)
  assert.ok(falResult.message.includes('Fal.ai queue reachable'))

  // 2. Fal auth error mock
  const falAuthDeps = {
    fetchImpl: async () => ({ status: 401, ok: false }),
    resolveKey: async () => 'bad_key',
    cfg: {},
  }
  const falAuthResult = await testProviderConnection(falAuthDeps, 'fal')
  assert.equal(falAuthResult.ok, false)
  assert.ok(falAuthResult.message.includes('Fal auth failed (HTTP 401)'))

  // 3. ComfyUI success mock
  const comfyDeps = {
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      json: async () => ({ devices: [{ vram_free: 8388608000 }] }),
    }),
    resolveKey: async () => '',
    cfg: { localBaseURL: 'http://127.0.0.1:8188' },
  }
  const comfyResult = await testProviderConnection(comfyDeps, 'comfyui')
  assert.equal(comfyResult.ok, true)
  assert.ok(comfyResult.message.includes('ComfyUI operational (8000 MB free VRAM)'))

  // 4. Custom endpoint reachable mock
  const customDeps = {
    fetchImpl: async () => ({ status: 200, ok: true }),
    resolveKey: async () => 'sk-test',
    cfg: { customBaseURL: 'https://api.openai.com/v1' },
  }
  const customResult = await testProviderConnection(customDeps, 'custom')
  assert.equal(customResult.ok, true)
  assert.ok(customResult.message.includes('Custom gateway reachable'))
})

test('locale: client.js declares complete Chinese (zh) and English (en) dictionaries', () => {
  const clientCode = fs.readFileSync('lib/client.js', 'utf8')
  assert.ok(clientCode.includes('const zh = {'), 'Must declare zh dictionary')
  assert.ok(clientCode.includes('const en = {'), 'Must declare en dictionary')
  assert.ok(clientCode.includes("ctx.locale.register(NS, { en, zh })"), 'Must register dictionaries via ctx.locale.register')

  // Check new feature keys in zh
  const zhMatch = clientCode.match(/const zh = \{([\s\S]*?)\n    \}/)
  assert.ok(zhMatch, 'zh dictionary block must be parsed')
  const zhText = zhMatch[1]

  const requiredKeys = [
    'tab.gallery',
    'diagnostics.title',
    'diagnostics.test',
    'gallery.title',
    'gallery.empty',
    'f.autoEnhancePrompt',
    'f.defaultStylePreset',
  ]
  for (const k of requiredKeys) {
    assert.ok(zhText.includes(`'${k}'`), `zh dictionary missing key: ${k}`)
  }
})

test('ui-slots: client.js registers sidebar right pane and conversation header chip', () => {
  const clientCode = fs.readFileSync('lib/client.js', 'utf8')
  assert.ok(clientCode.includes("'sidebar.right.pane.tab'"), 'Must register sidebar.right.pane.tab slot')
  assert.ok(clientCode.includes("'sidebarRightTabs'"), 'Must inject sidebarRightTabs service')
  assert.ok(clientCode.includes("'conversation.session.header.utilities'"), 'Must register conversation header utilities slot')
  assert.ok(clientCode.includes('GalleryView'), 'Must render GalleryView in sidebar')
})

test('tools: assemble_image_grid calculates correct dimensions for layouts', () => {
  const tileW = 512, tileH = 512, pad = 16, gap = 16
  // side_by_side: 3 images
  const sideCols = 3, sideRows = 1
  assert.equal(pad * 2 + sideCols * tileW + (sideCols - 1) * gap, 1600)
  assert.equal(pad * 2 + sideRows * tileH, 544)

  // grid_2x2: 4 images
  const gridCols = 2, gridRows = 2
  assert.equal(pad * 2 + gridCols * tileW + (gridCols - 1) * gap, 1072)
  assert.equal(pad * 2 + gridRows * tileH + (gridRows - 1) * gap, 1072)
})
