import { resolveInside } from './security.js'
import sharp from 'sharp'
// @ts-check
import path from 'node:path'
import fs from 'node:fs/promises'

/**
 * Convert RGB to Hex string
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
export function rgbToHex(r, g, b) {
  const toHex = (c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toLowerCase()
}

/**
 * Parse Hex string to RGB
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }}
 */
export function hexToRgb(hex) {
  let clean = hex.replace(/^#/, '').trim()
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('')
  }
  const num = parseInt(clean, 16)
  if (Number.isNaN(num) || clean.length !== 6) {
    return { r: 0, g: 0, b: 0 }
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  }
}

/**
 * Calculates WCAG 2.1 relative luminance for sRGB color.
 * @param {{ r: number, g: number, b: number }} rgb
 * @returns {number}
 */
export function getRelativeLuminance({ r, g, b }) {
  const a = [r, g, b].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]
}

/**
 * Calculates WCAG 2.1 contrast ratio between two colors (1.0 to 21.0).
 * @param {string} hex1
 * @param {string} hex2
 * @returns {number}
 */
export function getContrastRatio(hex1, hex2) {
  const lum1 = getRelativeLuminance(hexToRgb(hex1))
  const lum2 = getRelativeLuminance(hexToRgb(hex2))
  const brightest = Math.max(lum1, lum2)
  const darkest = Math.min(lum1, lum2)
  const ratio = (brightest + 0.05) / (darkest + 0.05)
  return Math.round(ratio * 100) / 100
}

/**
 * Extract dominant palette colors from decoded image pixels with alpha awareness (#372).
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<string[]>} Hex colors
 */
export async function extractSampleColorsFromBuffer(buffer) {
  if (!buffer || buffer.length === 0) {
    return ['#0f172a', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#f8fafc']
  }

  // Check if buffer is SVG (UTF-8 text)
  const head = buffer.slice(0, 256).toString('utf8').toLowerCase()
  if (head.includes('<svg') || head.includes('<?xml')) {
    const text = buffer.toString('utf8')
    const hexMatches = text.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g)
    if (hexMatches && hexMatches.length > 0) {
      const counts = {}
      for (const h of hexMatches) {
        let full = h.toLowerCase()
        if (full.length === 4) {
          full = '#' + full[1] + full[1] + full[2] + full[2] + full[3] + full[3]
        }
        counts[full] = (counts[full] || 0) + 1
      }
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([c]) => c)
    }
  }

  // Decode raster container to raw RGBA pixels via Sharp
  let data, info
  try {
    const res = await sharp(buffer)
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true })
    data = res.data
    info = res.info
  } catch (err) {
    throw new Error(`Failed to decode image buffer for color extraction: ${err.message}`)
  }

  const totalPixels = info.width * info.height
  const step = Math.max(1, Math.floor(totalPixels / 2048))
  const colorBuckets = new Map()

  for (let i = 0; i < totalPixels; i += step) {
    const off = i * 4
    const r = data[off]
    const g = data[off + 1]
    const b = data[off + 2]
    const a = data[off + 3]

    // Ignore fully or mostly transparent pixels
    if (a < 128) continue

    // Quantize to 16-level RGB bins to cluster nearby nuances
    const qr = Math.round(r / 16) * 16
    const qg = Math.round(g / 16) * 16
    const qb = Math.round(b / 16) * 16
    const key = `${qr},${qg},${qb}`

    let bucket = colorBuckets.get(key)
    if (!bucket) {
      bucket = { count: 0, rSum: 0, gSum: 0, bSum: 0 }
      colorBuckets.set(key, bucket)
    }
    bucket.count++
    bucket.rSum += r
    bucket.gSum += g
    bucket.bSum += b
  }

  if (colorBuckets.size > 0) {
    const sorted = Array.from(colorBuckets.values()).sort((a, b) => b.count - a.count)
    const dominant = sorted.slice(0, 6).map((b) => {
      return rgbToHex(b.rSum / b.count, b.gSum / b.count, b.bSum / b.count)
    })

    const result = [...dominant]
    if (result.length < 5) {
      const primaryRgb = hexToRgb(result[0])
      const isNearBlack = primaryRgb.r === 0 && primaryRgb.g === 0 && primaryRgb.b === 0
      if (isNearBlack) {
        const darkShades = ['#1a1a1a', '#333333', '#4d4d4d', '#666666', '#808080']
        for (const s of darkShades) {
          if (result.length >= 6) break
          if (!result.includes(s)) result.push(s)
        }
      } else {
        const factors = [0.2, 0.4, 0.6, 0.8, 1.2, 1.4]
        for (const factor of factors) {
          if (result.length >= 6) break
          const shade = rgbToHex(
            Math.min(255, Math.round(primaryRgb.r * factor)),
            Math.min(255, Math.round(primaryRgb.g * factor)),
            Math.min(255, Math.round(primaryRgb.b * factor)),
          )
          if (!result.includes(shade)) result.push(shade)
        }
      }
    }
    return result.slice(0, 6)
  }

  return ['#0f172a', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#f8fafc']
}

/**
 * Issue #172: extract_design_tokens
 * Generates CSS Variables, Tailwind color palette config, and W3C Design Tokens JSON.
 */
export function extractDesignTokens(colors, options = {}) {
  const palette = colors && colors.length > 0 ? colors : ['#0f172a', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#f8fafc']
  const prefix = options.prefix || 'color'

  const bg = palette[0]
  const primary = palette[1] || palette[0]
  const secondary = palette[2] || '#64748b'
  const accent = palette[3] || '#f59e0b'
  const text = palette[palette.length - 1]

  const tokens = {
    background: bg,
    primary,
    secondary,
    accent,
    text,
    palette,
  }

  let cssVariables = ':root {\n'
  cssVariables += `  --${prefix}-background: ${bg};\n`
  cssVariables += `  --${prefix}-primary: ${primary};\n`
  cssVariables += `  --${prefix}-secondary: ${secondary};\n`
  cssVariables += `  --${prefix}-accent: ${accent};\n`
  cssVariables += `  --${prefix}-text: ${text};\n`
  palette.forEach((col, idx) => {
    cssVariables += `  --${prefix}-palette-${idx + 1}: ${col};\n`
  })
  cssVariables += '}'

  const tailwindColors = {
    [prefix]: {
      background: bg,
      primary,
      secondary,
      accent,
      text,
      ...palette.reduce((acc, col, idx) => {
        acc[`shade-${(idx + 1) * 100}`] = col
        return acc
      }, {}),
    },
  }
  const tailwindSnippet = `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: ${JSON.stringify(tailwindColors, null, 2).replace(/\\n/g, '\n      ')}\n    }\n  }\n}`

  const w3cTokens = {
    color: {
      background: { $value: bg, $type: 'color' },
      primary: { $value: primary, $type: 'color' },
      secondary: { $value: secondary, $type: 'color' },
      accent: { $value: accent, $type: 'color' },
      text: { $value: text, $type: 'color' },
      palette: palette.map((c, i) => ({
        [`step-${i + 1}`]: { $value: c, $type: 'color' },
      })),
    },
  }

  return {
    tokens,
    cssVariables,
    tailwindSnippet,
    w3cTokens,
  }
}

/**
 * Issue #174: image_to_css_gradient
 * Converts image dominant colors into pure CSS mesh / radial / linear gradient (< 1KB).
 */
export function generateCssGradient(colors, type = 'mesh') {
  const palette = colors && colors.length >= 2 ? colors : ['#0f172a', '#1e293b', '#3b82f6', '#06b6d4']
  const c1 = palette[0]
  const c2 = palette[1]
  const c3 = palette[2] || palette[0]
  const c4 = palette[3] || palette[1]

  let css = ''
  let fallbackColor = c1

  if (type === 'linear') {
    css = `linear-gradient(135deg, ${c1} 0%, ${c2} 50%, ${c3} 100%)`
  } else if (type === 'radial') {
    css = `radial-gradient(circle at 30% 20%, ${c2} 0%, ${c1} 70%)`
  } else {
    css = [
      `radial-gradient(at 0% 0%, ${c1} 0px, transparent 50%)`,
      `radial-gradient(at 100% 0%, ${c2} 0px, transparent 50%)`,
      `radial-gradient(at 100% 100%, ${c3} 0px, transparent 50%)`,
      `radial-gradient(at 0% 100%, ${c4} 0px, transparent 50%)`,
      `radial-gradient(at 50% 50%, ${c2}88 0px, transparent 50%)`,
      fallbackColor,
    ].join(',\n    ')
  }

  const completeStyle = `background-color: ${fallbackColor};\nbackground-image:\n    ${css};`

  return {
    type,
    fallbackColor,
    gradientCss: css,
    completeStyle,
    byteSize: Buffer.byteLength(completeStyle, 'utf8'),
  }
}

/**
 * Issue #175: check_image_contrast
 * Calculates WCAG 2.1 contrast ratio and suggests overlay / scrim.
 */
export function checkWcagContrast(colors, textHex = '#ffffff') {
  const palette = colors && colors.length > 0 ? colors : ['#0f172a']
  const targetText = textHex.startsWith('#') ? textHex : `#${textHex}`

  const ratios = palette.map((bgHex) => {
    const ratio = getContrastRatio(bgHex, targetText)
    const passAA = ratio >= 4.5
    const passAALarge = ratio >= 3.0
    const passAAA = ratio >= 7.0
    return {
      backgroundColor: bgHex,
      contrastRatio: ratio,
      passAA,
      passAALarge,
      passAAA,
    }
  })

  const minRatio = Math.min(...ratios.map((r) => r.contrastRatio))
  const passedAA = ratios.every((r) => r.passAA)
  const passedAALarge = ratios.every((r) => r.passAALarge)
  const passedAAA = ratios.every((r) => r.passAAA)

  let recommendation = 'Contrast satisfies WCAG 2.1 AA standards.'
  let scrimCss = ''

  if (!passedAA) {
    const lum = getRelativeLuminance(hexToRgb(targetText))
    if (lum > 0.5) {
      scrimCss = 'background: linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.7) 100%); backdrop-filter: blur(4px);'
      recommendation = `Contrast ratio (${minRatio}:1) is below WCAG 2.1 AA (4.5:1). Apply dark overlay scrim or increase text weight/shadow.`
    } else {
      scrimCss = 'background: linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.85) 100%); backdrop-filter: blur(4px);'
      recommendation = `Contrast ratio (${minRatio}:1) is below WCAG 2.1 AA (4.5:1). Apply light overlay scrim.`
    }
  }

  return {
    textHex: targetText,
    minContrastRatio: minRatio,
    passedAA,
    passedAALarge,
    passedAAA,
    recommendation,
    suggestedScrimCss: scrimCss,
    details: ratios,
  }
}

/**
 * Decode common HTML numeric and named entities in SVG attribute values (#374)
 * @param {string} str
 * @returns {string}
 */
export function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return ''
  return str
    .replace(/&#x([0-9a-fA-F]+);?/gi, (_, hex) => {
      try { return String.fromCharCode(parseInt(hex, 16)) } catch (_e) { return '' }
    })
    .replace(/&#([0-9]+);?/g, (_, dec) => {
      try { return String.fromCharCode(parseInt(dec, 10)) } catch (_e) { return '' }
    })
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

/**
 * Escapes JSX-sensitive characters in SVG markup so text nodes and unquoted
 * curly braces cannot be interpreted as JavaScript expressions in TSX export (#406).
 * Replaces unquoted `{` and `}` outside attribute values with `&#123;` and `&#125;`.
 * @param {string} content
 * @returns {string}
 */
export function escapeJsxText(content) {
  if (!content || typeof content !== 'string') return ''
  let result = ''
  let inTag = false
  let quote = null

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]

    if (!inTag) {
      if (ch === '<') {
        inTag = true
        quote = null
        result += ch
      } else if (ch === '{') {
        result += '&#123;'
      } else if (ch === '}') {
        result += '&#125;'
      } else {
        result += ch
      }
    } else {
      if (quote) {
        if (ch === quote) {
          quote = null
        }
        result += ch
      } else {
        if (ch === '"' || ch === "'") {
          quote = ch
          result += ch
        } else if (ch === '>') {
          inTag = false
          result += ch
        } else if (ch === '{') {
          result += '&#123;'
        } else if (ch === '}') {
          result += '&#125;'
        } else {
          result += ch
        }
      }
    }
  }

  return result
}

/**
 * Issue #176: optimize_vector_svg
 * Cleans, sanitizes, and minifies SVG content, normalizes viewBox, and exports React TSX component.
 */
export function optimizeSvgContent(svgString, options = {}) {
  if (!svgString || typeof svgString !== 'string') {
    throw new Error('Invalid SVG string provided')
  }

  let cleaned = svgString.trim()
  if (!cleaned.includes('<svg')) {
    throw new Error('Content does not contain valid SVG markup (<svg ...>)')
  }

  cleaned = cleaned.replace(/<\?xml[\s\S]*?\?>/gi, '')
  cleaned = cleaned.replace(/<!DOCTYPE[\s\S]*?>/gi, '')
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '')

  cleaned = cleaned.replace(/\s*(?:xmlns:inkscape|xmlns:sodipodi|xmlns:sketch|inkscape:[a-z-]+|sodipodi:[a-z-]+|sketch:[a-z-]+)="[^"]*"/gi, '')
  cleaned = cleaned.replace(/<(?:metadata|sodipodi:namedview)[\s\S]*?<\/(?:metadata|sodipodi:namedview)>/gi, '')

  // Security (#374): Strip active/dangerous SVG tags (<script>, <foreignObject>, <iframe>, <embed>, <object>, <applet>)
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '')
  cleaned = cleaned.replace(/<script[^>]*\/?>/gi, '')
  cleaned = cleaned.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
  cleaned = cleaned.replace(/<foreignObject[^>]*\/?>/gi, '')
  cleaned = cleaned.replace(/<(?:iframe|embed|object|applet|handler|listener)[\s\S]*?<\/(?:iframe|embed|object|applet|handler|listener)>/gi, '')
  cleaned = cleaned.replace(/<(?:iframe|embed|object|applet|handler|listener)[^>]*\/?>/gi, '')

  // Security (#374): Strip dangerous SMIL animation elements (<animate>, <set>, etc.) targeting href/xlink:href/on* or containing script schemes
  cleaned = cleaned.replace(/<(animate|set|animateTransform|animateMotion|discard)\b[^>]*>[\s\S]*?<\/\1>/gi, (block) => {
    const norm = decodeHtmlEntities(block).replace(/[\s\x00-\x20]+/g, ' ').toLowerCase()
    if (
      /attributename\s*=\s*['"]?(?:href|xlink:href|src|action|formaction|on[a-z0-9_-]+)/.test(norm) ||
      /(?:javascript|vbscript|data\s*:\s*text\/html)/.test(norm)
    ) {
      return ''
    }
    return block
  })
  cleaned = cleaned.replace(/<(?:animate|set|animateTransform|animateMotion|discard)\b[^>]*\/?>/gi, (tag) => {
    const norm = decodeHtmlEntities(tag).replace(/[\s\x00-\x20]+/g, ' ').toLowerCase()
    if (
      /attributename\s*=\s*['"]?(?:href|xlink:href|src|action|formaction|on[a-z0-9_-]+)/.test(norm) ||
      /(?:javascript|vbscript|data\s*:\s*text\/html)/.test(norm)
    ) {
      return ''
    }
    return tag
  })

  // Strip event handler attributes (onload, onerror, onclick, etc., quoted or unquoted)
  cleaned = cleaned.replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')

  // Security (#374): Strip dangerous URI schemes (javascript:, vbscript:, data:text/html, etc.) in href/xlink:href/src/action/formaction
  // Handles HTML entity encoding (&#x73;), control chars, and unquoted attributes
  cleaned = cleaned.replace(/\s+(?:href|xlink:href|src|action|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (match, q1, q2, unquoted) => {
    const val = q1 !== undefined ? q1 : (q2 !== undefined ? q2 : unquoted)
    const decoded = decodeHtmlEntities(val)
    const normalized = decoded.replace(/[\x00-\x20\s]+/g, '').toLowerCase()
    if (
      normalized.startsWith('javascript:') ||
      normalized.startsWith('vbscript:') ||
      normalized.startsWith('data:text/html') ||
      normalized.startsWith('data:text/javascript') ||
      normalized.startsWith('data:image/svg+xml')
    ) {
      return ''
    }
    return match
  })

  cleaned = cleaned.replace(/\s{2,}/g, ' ')
  cleaned = cleaned.replace(/>\s+</g, '><')

  const viewBoxMatch = cleaned.match(/viewBox="([^"]+)"/i)
  let viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24'

  if (!viewBoxMatch) {
    const widthMatch = cleaned.match(/width="([0-9.]+)(?:px)?"/i)
    const heightMatch = cleaned.match(/height="([0-9.]+)(?:px)?"/i)
    if (widthMatch && heightMatch) {
      viewBox = `0 0 ${widthMatch[1]} ${heightMatch[1]}`
      cleaned = cleaned.replace(/<svg\b/i, `<svg viewBox="${viewBox}"`)
    }
  }

  const originalSize = Buffer.byteLength(svgString, 'utf8')
  const optimizedSize = Buffer.byteLength(cleaned, 'utf8')
  const savedBytes = Math.max(0, originalSize - optimizedSize)
  const reductionPercent = Math.round((savedBytes / (originalSize || 1)) * 100)

  const componentName = options.componentName || 'VectorIcon'
  let jsxBody = cleaned
    .replace(/<svg\b[^>]*>/i, '')
    .replace(/<\/svg>/i, '')
    .replace(/class=/g, 'className=')
    .replace(/clip-rule=/g, 'clipRule=')
    .replace(/fill-rule=/g, 'fillRule=')
    .replace(/stroke-width=/g, 'strokeWidth=')
    .replace(/stroke-linecap=/g, 'strokeLinecap=')
    .replace(/stroke-linejoin=/g, 'strokeLinejoin=')
    .replace(/stroke-miterlimit=/g, 'strokeMiterlimit=')

  jsxBody = escapeJsxText(jsxBody)

  const reactTsx = `import React from 'react';

export interface ${componentName}Props extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

export const ${componentName}: React.FC<${componentName}Props> = ({ size = 24, className, ...props }) => (
  <svg
    viewBox="${viewBox}"
    width={size}
    height={size}
    fill="currentColor"
    className={className}
    {...props}
  >
    ${jsxBody.trim()}
  </svg>
);
`

  return {
    svg: cleaned,
    viewBox,
    originalSize,
    optimizedSize,
    savedBytes,
    reductionPercent,
    reactTsx,
  }
}

export function buildIcoBuffer(pngFrames) {
  const count = pngFrames.length
  const headerLen = 6 + count * 16
  let currentOffset = headerLen

  const entries = []
  for (const item of pngFrames) {
    entries.push({
      width: item.width >= 256 ? 0 : item.width,
      height: item.height >= 256 ? 0 : item.height,
      size: item.buffer.length,
      offset: currentOffset,
      buffer: item.buffer,
    })
    currentOffset += item.buffer.length
  }

  const out = Buffer.alloc(currentOffset)
  // Header: reserved 0, type 1 (icon), count
  out.writeUInt16LE(0, 0)
  out.writeUInt16LE(1, 2)
  out.writeUInt16LE(count, 4)

  let entryPos = 6
  for (const entry of entries) {
    out.writeUInt8(entry.width, entryPos)
    out.writeUInt8(entry.height, entryPos + 1)
    out.writeUInt8(0, entryPos + 2) // color count
    out.writeUInt8(0, entryPos + 3) // reserved
    out.writeUInt16LE(1, entryPos + 4) // planes
    out.writeUInt16LE(32, entryPos + 6) // bpp
    out.writeUInt32LE(entry.size, entryPos + 8) // size
    out.writeUInt32LE(entry.offset, entryPos + 12) // offset
    entry.buffer.copy(out, entry.offset)
    entryPos += 16
  }
  return out
}

async function getDefaultIconBytes(name, themeColor) {
  const initial = (name || 'A').trim().charAt(0).toUpperCase() || 'A'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="100" fill="${themeColor || '#0f172a'}"/>
    <text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" font-size="280" font-weight="bold" fill="#ffffff" dominant-baseline="middle" text-anchor="middle">${initial}</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/**
 * Issue #190 & #387: generate_pwa_icon_suite
 * Generates standard PWA icon suite, web app manifest.json, multi-resolution favicon.ico, and HTML snippet.
 */
export async function generatePwaIconSuite({
  name = 'App',
  shortName = 'App',
  themeColor = '#0f172a',
  backgroundColor = '#ffffff',
  iconsDir = 'icons',
  sourcePath = null,
  imageBytes = null,
  outDir = null,
} = {}) {
  // 1. Resolve source image buffer
  let source = imageBytes
  if (!source && sourcePath) {
    try {
      source = await fs.readFile(sourcePath)
    } catch (_err) { source = null }
  }
  if (!source) {
    source = await getDefaultIconBytes(name, themeColor)
  }

  const iconSizes = [
    { size: 16, rel: 'icon', filename: `${iconsDir}/favicon-16x16.png`, purpose: 'any' },
    { size: 32, rel: 'icon', filename: `${iconsDir}/favicon-32x32.png`, purpose: 'any' },
    { size: 48, rel: 'icon', filename: `${iconsDir}/favicon-48x48.png`, purpose: 'any' },
    { size: 180, rel: 'apple-touch-icon', filename: `${iconsDir}/apple-touch-icon.png`, purpose: 'any' },
    { size: 192, rel: 'manifest', filename: `${iconsDir}/icon-192x192.png`, purpose: 'any' },
    { size: 512, rel: 'manifest', filename: `${iconsDir}/icon-512x512.png`, purpose: 'any' },
    { size: 512, rel: 'manifest', filename: `${iconsDir}/icon-512x512-maskable.png`, purpose: 'maskable' },
  ]

  // 2. Render all PNG icons via Sharp
  const generatedIcons = []
  const icoFrames = []

  for (const item of iconSizes) {
    let pngBuf
    if (item.purpose === 'maskable') {
      // Safe zone requires 10% padding on each side -> inner icon is 80% of canvas (#387)
      const innerSize = Math.max(1, Math.round(item.size * 0.8))
      const inner = await sharp(source)
        .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()

      pngBuf = await sharp({
        create: {
          width: item.size,
          height: item.size,
          channels: 4,
          background: backgroundColor || '#ffffff',
        },
      })
        .composite([{ input: inner, gravity: 'center' }])
        .png()
        .toBuffer()
    } else {
      pngBuf = await sharp(source)
        .resize(item.size, item.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    }

    generatedIcons.push({
      ...item,
      bytes: pngBuf,
    })

    if ([16, 32, 48].includes(item.size) && item.rel === 'icon') {
      icoFrames.push({ width: item.size, height: item.size, buffer: pngBuf })
    }
  }

  // 3. Multi-resolution favicon.ico containing 16, 32, 48 px PNG frames (#387)
  const faviconIcoBuffer = buildIcoBuffer(icoFrames)
  const faviconIcoFilename = `${iconsDir}/favicon.ico`

  // 4. Manifest JSON
  const manifest = {
    name,
    short_name: shortName,
    start_url: '/',
    display: 'standalone',
    background_color: backgroundColor,
    theme_color: themeColor,
    icons: generatedIcons
      .filter((i) => i.rel === 'manifest')
      .map((i) => ({
        src: i.filename,
        sizes: `${i.size}x${i.size}`,
        type: 'image/png',
        purpose: i.purpose,
      })),
  }
  const manifestJson = JSON.stringify(manifest, null, 2)

  // 5. HTML snippet
  const htmlHeadSnippet = [
    `<link rel="icon" href="/${faviconIcoFilename}" sizes="any">`,
    `<link rel="icon" type="image/png" sizes="16x16" href="/${iconsDir}/favicon-16x16.png">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="/${iconsDir}/favicon-32x32.png">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="/${iconsDir}/apple-touch-icon.png">`,
    `<link rel="manifest" href="/manifest.json">`,
    `<meta name="theme-color" content="${themeColor}">`,
  ].join('\n')

  // 6. Write files to outDir if provided
  const exportedFiles = []
  if (outDir) {
    const fullIconsDir = resolveInside(outDir, iconsDir || 'icons')
    await fs.mkdir(fullIconsDir, { recursive: true })

    for (const item of generatedIcons) {
      const filePath = resolveInside(outDir, item.filename)
      await fs.writeFile(filePath, item.bytes)
      exportedFiles.push(filePath)
    }

    const icoPath = resolveInside(outDir, faviconIcoFilename)
    await fs.writeFile(icoPath, faviconIcoBuffer)
    exportedFiles.push(icoPath)

    const manifestPath = resolveInside(outDir, 'manifest.json')
    await fs.writeFile(manifestPath, manifestJson)
    exportedFiles.push(manifestPath)
  }

  // Strip internal bytes property from public icons list to avoid huge JSON serialization
  const cleanIcons = generatedIcons.map(({ bytes, ...rest }) => rest)

  return {
    name,
    shortName,
    themeColor,
    backgroundColor,
    icons: cleanIcons,
    faviconIco: faviconIcoFilename,
    manifestJson,
    htmlHeadSnippet,
    exportedFiles,
  }
}
