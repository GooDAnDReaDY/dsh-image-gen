// @ts-check
// turnaround-helpers.js — Model sheet prompt pipeline, horizontal slice extraction, and dimension validation (#464).

import sharp from 'sharp'

export const DEFAULT_TURNAROUND_ANGLES = ['front', 'side', 'back', 'three_quarter']
export const ALL_SUPPORTED_ANGLES = ['front', 'side', 'back', 'three_quarter', 'iso_45', 'top']

/**
 * Builds calibrated model sheet prompt for generating horizontal turnaround alignments.
 *
 * @param {object} params
 * @param {string} params.prompt
 * @param {'character'|'prop'|'vehicle'|'creature'} [params.subjectType='character']
 * @param {string[]} [params.angles]
 * @param {string} [params.style]
 * @returns {string}
 */
export function buildTurnaroundPrompt({
  prompt,
  subjectType = 'character',
  angles = DEFAULT_TURNAROUND_ANGLES,
  style,
}) {
  const cleanPrompt = String(prompt || '').trim()
  const activeAngles = Array.isArray(angles) && angles.length >= 2
    ? angles
    : DEFAULT_TURNAROUND_ANGLES

  const angleLabels = activeAngles.map((a) => `${a.replace('_', ' ')} view`).join(', ')

  let poseDirective = 'neutral T-pose or A-pose'
  if (subjectType === 'prop' || subjectType === 'vehicle') {
    poseDirective = 'neutral upright orthographic alignment'
  } else if (subjectType === 'creature') {
    poseDirective = 'neutral static standing pose'
  }

  const modelSheetDirectives = [
    cleanPrompt,
    `professional 3D model sheet turnaround for ${subjectType}`,
    `multiple full-body perspectives arranged horizontally side by side in a single image: [${angleLabels}]`,
    poseDirective,
    'consistent scale, identical proportions, matching heights aligned across horizontal guide lines',
    'plain solid neutral light grey studio background, diffuse soft ambient lighting',
    'game ready asset reference, clean silhouette, orthographic perspective',
  ]

  if (style) {
    modelSheetDirectives.push(`${style} aesthetic`)
  }

  return modelSheetDirectives.filter(Boolean).join(', ')
}

/**
 * Slices a single horizontal turnaround sheet buffer into individual perspective image files.
 *
 * @param {object} params
 * @param {Buffer} params.sheetBuffer
 * @param {string[]} [params.angles]
 * @returns {Promise<Array<{ angle: string, index: number, buffer: Buffer, width: number, height: number }>>}
 */
export async function sliceTurnaroundSheet({
  sheetBuffer,
  angles = DEFAULT_TURNAROUND_ANGLES,
}) {
  if (!Buffer.isBuffer(sheetBuffer) || sheetBuffer.length === 0) {
    throw new Error('Invalid sheetBuffer provided to sliceTurnaroundSheet')
  }

  const activeAngles = Array.isArray(angles) && angles.length >= 2
    ? angles
    : DEFAULT_TURNAROUND_ANGLES

  const meta = await sharp(sheetBuffer).metadata()
  let safeBuffer = sheetBuffer
  let totalW = meta.width || 1024
  let totalH = meta.height || 512
  const count = activeAngles.length
  const minWidthNeeded = count * 16

  if (totalW < minWidthNeeded || totalH < 16) {
    totalW = Math.max(minWidthNeeded, totalW)
    totalH = Math.max(16, totalH)
    safeBuffer = await sharp(sheetBuffer)
      .resize(totalW, totalH, { fit: 'fill' })
      .png()
      .toBuffer()
  }

  const colWidth = Math.floor(totalW / count)

  const slices = []
  for (let i = 0; i < count; i++) {
    const angle = activeAngles[i]
    const left = i * colWidth
    const width = Math.max(1, (i === count - 1) ? (totalW - left) : colWidth)

    const sliceBuffer = await sharp(safeBuffer)
      .extract({ left, top: 0, width, height: totalH })
      .png()
      .toBuffer()

    slices.push({
      angle,
      index: i,
      buffer: sliceBuffer,
      width,
      height: totalH,
    })
  }

  return slices
}

/**
 * Formats Markdown presentation table and metadata for turnaround sheets.
 *
 * @param {object} params
 * @param {string} params.prompt
 * @param {string} params.subjectType
 * @param {string[]} params.angles
 * @param {string} [params.sheetUrl]
 * @param {Array<{ angle: string, path: string, url?: string, width: number, height: number }>} params.slices
 * @param {string} [params.manifestPath]
 * @returns {string}
 */
export function formatTurnaroundMarkdown({
  prompt,
  subjectType,
  angles,
  sheetUrl,
  slices,
  manifestPath,
}) {
  const lines = [
    `### Multi-Angle Turnaround Model Sheet (${String(subjectType || 'character').toUpperCase()})`,
    `**Prompt:** *${prompt}*`,
    `**Angles:** ${(Array.isArray(angles) ? angles : []).map((a) => `\`${a}\``).join(', ')}`,
    '',
  ]

  if (sheetUrl) {
    lines.push(`![Full Turnaround Sheet](${sheetUrl})`, '')
  }

  lines.push(
    '| Angle | Dimensions | Slice File |',
    '| :---: | :---: | :--- |',
  )

  for (const s of slices) {
    lines.push(
      `| **${s.angle}** | \`${s.width}×${s.height}\` | \`${s.path || s.url || '-'}\` |`,
    )
  }

  if (manifestPath) {
    lines.push('', `**Model Sheet Manifest:** \`${manifestPath}\``)
  }

  lines.push(
    '',
    `> **3D / Game Engine Ready:** All angle views sliced with matching heights and consistent scale for texture projection, sprite sheets, or photogrammetry reference.`,
  )

  return lines.join('\n')
}

