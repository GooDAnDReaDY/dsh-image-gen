// @ts-check
// image-matrix-helpers.js — Variation matrix generator and contact sheet compositing (#461).

import sharp from 'sharp'

/**
 * Builds deterministic plan of variants based on exploration parameter.
 *
 * @param {object} params
 * @param {string} params.prompt
 * @param {number} [params.count=4] 4 or 9
 * @param {'seed'|'cfg'} [params.vary='seed']
 * @param {number} [params.baseSeed]
 * @param {number} [params.baseCfg=7.0]
 * @returns {{ gridRows: number, gridCols: number, variants: Array<{ id: string, index: number, seed: number, guidanceScale: number, label: string }> }}
 */
export function buildVariationPlan({
  prompt: _prompt,
  count = 4,
  vary = 'seed',
  baseSeed,
  baseCfg = 7.0,
}) {
  const normCount = Number(count) === 9 ? 9 : 4
  const gridRows = normCount === 9 ? 3 : 2
  const gridCols = normCount === 9 ? 3 : 2
  const exploration = vary === 'cfg' ? 'cfg' : 'seed'
  const rootSeed = baseSeed !== undefined && baseSeed !== null
    ? Math.abs(parseInt(String(baseSeed), 10))
    : Math.floor(Math.random() * 100000)

  const defaultScales4 = [3.5, 7.0, 10.5, 14.0]
  const defaultScales9 = [3.0, 4.5, 6.0, 7.5, 9.0, 10.5, 12.0, 13.5, 15.0]
  const scales = normCount === 9 ? defaultScales9 : defaultScales4

  const variants = []
  for (let i = 0; i < normCount; i++) {
    const id = `V${i + 1}`
    let seed = rootSeed
    let guidanceScale = Number(baseCfg) || 7.0
    let label = ''

    if (exploration === 'seed') {
      seed = (rootSeed + i * 1013) % 2147483647
      label = `[${id}] Seed: ${seed}`
    } else {
      guidanceScale = scales[i]
      label = `[${id}] CFG: ${guidanceScale}`
    }

    variants.push({
      id,
      index: i,
      seed,
      guidanceScale,
      label,
    })
  }

  return {
    gridRows,
    gridCols,
    variants,
  }
}

/**
 * Builds an SVG badge buffer with index and parameter info.
 *
 * @param {string} label
 * @param {number} [width=150]
 * @param {number} [height=28]
 * @returns {Buffer}
 */
export function createTileBadgeSvg(label, width = 160, height = 28) {
  const safeText = String(label || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" rx="6" fill="#000000" fill-opacity="0.8" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="1"/>
  <text x="12" y="19" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="600" font-size="12" letter-spacing="0.5">${safeText}</text>
</svg>`
  return Buffer.from(svg)
}

/**
 * Composites individual variation image buffers into a structured Contact Sheet grid.
 *
 * @param {object} params
 * @param {Array<{ bytes: Buffer, label: string }>} params.tiles
 * @param {number} params.tileWidth
 * @param {number} params.tileHeight
 * @param {number} params.rows
 * @param {number} params.cols
 * @returns {Promise<Buffer>}
 */
export async function compositeContactSheet({
  tiles,
  tileWidth,
  tileHeight,
  rows,
  cols,
}) {
  const totalW = cols * tileWidth
  const totalH = rows * tileHeight

  const compositeInputs = []

  for (let idx = 0; idx < tiles.length; idx++) {
    const tile = tiles[idx]
    if (!tile?.bytes) continue

    const r = Math.floor(idx / cols)
    const c = idx % cols
    const top = r * tileHeight
    const left = c * tileWidth

    // Resize tile if needed to guarantee grid alignment
    const resizedTile = await sharp(tile.bytes)
      .resize(tileWidth, tileHeight, { fit: 'cover' })
      .toBuffer()

    compositeInputs.push({
      input: resizedTile,
      top,
      left,
    })

    // Badge overlay
    if (tile.label) {
      const badgeBuffer = createTileBadgeSvg(tile.label)
      compositeInputs.push({
        input: badgeBuffer,
        top: top + 10,
        left: left + 10,
      })
    }
  }

  // Create solid dark canvas and composite all cells
  const sheet = await sharp({
    create: {
      width: totalW,
      height: totalH,
      channels: 4,
      background: { r: 15, g: 17, b: 23, alpha: 1 },
    },
  })
    .composite(compositeInputs)
    .png()
    .toBuffer()

  return sheet
}

/**
 * Formats Markdown presentation table and quick selection instructions.
 *
 * @param {object} params
 * @param {string} params.prompt
 * @param {number} params.count
 * @param {string} params.vary
 * @param {string} [params.contactSheetUrl]
 * @param {Array<{ id: string, seed: number, guidanceScale: number, path: string, url?: string }>} params.variants
 * @returns {string}
 */
export function formatImageMatrixMarkdown({
  prompt,
  count,
  vary,
  contactSheetUrl,
  variants,
}) {
  const lines = [
    `### Image Variation Matrix (${count} Variants, vary: ${vary})`,
    `**Prompt:** *${prompt}*`,
    '',
  ]

  if (contactSheetUrl) {
    lines.push(`![Contact Sheet Preview](${contactSheetUrl})`, '')
  }

  lines.push(
    '| Variant | Seed | CFG Scale | Artifact Path |',
    '| :---: | :---: | :---: | :--- |',
  )

  for (const v of variants) {
    lines.push(
      `| **${v.id}** | \`${v.seed}\` | \`${v.guidanceScale}\` | \`${v.path || v.url || '-'}\` |`,
    )
  }

  lines.push(
    '',
    `> **Tip:** To finalize any variant with higher resolution or edits, pass its seed (e.g. \`seed: ${variants[0]?.seed || 0}\`) to \`generate_image\`.`,
  )

  return lines.join('\n')
}

