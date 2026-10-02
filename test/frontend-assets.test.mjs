import test from 'node:test'
import assert from 'node:assert/strict'
import {
  rgbToHex,
  hexToRgb,
  getRelativeLuminance,
  getContrastRatio,
  extractSampleColorsFromBuffer,
  extractDesignTokens,
  generateCssGradient,
  checkWcagContrast,
  optimizeSvgContent,
  generatePwaIconSuite,
} from '../lib/frontend-assets.js'

test('frontend-assets: rgbToHex and hexToRgb conversion', () => {
  assert.equal(rgbToHex(255, 255, 255), '#ffffff')
  assert.equal(rgbToHex(0, 0, 0), '#000000')
  assert.equal(rgbToHex(59, 130, 246), '#3b82f6')

  assert.deepEqual(hexToRgb('#ffffff'), { r: 255, g: 255, b: 255 })
  assert.deepEqual(hexToRgb('3b82f6'), { r: 59, g: 130, b: 246 })
  assert.deepEqual(hexToRgb('#fff'), { r: 255, g: 255, b: 255 })
})

test('frontend-assets: WCAG relative luminance and contrast ratio', () => {
  const whiteLum = getRelativeLuminance({ r: 255, g: 255, b: 255 })
  const blackLum = getRelativeLuminance({ r: 0, g: 0, b: 0 })
  assert.equal(whiteLum, 1)
  assert.equal(blackLum, 0)

  const maxContrast = getContrastRatio('#ffffff', '#000000')
  assert.equal(maxContrast, 21)

  const sameContrast = getContrastRatio('#ffffff', '#ffffff')
  assert.equal(sameContrast, 1)
})

test('frontend-assets: extractSampleColorsFromBuffer fallback and svg parsing', async () => {
  const defaultColors = await extractSampleColorsFromBuffer(Buffer.alloc(0))
  assert.ok(Array.isArray(defaultColors))
  assert.ok(defaultColors.length >= 5)

  const svgMock = Buffer.from('<svg><rect fill="#3b82f6"/><circle fill="#ef4444"/><path fill="#3b82f6"/></svg>')
  const svgColors = await extractSampleColorsFromBuffer(svgMock)
  assert.ok(svgColors.includes('#3b82f6'))
})

test('frontend-assets (#372): solid red and black fixtures yield true colors', async () => {
  const sharp = (await import('sharp')).default

  const redPng = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer()
  const redColors = await extractSampleColorsFromBuffer(redPng)
  assert.equal(redColors[0], '#ff0000', 'Solid red image must yield #ff0000 dominant color')

  const blackPng = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer()
  const blackColors = await extractSampleColorsFromBuffer(blackPng)
  assert.equal(blackColors[0], '#000000', 'Solid black image must yield #000000 dominant color')

  // Transparent pixels with red content
  const transparentPng = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from([255, 0, 0, 255]), raw: { width: 1, height: 1, channels: 4 } }])
    .png().toBuffer()
  const transparentColors = await extractSampleColorsFromBuffer(transparentPng)
  assert.equal(transparentColors[0], '#ff0000', 'Alpha transparency must be respected, selecting opaque pixel')
})

test('frontend-assets (#172): extractDesignTokens', () => {
  const palette = ['#0f172a', '#3b82f6', '#10b981', '#f59e0b', '#ffffff']
  const result = extractDesignTokens(palette, { prefix: 'brand' })

  assert.ok(result.tokens)
  assert.equal(result.tokens.background, '#0f172a')
  assert.equal(result.tokens.primary, '#3b82f6')
  assert.ok(result.cssVariables.includes('--brand-background: #0f172a;'))
  assert.ok(result.cssVariables.includes('--brand-primary: #3b82f6;'))
  assert.ok(result.tailwindSnippet.includes('brand'))
  assert.ok(result.w3cTokens.color.primary.$value === '#3b82f6')
})

test('frontend-assets (#174): generateCssGradient (mesh, linear, radial)', () => {
  const colors = ['#0f172a', '#1e293b', '#3b82f6', '#06b6d4']

  const mesh = generateCssGradient(colors, 'mesh')
  assert.equal(mesh.type, 'mesh')
  assert.ok(mesh.gradientCss.includes('radial-gradient'))
  assert.ok(mesh.byteSize < 1024, `CSS mesh gradient size ${mesh.byteSize} should be < 1KB`)

  const linear = generateCssGradient(colors, 'linear')
  assert.equal(linear.type, 'linear')
  assert.ok(linear.gradientCss.includes('linear-gradient'))

  const radial = generateCssGradient(colors, 'radial')
  assert.equal(radial.type, 'radial')
  assert.ok(radial.gradientCss.includes('radial-gradient'))
})

test('frontend-assets (#175): checkWcagContrast ratio and scrim recommendation', () => {
  const darkBackgrounds = ['#0f172a', '#1e293b', '#111827']
  const checkLightText = checkWcagContrast(darkBackgrounds, '#ffffff')
  assert.equal(checkLightText.passedAA, true)
  assert.ok(checkLightText.minContrastRatio >= 4.5)

  const lightBackgrounds = ['#ffffff', '#f8fafc', '#f1f5f9']
  const checkFail = checkWcagContrast(lightBackgrounds, '#ffffff')
  assert.equal(checkFail.passedAA, false)
  assert.ok(checkFail.suggestedScrimCss.length > 0)
  assert.ok(checkFail.recommendation.includes('below WCAG 2.1 AA'))
})

test('frontend-assets (#176): optimizeSvgContent and React TSX export', () => {
  const messySvg = `<?xml version="1.0" encoding="UTF-8"?>
  <!-- Generator: Adobe Illustrator 25.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
  <svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100" height="100">
    <sodipodi:namedview id="base" />
    <metadata>Garbage metadata</metadata>
    <path class="icon" fill-rule="evenodd" stroke-width="2" d="M10 10 H 90 V 90 H 10 L 10 10" />
  </svg>`

  const optimized = optimizeSvgContent(messySvg, { componentName: 'CustomBox' })
  assert.ok(!optimized.svg.includes('<?xml'))
  assert.ok(!optimized.svg.includes('inkscape'))
  assert.ok(!optimized.svg.includes('metadata'))
  assert.ok(optimized.savedBytes > 0)
  assert.ok(optimized.reactTsx.includes('export const CustomBox: React.FC<CustomBoxProps>'))
  assert.ok(optimized.reactTsx.includes('className='))
  assert.ok(optimized.reactTsx.includes('fillRule='))
  assert.ok(optimized.reactTsx.includes('strokeWidth='))
})

test('frontend-assets (#190): generatePwaIconSuite manifest and html snippet', async () => {
  const pwa = await generatePwaIconSuite({
    name: 'Dashboard App',
    shortName: 'Dashboard',
    themeColor: '#1e293b',
    backgroundColor: '#0f172a',
    iconsDir: 'assets/icons',
  })

  assert.equal(pwa.name, 'Dashboard App')
  assert.ok(pwa.icons.some((i) => i.size === 16 && i.filename.includes('favicon-16x16.png')))
  assert.ok(pwa.icons.some((i) => i.size === 512 && i.purpose === 'maskable'))

  const manifest = JSON.parse(pwa.manifestJson)
  assert.equal(manifest.name, 'Dashboard App')
  assert.equal(manifest.theme_color, '#1e293b')
  assert.ok(pwa.htmlHeadSnippet.includes('<link rel="manifest" href="/manifest.json">'))
  assert.ok(pwa.htmlHeadSnippet.includes('<meta name="theme-color" content="#1e293b">'))
})

import { toLosslessJson } from "../lib/providers.js"

test("lossless JSON (#195): strips undefined properties recursively and maintains lossless validity", () => {
  const dirty = {
    str: "hello",
    num: 42,
    bool: true,
    nil: null,
    und: undefined,
    nested: {
      a: 1,
      bad: undefined,
      deep: {
        x: "ok",
        y: undefined,
      },
    },
    arr: [
      { id: 1, skip: undefined },
      { id: 2, valid: "yes" },
    ],
  }

  const clean = toLosslessJson(dirty)
  assert.equal(Object.prototype.hasOwnProperty.call(clean, "und"), false)
  assert.equal(Object.prototype.hasOwnProperty.call(clean.nested, "bad"), false)
  assert.equal(Object.prototype.hasOwnProperty.call(clean.nested.deep, "y"), false)
  assert.equal(Object.prototype.hasOwnProperty.call(clean.arr[0], "skip"), false)
  assert.equal(clean.str, "hello")
  assert.equal(clean.nested.deep.x, "ok")
  assert.equal(clean.arr[1].valid, "yes")

  assert.deepEqual(JSON.parse(JSON.stringify(clean)), clean)
})

test('frontend-assets (#374): optimizeSvgContent strips active SVG content, scripts, foreignObject and inline event handlers', () => {
  const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" onload="alert('xss')" onerror="console.log('err')">
    <script>alert("AUDIT_SENTINEL_SCRIPT")</script>
    <foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert('nested')</script></body></foreignObject>
    <a href="javascript:alert('link')"><circle cx="50" cy="50" r="40" fill="red" /></a>
  </svg>`

  const result = optimizeSvgContent(maliciousSvg, { componentName: 'SafeIcon' })

  assert.ok(!result.svg.includes('<script'), 'Must strip <script> tags from SVG output')
  assert.ok(!result.svg.includes('AUDIT_SENTINEL_SCRIPT'), 'Must strip script payload')
  assert.ok(!result.svg.includes('<foreignObject'), 'Must strip <foreignObject> tags')
  assert.ok(!result.svg.includes('onload='), 'Must strip onload event handler')
  assert.ok(!result.svg.includes('onerror='), 'Must strip onerror event handler')
  assert.ok(!result.svg.includes('javascript:'), 'Must strip javascript: URI schemes')

  assert.ok(!result.reactTsx.includes('<script'), 'Must strip <script> tags from TSX output')
  assert.ok(!result.reactTsx.includes('onload='), 'Must strip onload from TSX output')
  assert.ok(result.reactTsx.includes('<circle'), 'Must preserve valid SVG vector elements')
})
