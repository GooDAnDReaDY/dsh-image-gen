// @ts-check
// reverse-prompt-helpers.js — Vision aesthetic deconstruction, reverse prompt synthesis & formatting (#465).

import sharp from 'sharp'

/**
 * @typedef {Object} AestheticsAnalysis
 * @property {string} lighting
 * @property {string} optics
 * @property {string} paletteMood
 * @property {string} composition
 * @property {string} medium
 * @property {string} sharpnessLevel
 * @property {number} brightness
 * @property {number} saturationRatio
 * @property {string[]} dominantHexes
 */

/**
 * Analyzes image buffer and extracts aesthetic parameters (lighting, optics, palette, medium).
 *
 * @param {Buffer} buffer
 * @returns {Promise<AestheticsAnalysis>}
 */
export async function deconstructImageAesthetics(buffer) {
  const image = sharp(buffer)
  const meta = await image.metadata()
  const stats = await image.stats()

  const width = meta.width || 1024
  const height = meta.height || 1024
  const ratio = width / height

  // 1. Channel statistics
  const channels = stats.channels || []
  const rMean = (channels[0] && channels[0].mean) || 128
  const gMean = (channels[1] && channels[1].mean) || 128
  const bMean = (channels[2] && channels[2].mean) || 128

  // Standard perceived luminance formula
  const brightness = Math.round(0.299 * rMean + 0.587 * gMean + 0.114 * bMean)

  // Approximate saturation ratio via channel spread
  const maxCh = Math.max(rMean, gMean, bMean)
  const minCh = Math.min(rMean, gMean, bMean)
  const saturationRatio = maxCh > 0 ? (maxCh - minCh) / maxCh : 0

  // 2. Derive lighting profile
  let lighting = 'balanced ambient studio lighting with subtle directional rim light'
  if (brightness > 175) {
    lighting = 'high-key ethereal lighting, soft diffuse highlights, bright radiant illumination'
  } else if (brightness < 75) {
    lighting = 'moody low-key chiaroscuro lighting, deep atmospheric shadows, sharp specular highlights'
  } else if (saturationRatio > 0.4) {
    lighting = 'dynamic cinematic lighting with vibrant chromatic glow and color spill'
  }

  // 3. Derive optics & focal characteristics
  let optics = '50mm prime lens, shallow depth of field, sharp focal plane, natural bokeh'
  if (ratio >= 1.6) {
    optics = '35mm anamorphic widescreen cinematic lens, sweeping field of view, subtle edge vignette'
  } else if (ratio <= 0.65) {
    optics = '85mm portrait telephoto lens, f/1.4 aperture, creamy background compression, crisp subject focus'
  } else if (Math.abs(ratio - 1) < 0.15) {
    optics = 'medium format 6x6 Hasselblad framing, balanced symmetrical perspective, edge-to-edge sharpness'
  }

  // 4. Derive palette mood
  let paletteMood = 'harmonious natural tones with balanced chroma'
  if (saturationRatio > 0.45) {
    paletteMood = 'vibrant high-saturation chromatic harmony, bold contrasting color accents'
  } else if (saturationRatio < 0.15) {
    paletteMood = 'restrained monochromatic tonal palette, subtle desaturated pastels, filmic grain'
  } else if (rMean > gMean + 20 && rMean > bMean + 20) {
    paletteMood = 'warm golden hour warmth, amber and terracotta primary tones'
  } else if (bMean > rMean + 20 && bMean > gMean + 15) {
    paletteMood = 'cool twilight chromatic palette, cyan and deep cobalt shadows'
  }

  // 5. Derive composition framing
  let composition = 'centered subject with balanced negative space'
  if (ratio > 1.3) {
    composition = 'rule-of-thirds horizontal landscape layout, environmental depth layers'
  } else if (ratio < 0.8) {
    composition = 'vertical character silhouette, dominant vertical hierarchy, intimate framing'
  }

  // 6. Medium and sharpness
  const rStdev = (channels[0] && channels[0].stdev) || 30
  const sharpnessLevel = rStdev > 45 ? 'ultra-high micro-contrast with pristine surface fidelity' : 'soft filmic diffusion with organic textural gradient'

  const toHex = (n) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0')
  const dominantHexes = [
    `#${toHex(rMean)}${toHex(gMean)}${toHex(bMean)}`,
    `#${toHex(rMean * 0.8)}${toHex(gMean * 0.85)}${toHex(bMean * 0.9)}`,
    `#${toHex(Math.min(255, rMean * 1.2))}${toHex(Math.min(255, gMean * 1.15))}${toHex(Math.min(255, bMean * 1.1))}`
  ]

  const medium = 'editorial digital masterpiece, award-winning visual composition'

  return {
    lighting,
    optics,
    paletteMood,
    composition,
    medium,
    sharpnessLevel,
    brightness,
    saturationRatio,
    dominantHexes,
  }
}

/**
 * Synthesizes a structured reverse-engineered prompt with aesthetic tags and modifiers.
 *
 * @param {object} params
 * @param {AestheticsAnalysis} params.aesthetics
 * @param {string} [params.baseSubject]
 * @param {string} [params.styleModifications]
 * @returns {{ extractedPrompt: string, negativePrompt: string }}
 */
export function synthesizeReversePrompt({ aesthetics, baseSubject, styleModifications }) {
  const subject = (baseSubject || '').trim() || 'evocative visual artwork'
  const mods = (styleModifications || '').trim()

  const parts = [
    subject,
    aesthetics.medium,
    aesthetics.lighting,
    aesthetics.optics,
    aesthetics.paletteMood,
    aesthetics.composition,
    aesthetics.sharpnessLevel,
  ]

  if (mods) {
    parts.push(`[artistic adjustment: ${mods}]`)
  }

  const extractedPrompt = parts.filter(Boolean).join(', ')

  const negativePrompt = 'blurry, low quality, jpeg artifacts, pixelated, distorted anatomy, deformed proportions, out of frame, watermark, signature'

  return {
    extractedPrompt,
    negativePrompt,
  }
}

/**
 * Formats Markdown output for reverse prompt and recreate results.
 *
 * @param {object} params
 * @param {string} params.extractedPrompt
 * @param {string} params.negativePrompt
 * @param {AestheticsAnalysis} params.aesthetics
 * @param {string} [params.recreatedPath]
 * @param {string} [params.recreatedId]
 * @param {boolean} [params.recreated]
 * @param {string} [params.sourcePath]
 * @returns {string}
 */
export function formatReversePromptMarkdown({
  extractedPrompt,
  negativePrompt,
  aesthetics,
  recreatedPath,
  recreatedId,
  recreated = false,
  sourcePath,
}) {
  const lines = [
    `### 🔮 Reverse Prompt & Aesthetic Reconstruction`,
    ``,
    `#### 🔍 Deconstructed Aesthetics`,
    `- **Lighting:** ${aesthetics?.lighting || 'Balanced illumination'}`,
    `- **Optics & Framing:** ${aesthetics?.optics || '50mm prime standard'}`,
    `- **Color Palette Mood:** ${aesthetics?.paletteMood || 'Harmonious palette'}`,
    `- **Composition:** ${aesthetics?.composition || 'Centered rule-of-thirds'}`,
    `- **Micro-Detail:** ${aesthetics?.sharpnessLevel || 'High fidelity'}`,
    ``,
    `#### 📝 Recovered Prompt`,
    `\`\`\`text`,
    extractedPrompt,
    `\`\`\``,
    ``,
    `#### 🚫 Recommended Negative Prompt`,
    `\`\`\`text`,
    negativePrompt,
    `\`\`\``,
  ]

  if (recreated && (recreatedPath || recreatedId)) {
    lines.push(
      ``,
      `#### 🎨 Recreated Visual Asset`,
      recreatedPath ? `![Recreated Artwork](${recreatedPath})` : '',
      `- **Target File:** \`${recreatedPath || 'session asset'}\``,
      recreatedId ? `- **Attachment ID:** \`${recreatedId}\`` : ''
    )
  }

  return lines.filter(Boolean).join('\n')
}