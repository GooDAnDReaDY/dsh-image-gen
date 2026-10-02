import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { generatePwaIconSuite, buildIcoBuffer } from '../lib/frontend-assets.js'

test('pwa-icons (#387): buildIcoBuffer creates valid ICO container with multiple resolutions', async () => {
  const p16 = await sharp({
    create: { width: 16, height: 16, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer()

  const p32 = await sharp({
    create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
  }).png().toBuffer()

  const p48 = await sharp({
    create: { width: 48, height: 48, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
  }).png().toBuffer()

  const icoBuf = buildIcoBuffer([
    { width: 16, height: 16, buffer: p16 },
    { width: 32, height: 32, buffer: p32 },
    { width: 48, height: 48, buffer: p48 },
  ])

  assert.ok(icoBuf.length > 6 + 3 * 16)
  assert.equal(icoBuf.readUInt16LE(0), 0, 'ICO reserved must be 0')
  assert.equal(icoBuf.readUInt16LE(2), 1, 'ICO type must be 1 (icon)')
  assert.equal(icoBuf.readUInt16LE(4), 3, 'ICO image count must be 3')

  // Entry 1: 16x16
  assert.equal(icoBuf.readUInt8(6), 16)
  assert.equal(icoBuf.readUInt8(7), 16)

  // Entry 2: 32x32
  assert.equal(icoBuf.readUInt8(22), 32)
  assert.equal(icoBuf.readUInt8(23), 32)

  // Entry 3: 48x48
  assert.equal(icoBuf.readUInt8(38), 48)
  assert.equal(icoBuf.readUInt8(39), 48)
})

test('pwa-icons (#387): generates complete suite on disk with correct dimensions, ICO, and maskable safe zone', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-suite-test-'))

  try {
    // Generate sample 64x64 source icon
    const sourcePng = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 1 } },
    }).png().toBuffer()

    const res = await generatePwaIconSuite({
      name: 'Test PWA App',
      shortName: 'TestApp',
      themeColor: '#4f46e5',
      backgroundColor: '#111827',
      iconsDir: 'pwa-icons',
      imageBytes: sourcePng,
      outDir: tmpDir,
    })

    assert.equal(res.name, 'Test PWA App')
    assert.equal(res.shortName, 'TestApp')
    assert.equal(res.icons.length, 7)
    assert.ok(res.faviconIco.includes('pwa-icons/favicon.ico'))

    // 1. Verify manifest.json exists and references valid files
    const manifestPath = path.join(tmpDir, 'manifest.json')
    const manifestContent = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    assert.equal(manifestContent.name, 'Test PWA App')
    assert.equal(manifestContent.background_color, '#111827')
    assert.equal(manifestContent.theme_color, '#4f46e5')
    assert.ok(manifestContent.icons.length >= 3)

    // 2. Check each icon from manifest exists with exact dimensions
    for (const iconRef of manifestContent.icons) {
      const fullPath = path.join(tmpDir, iconRef.src)
      const stat = await fs.stat(fullPath)
      assert.ok(stat.size > 0, `Icon ${iconRef.src} must exist on disk and be non-empty`)

      const meta = await sharp(fullPath).metadata()
      assert.equal(meta.format, 'png')
      const [expectedW, expectedH] = iconRef.sizes.split('x').map(Number)
      assert.equal(meta.width, expectedW, `Width mismatch for ${iconRef.src}`)
      assert.equal(meta.height, expectedH, `Height mismatch for ${iconRef.src}`)
    }

    // 3. Verify favicon.ico exists and contains 16, 32, 48
    const icoPath = path.join(tmpDir, 'pwa-icons', 'favicon.ico')
    const icoBuf = await fs.readFile(icoPath)
    assert.ok(icoBuf.length > 50)
    assert.equal(icoBuf.readUInt16LE(0), 0)
    assert.equal(icoBuf.readUInt16LE(2), 1)
    assert.equal(icoBuf.readUInt16LE(4), 3, 'ICO must contain 3 frames')
    assert.equal(icoBuf.readUInt8(6), 16)
    assert.equal(icoBuf.readUInt8(22), 32)
    assert.equal(icoBuf.readUInt8(38), 48)

    // 4. Verify maskable safe zone padding
    const maskablePath = path.join(tmpDir, 'pwa-icons', 'icon-512x512-maskable.png')
    const maskableRaw = await sharp(maskablePath).raw().toBuffer()
    // Background color #111827 -> R: 17, G: 24, B: 39
    // At pixel (5, 5), it should have the background color (safe zone margin)
    const cornerIndex = (5 * 512 + 5) * 4
    assert.equal(maskableRaw[cornerIndex], 17, 'Maskable corner R matches backgroundColor')
    assert.equal(maskableRaw[cornerIndex + 1], 24, 'Maskable corner G matches backgroundColor')
    assert.equal(maskableRaw[cornerIndex + 2], 39, 'Maskable corner B matches backgroundColor')

    // 5. Verify HTML snippet
    assert.ok(res.htmlHeadSnippet.includes('href="/pwa-icons/favicon.ico"'))
    assert.ok(res.htmlHeadSnippet.includes('href="/manifest.json"'))
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
})
