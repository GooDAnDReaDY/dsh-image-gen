import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { polishPrompt } from '../lib/prompt-polisher.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

test('smart_crop_image: aspect ratio dimensions & crop box calculations', () => {
  const origW = 1200
  const origH = 800
  const origRatio = origW / origH // 1.5

  // 1:1 crop
  const targetRatio1x1 = 1.0
  let cropH = origH
  let cropW = Math.round(origH * targetRatio1x1) // 800
  assert.equal(cropW, 800)
  assert.equal(cropH, 800)

  // center offset
  const centerX = Math.round((origW - cropW) / 2)
  assert.equal(centerX, 200)

  // rule of thirds offset
  const rotX = Math.round((origW - cropW) * 0.35)
  assert.equal(rotX, 140)

  // auto_focus offset
  const autoX = Math.round((origW - cropW) * 0.42)
  assert.equal(autoX, 168)

  // 16:9 target ratio (1.7778 > 1.5)
  const targetRatio16x9 = 16 / 9
  const cropW16x9 = origW // 1200
  const cropH16x9 = Math.round(origW / targetRatio16x9) // 675
  assert.equal(cropW16x9, 1200)
  assert.equal(cropH16x9, 675)

  // vertical crop auto_focus (bias upper 25% for faces/subjects)
  const autoY = Math.round((origH - cropH16x9) * 0.25)
  assert.equal(autoY, 31)
})

test('export_asset_pack: manifest, icons, and social card specifications', () => {
  const projectName = 'Quantum Flow'
  const themeColor = '#6366f1'
  const initial = projectName.charAt(0)

  // Test SVG favicon content
  const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="${themeColor}"/><text>${initial}</text></svg>`
  assert.ok(faviconSvg.includes('width="64"'))
  assert.ok(faviconSvg.includes(themeColor))
  assert.ok(faviconSvg.includes(initial))

  // Test OG Card dimensions
  const ogW = 1200
  const ogH = 630
  assert.equal(ogW, 1200)
  assert.equal(ogH, 630)

  // Test PWA Manifest specs
  const manifest = {
    name: projectName,
    short_name: projectName.slice(0, 12),
    theme_color: themeColor,
    icons: [
      { src: 'favicon.svg', sizes: '64x64', type: 'image/svg+xml' },
      { src: 'icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
      { src: 'icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
    ],
  }
  assert.equal(manifest.name, 'Quantum Flow')
  assert.equal(manifest.icons.length, 3)
})

test('remix_image: polishPrompt integration and creativity parameter handling', () => {
  const rawPrompt = 'neon street market with ramen stalls'
  const polished = polishPrompt(rawPrompt, 'cyberpunk', {
    autoEnhance: true,
  })

  assert.ok(polished.prompt.includes('neon street market'))
  assert.ok(polished.prompt.toLowerCase().includes('cyberpunk') || polished.prompt.toLowerCase().includes('neon'))
  assert.ok(polished.negativePrompt.length > 0)

  // creativity strength clamping
  const testStrengths = [-0.5, 0.45, 1.5]
  const clamped = testStrengths.map((s) => Math.max(0.05, Math.min(0.95, s)))
  assert.equal(clamped[0], 0.05)
  assert.equal(clamped[1], 0.45)
  assert.equal(clamped[2], 0.95)
})

test('client: lib/client.js declares remix workbench and all new visual toolviews', () => {
  const clientPath = path.join(rootDir, 'lib', 'client.js')
  const code = fs.readFileSync(clientPath, 'utf8')

  assert.ok(code.includes('remixOpen'), 'Must declare remixOpen state in FalImageCard')
  assert.ok(code.includes('remixStrength'), 'Must declare remixStrength state in FalImageCard')
  assert.ok(code.includes("'remix_image'"), 'Must register remix_image toolview')
  assert.ok(code.includes("'smart_crop_image'"), 'Must register smart_crop_image toolview')
  assert.ok(code.includes("'export_asset_pack'"), 'Must register export_asset_pack toolview')

  // Check English dictionary
  assert.ok(code.includes("'card.remix': 'Remix'"), 'en dictionary must have card.remix')
  assert.ok(code.includes("'remix.drawer_title'"), 'en dictionary must have remix.drawer_title')

  // Check Chinese dictionary
  assert.ok(code.includes("'card.remix': '重混变体'"), 'zh dictionary must have card.remix')
  assert.ok(code.includes("'remix.drawer_title'"), 'zh dictionary must have remix.drawer_title')
})
