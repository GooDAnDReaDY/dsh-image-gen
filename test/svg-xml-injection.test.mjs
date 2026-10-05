import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { escapeXml, sanitizeSvgColor } from '../lib/security.js'
import { registerProcessingAdvancedTools } from '../lib/tools/processing-advanced.js'
import { buildTextOverlaySvg } from '../lib/vision-ocr-helpers.js'

test('security: escapeXml escapes XML special characters (#414)', () => {
  assert.equal(escapeXml('Hello & World'), 'Hello &amp; World')
  assert.equal(escapeXml('<script>alert("XSS")</script>'), '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;')
  assert.equal(escapeXml("it's 'quoted' & <tagged>"), 'it&apos;s &apos;quoted&apos; &amp; &lt;tagged&gt;')
  assert.equal(escapeXml(null), '')
  assert.equal(escapeXml(undefined), '')
  assert.equal(escapeXml(12345), '12345')
  assert.equal(escapeXml(''), '')
})

test('security: sanitizeSvgColor accepts valid colors and rejects injection vectors (#414)', () => {
  // Valid colors
  assert.equal(sanitizeSvgColor('#fff'), '#fff')
  assert.equal(sanitizeSvgColor('#4f46e5'), '#4f46e5')
  assert.equal(sanitizeSvgColor('#1e1b4baa'), '#1e1b4baa')
  assert.equal(sanitizeSvgColor('rgb(255, 0, 0)'), 'rgb(255, 0, 0)')
  assert.equal(sanitizeSvgColor('rgba(15, 23, 42, 0.95)'), 'rgba(15, 23, 42, 0.95)')
  assert.equal(sanitizeSvgColor('hsl(200, 50%, 50%)'), 'hsl(200, 50%, 50%)')
  assert.equal(sanitizeSvgColor('hsla(120, 100%, 25%, 0.8)'), 'hsla(120, 100%, 25%, 0.8)')
  assert.equal(sanitizeSvgColor('transparent'), 'transparent')
  assert.equal(sanitizeSvgColor('currentColor'), 'currentColor')
  assert.equal(sanitizeSvgColor('none'), 'none')
  assert.equal(sanitizeSvgColor('indigo'), 'indigo')

  // Malicious injections rejected, fallback returned
  const fallback = '#4f46e5'
  assert.equal(sanitizeSvgColor('"><script>alert(1)</script>', fallback), fallback)
  assert.equal(sanitizeSvgColor('red" onclick="alert(1)', fallback), fallback)
  assert.equal(sanitizeSvgColor('url(javascript:alert(1))', fallback), fallback)
  assert.equal(sanitizeSvgColor('expression(alert(1))', fallback), fallback)
  assert.equal(sanitizeSvgColor('<svg onload="alert(1)">', fallback), fallback)
  assert.equal(sanitizeSvgColor('rgba(0,0,0); alert(1)', fallback), fallback)
  assert.equal(sanitizeSvgColor('', fallback), fallback)
  assert.equal(sanitizeSvgColor(null, fallback), fallback)
  assert.equal(sanitizeSvgColor(undefined, fallback), fallback)
  assert.equal(sanitizeSvgColor({ color: 'red' }, fallback), fallback)
})

test('tools: export_asset_pack sanitizes themeColor and escapes project/tagline/initial (#414)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-brand-sec-'))
  const registeredTools = new Map()
  const fakeCtx = {
    effect: (fn) => fn(),
    tools: {
      register: (tool) => {
        registeredTools.set(tool.name, tool)
      },
    },
    logger: { debug: () => {} },
  }

  const fakeDeps = {
    live: () => ({ outputDir: tmpDir }),
    resolveSource: async () => null,
    slugify: (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  }

  registerProcessingAdvancedTools(fakeCtx, fakeDeps)
  const exportTool = registeredTools.get('export_asset_pack')
  assert.ok(exportTool, 'export_asset_pack tool must be registered')

  const maliciousProject = '<script>alert("pwn")</script>'
  const maliciousTagline = '"><img src=x onerror=alert(1)>'
  const maliciousColor = '"><svg onload=alert(2)>'

  const fakeExec = {
    agent: {
      session: {
        header: { cwd: tmpDir },
      },
    },
  }

  const res = await exportTool.execute(
    {
      project_name: maliciousProject,
      tagline: maliciousTagline,
      theme_color: maliciousColor,
      output_dir: path.join(tmpDir, 'brand'),
    },
    fakeExec,
  )

  const parsed = typeof res === 'string' ? JSON.parse(res) : res
  assert.ok(parsed.exportedFiles.length >= 5)

  // Verify favicon.svg
  const faviconContent = await fs.readFile(path.join(tmpDir, 'brand', 'favicon.svg'), 'utf8')
  assert.ok(!faviconContent.includes('<script>'), 'Favicon must not contain unescaped <script>')
  assert.ok(!faviconContent.includes('onload='), 'Favicon must not contain unescaped onload attribute')
  assert.ok(faviconContent.includes('&lt;'), 'Favicon text must contain escaped initial')
  assert.ok(faviconContent.includes('fill="#4f46e5"'), 'Favicon must use sanitized fallback color')

  // Verify icon-192.svg and icon-512.svg
  for (const size of [192, 512]) {
    const iconContent = await fs.readFile(path.join(tmpDir, 'brand', `icon-${size}.svg`), 'utf8')
    assert.ok(!iconContent.includes('<script>'), `Icon ${size} must not contain unescaped <script>`)
    assert.ok(!iconContent.includes('onload='), `Icon ${size} must not contain unescaped onload attribute`)
    assert.ok(iconContent.includes('&lt;'), `Icon ${size} text must contain escaped initial`)
    assert.ok(iconContent.includes('stop-color="#4f46e5"'), `Icon ${size} must use sanitized fallback color`)
  }

  // Verify og-card.svg
  const ogContent = await fs.readFile(path.join(tmpDir, 'brand', 'og-card.svg'), 'utf8')
  assert.ok(!ogContent.includes('<script>'), 'OG card must not contain unescaped <script>')
  assert.ok(ogContent.includes('&lt;script&gt;alert(&quot;pwn&quot;)&lt;/script&gt;'), 'OG card must escape project name')
  assert.ok(ogContent.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'), 'OG card must escape tagline')
  assert.ok(ogContent.includes('&lt;'), 'OG card logo initial must be escaped')
  assert.ok(!ogContent.includes('><<'), 'OG card must not contain unescaped initial tag collision')

  // Verify webmanifest
  const manifestRaw = await fs.readFile(path.join(tmpDir, 'brand', 'manifest.webmanifest'), 'utf8')
  const manifest = JSON.parse(manifestRaw)
  assert.equal(manifest.name, maliciousProject)
  assert.equal(manifest.theme_color, '#4f46e5')

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('tools: smart_crop_image sanitizes background color in letterbox mode (#414)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-crop-sec-'))
  const registeredTools = new Map()
  const fakeCtx = {
    effect: (fn) => fn(),
    tools: {
      register: (tool) => {
        registeredTools.set(tool.name, tool)
      },
    },
  }

  const fakeDeps = {
    live: () => ({ outputDir: 'output' }),
    resolveSource: async () => null,
    slugify: (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  }

  registerProcessingAdvancedTools(fakeCtx, fakeDeps)
  const cropTool = registeredTools.get('smart_crop_image')
  assert.ok(cropTool)

  // 1x1 1-pixel red png buffer
  const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const pngBytes = Buffer.from(samplePngBase64, 'base64')

  const fakeExec = {
    agent: {
      session: {
        header: { cwd: tmpDir },
      },
    },
  }

  // Create temporary input file
  const testInputPath = path.join(tmpDir, 'test.png')
  await fs.writeFile(testInputPath, pngBytes)

  const res = await cropTool.execute(
    {
      image: testInputPath,
      aspect_ratio: '16:9',
      mode: 'letterbox',
      background: '"><script>alert("crop-xss")</script><rect fill="',
    },
    fakeExec,
  )

  const parsed = typeof res === 'string' ? JSON.parse(res) : res
  assert.ok(parsed.path)
  const svgContent = await fs.readFile(parsed.path, 'utf8')
  assert.ok(!svgContent.includes('<script>'), 'Cropped SVG letterbox must not contain script injection')
  assert.ok(svgContent.includes('fill="#0b0c0e"'), 'Cropped SVG must use default sanitized background color')

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('vision-ocr: buildTextOverlaySvg sanitizes font-family, color, and text (#414)', () => {
  const svg = buildTextOverlaySvg(1000, 1000, [
    {
      text: '<script>alert("text")</script>',
      bbox: [100, 100, 500, 200],
      color: '"><script>alert("color")</script>',
    },
  ], 'sans-serif"; alert("font")')

  assert.ok(!svg.includes('<script>'), 'Overlay SVG must not contain unescaped script tag')
  assert.ok(svg.includes('&lt;script&gt;alert(&quot;text&quot;)&lt;/script&gt;'), 'Overlay text must be XML-escaped')
  assert.ok(svg.includes('fill="#FFFFFF"'), 'Malicious color must fall back to safe color')
  assert.ok(svg.includes('font-family="sans-serif&quot;; alert(&quot;font&quot;)"'), 'Font family must be XML-escaped')
})

test('tools: assemble_image_grid escapes title and labels (#414)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-grid-sec-'))
  const registeredTools = new Map()
  const fakeCtx = {
    effect: (fn) => fn(),
    tools: {
      register: (tool) => {
        registeredTools.set(tool.name, tool)
      },
    },
  }

  const fakeDeps = {
    live: () => ({ outputDir: 'output' }),
    resolveSource: async (_ctx, _exec, _ref) => ({ bytes: pngBytes, mediaType: 'image/png', name: 'img' }),
    slugify: (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  }

  registerProcessingAdvancedTools(fakeCtx, fakeDeps)
  const gridTool = registeredTools.get('assemble_image_grid')
  assert.ok(gridTool)

  const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const pngBytes = Buffer.from(samplePngBase64, 'base64')
  const testInput1 = path.join(tmpDir, '1.png')
  const testInput2 = path.join(tmpDir, '2.png')
  await fs.writeFile(testInput1, pngBytes)
  await fs.writeFile(testInput2, pngBytes)

  const fakeExec = {
    agent: {
      session: {
        header: { cwd: tmpDir },
      },
    },
  }

  const res = await gridTool.execute(
    {
      images: [testInput1, testInput2],
      title: '<script>alert("xss-grid")</script>',
    },
    fakeExec,
  )

  const parsed = typeof res === 'string' ? JSON.parse(res) : res
  assert.ok(parsed.path)
  const svgContent = await fs.readFile(parsed.path, 'utf8')
  assert.ok(!svgContent.includes('<script>'), 'Grid SVG must not contain unescaped script tag')
  assert.ok(svgContent.includes('&lt;script&gt;alert(&quot;xss-grid&quot;)&lt;/script&gt;'), 'Grid title must be XML-escaped')

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true })
})

