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
 * Extract palette sample colors from raw image bytes.
 * Scans byte frequencies and samples color anchors across buffer.
 * @param {Buffer} buffer
 * @returns {string[]} Hex colors
 */
export function extractSampleColorsFromBuffer(buffer) {
  if (!buffer || buffer.length < 16) {
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

  // Sample bytes from buffer chunks
  const step = Math.max(4, Math.floor(buffer.length / 500))
  const samples = []
  for (let i = 64; i < buffer.length - 8; i += step) {
    const r = buffer[i]
    const g = buffer[i + 1]
    const b = buffer[i + 2]
    samples.push({ r, g, b })
  }

  if (samples.length === 0) {
    return ['#0f172a', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#f8fafc']
  }

  samples.sort((a, b) => (a.r * 299 + a.g * 587 + a.b * 114) - (b.r * 299 + b.g * 587 + b.b * 114))

  const anchors = []
  const bucketSize = Math.floor(samples.length / 6)
  for (let b = 0; b < 6; b++) {
    const start = b * bucketSize
    const end = b === 5 ? samples.length : start + bucketSize
    let sumR = 0, sumG = 0, sumB = 0
    for (let j = start; j < end; j++) {
      sumR += samples[j].r
      sumG += samples[j].g
      sumB += samples[j].b
    }
    const count = Math.max(1, end - start)
    anchors.push(rgbToHex(sumR / count, sumG / count, sumB / count))
  }

  const unique = Array.from(new Set(anchors))
  while (unique.length < 5) {
    unique.push('#3b82f6')
  }
  return unique
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
 * Issue #176: optimize_vector_svg
 * Cleans, sanitizes, and minifies SVG content, normalizes viewBox, and exports React TSX component.
 */
export function optimizeSvgContent(svgString, options = {}) {
  if (!svgString || typeof svgString !== 'string') {
    throw new Error('Invalid SVG string provided')
  }

  let cleaned = svgString.trim()

  cleaned = cleaned.replace(/<\?xml[\s\S]*?\?>/gi, '')
  cleaned = cleaned.replace(/<!DOCTYPE[\s\S]*?>/gi, '')
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '')

  cleaned = cleaned.replace(/\s*(?:xmlns:inkscape|xmlns:sodipodi|xmlns:sketch|inkscape:[a-z-]+|sodipodi:[a-z-]+|sketch:[a-z-]+)="[^"]*"/gi, '')
  cleaned = cleaned.replace(/<(?:metadata|sodipodi:namedview)[\s\S]*?<\/(?:metadata|sodipodi:namedview)>/gi, '')

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

/**
 * Issue #190: generate_pwa_icon_suite
 * Generates standard PWA icon suite metadata, web app manifest.json, and icon configuration.
 */
export async function generatePwaIconSuite({
  name = 'App',
  shortName = 'App',
  themeColor = '#0f172a',
  backgroundColor = '#ffffff',
  iconsDir = 'icons',
  sourcePath = null,
} = {}) {
  const iconSizes = [
    { size: 16, rel: 'icon', filename: `${iconsDir}/favicon-16x16.png`, purpose: 'any' },
    { size: 32, rel: 'icon', filename: `${iconsDir}/favicon-32x32.png`, purpose: 'any' },
    { size: 48, rel: 'icon', filename: `${iconsDir}/favicon-48x48.png`, purpose: 'any' },
    { size: 180, rel: 'apple-touch-icon', filename: `${iconsDir}/apple-touch-icon.png`, purpose: 'any' },
    { size: 192, rel: 'manifest', filename: `${iconsDir}/icon-192x192.png`, purpose: 'any' },
    { size: 512, rel: 'manifest', filename: `${iconsDir}/icon-512x512.png`, purpose: 'any' },
    { size: 512, rel: 'manifest', filename: `${iconsDir}/icon-512x512-maskable.png`, purpose: 'maskable' },
  ]

  const manifest = {
    name,
    short_name: shortName,
    start_url: '/',
    display: 'standalone',
    background_color: backgroundColor,
    theme_color: themeColor,
    icons: iconSizes
      .filter((i) => i.rel === 'manifest')
      .map((i) => ({
        src: i.filename,
        sizes: `${i.size}x${i.size}`,
        type: 'image/png',
        purpose: i.purpose,
      })),
  }

  const htmlHeadSnippet = [
    `<link rel="icon" type="image/png" sizes="16x16" href="/${iconsDir}/favicon-16x16.png">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="/${iconsDir}/favicon-32x32.png">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="/${iconsDir}/apple-touch-icon.png">`,
    `<link rel="manifest" href="/manifest.json">`,
    `<meta name="theme-color" content="${themeColor}">`,
  ].join('\n')

  return {
    name,
    shortName,
    themeColor,
    backgroundColor,
    icons: iconSizes,
    manifestJson: JSON.stringify(manifest, null, 2),
    htmlHeadSnippet,
  }
}
