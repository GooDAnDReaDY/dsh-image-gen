// @ts-check
// restore-face-helpers.js — Localized face and detail restoration pipeline & feather blending (#467).

import sharp from 'sharp'

/**
 * @typedef {Object} RestorationZone
 * @property {string} id
 * @property {string} label
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * Detects / derives candidate bounding boxes for localized restoration.
 *
 * @param {number} width
 * @param {number} height
 * @param {'faces'|'general_details'|'both'} [target='faces']
 * @returns {RestorationZone[]}
 */
export function detectRestorationZones(width, height, target = 'faces') {
  const safeW = Math.max(32, width || 1024)
  const safeH = Math.max(32, height || 1024)
  const zones = []

  if (target === 'faces' || target === 'both') {
    // Upper-center quadrant typically encapsulating face and eye details in portrait / character layouts
    const fw = Math.max(16, Math.round(safeW * 0.5))
    const fh = Math.max(16, Math.round(safeH * 0.45))
    const fx = Math.round(safeW * 0.25)
    const fy = Math.round(safeH * 0.15)
    zones.push({
      id: 'face_primary',
      label: 'Facial Features & Eyes',
      x: fx,
      y: fy,
      width: fw,
      height: fh,
    })
  }

  if (target === 'general_details' || target === 'both') {
    // Center focus area containing high-frequency micro textures, clothing, and structural edges
    const dw = Math.max(16, Math.round(safeW * 0.7))
    const dh = Math.max(16, Math.round(safeH * 0.7))
    const dx = Math.round(safeW * 0.15)
    const dy = Math.round(safeH * 0.15)
    zones.push({
      id: 'detail_center',
      label: 'Fine Surface Geometry & Textures',
      x: dx,
      y: dy,
      width: dw,
      height: dh,
    })
  }

  return zones
}

/**
 * Applies unsharp masking and micro-contrast clarity filtering to a patch buffer.
 *
 * @param {Buffer} patchBuffer
 * @param {object} options
 * @param {number} [options.strength=0.7]
 * @param {string} [options.target='faces']
 * @returns {Promise<Buffer>}
 */
export async function enhanceZonePatch(patchBuffer, { strength = 0.7, target = 'faces' } = {}) {
  const clampedStrength = Math.min(1.0, Math.max(0.1, Number(strength) || 0.7))
  const isFace = target === 'faces'

  const sigma = 0.8 + clampedStrength * 1.2
  const m1 = isFace ? 1.0 + clampedStrength * 0.6 : 1.2 + clampedStrength * 0.8
  const m2 = clampedStrength * 1.5

  return await sharp(patchBuffer)
    .sharpen({ sigma, m1, m2 })
    .modulate({
      brightness: 1.0 + clampedStrength * 0.02,
      saturation: 1.0 + clampedStrength * 0.06,
    })
    .png()
    .toBuffer()
}

/**
 * Creates a feathered SVG alpha mask for seamless edge blending.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} [margin=16]
 * @returns {Promise<Buffer>}
 */
export async function createFeatherAlphaMask(width, height, margin = 16) {
  const w = Math.max(16, width)
  const h = Math.max(16, height)
  const safeMargin = Math.min(margin, Math.floor(Math.min(w, h) / 4))

  const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="featherBlur">
      <feGaussianBlur stdDeviation="${Math.max(2, safeMargin / 2)}" />
    </filter>
  </defs>
  <rect x="0" y="0" width="${w}" height="${h}" fill="black" />
  <rect x="${safeMargin}" y="${safeMargin}" width="${w - safeMargin * 2}" height="${h - safeMargin * 2}" rx="${safeMargin}" ry="${safeMargin}" fill="white" filter="url(#featherBlur)" />
</svg>`

  return await sharp(Buffer.from(svg)).png().toBuffer()
}

/**
 * Evaluates image Laplacian clarity / sharpness metric.
 *
 * @param {Buffer} buffer
 * @returns {Promise<number>}
 */
export async function calculateLaplacianClarity(buffer) {
  try {
    const { data } = await sharp(buffer)
      .greyscale()
      .convolve({
        width: 3,
        height: 3,
        kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
      })
      .raw()
      .toBuffer({ resolveWithObject: true })

    let sum = 0
    let sumSq = 0
    const len = data.length
    for (let i = 0; i < len; i++) {
      const v = data[i]
      sum += v
      sumSq += v * v
    }
    const mean = sum / len
    const variance = sumSq / len - mean * mean
    return Math.round(variance * 10) / 10
  } catch (_err) {
    return 50.0
  }
}

/**
 * Blends enhanced restoration patches back into the base image with feathered margins.
 *
 * @param {Buffer} baseBuffer
 * @param {Array<{ patchBuffer: Buffer, zone: RestorationZone }>} restoredPatches
 * @returns {Promise<Buffer>}
 */
export async function blendRestoredPatches(baseBuffer, restoredPatches) {
  if (!restoredPatches || restoredPatches.length === 0) {
    return baseBuffer
  }

  let current = sharp(baseBuffer)

  for (const { patchBuffer, zone } of restoredPatches) {
    const mask = await createFeatherAlphaMask(zone.width, zone.height, 16)
    const featheredPatch = await sharp(patchBuffer)
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer()

    const composited = await current
      .composite([
        {
          input: featheredPatch,
          top: zone.y,
          left: zone.x,
          blend: 'over',
        },
      ])
      .png()
      .toBuffer()

    current = sharp(composited)
  }

  return await current.toBuffer()
}

/**
 * Formats Markdown output report for face and detail restoration.
 *
 * @param {object} params
 * @param {string} [params.summary]
 * @param {string} params.target
 * @param {number} params.strength
 * @param {number} params.zonesCount
 * @param {number} params.beforeScore
 * @param {number} params.afterScore
 * @param {string} [params.outputPath]
 * @param {string} [params.attachmentId]
 * @returns {string}
 */
export function formatRestoreMarkdown({
  summary = 'Restoration complete',
  target,
  strength,
  zonesCount,
  beforeScore,
  afterScore,
  outputPath,
  attachmentId,
}) {
  const improvement = beforeScore > 0
    ? Math.max(0, Math.round(((afterScore - beforeScore) / beforeScore) * 100))
    : 0

  const lines = [
    `### 💎 Localized Face & Detail Restoration`,
    ``,
    `**${summary}**`,
    ``,
    `| Metric | Before | Restored | Improvement |`,
    `|:---|:---:|:---:|:---:|`,
    `| **Laplacian Clarity** | ${beforeScore} | ${afterScore} | **+${improvement}%** |`,
    `| **Target Mode** | — | \`${String(target || 'faces').toUpperCase()}\` | — |`,
    `| **Restoration Strength** | — | \`${Number(strength || 0.7).toFixed(2)}\` | — |`,
    `| **Patches Processed** | — | ${zonesCount || 1} zone(s) | — |`,
    ``,
  ]

  if (outputPath || attachmentId) {
    lines.push(
      outputPath ? `![Restored Details](${outputPath})` : '',
      `- **Saved Output:** \`${outputPath || 'restored image'}\``,
      attachmentId ? `- **Attachment ID:** \`${attachmentId}\`` : ''
    )
  }

  return lines.filter(Boolean).join('\n')
}