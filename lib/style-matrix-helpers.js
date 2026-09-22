// style-matrix-helpers.js — Helpers for generate_style_matrix tool (#286).

export const DEFAULT_MATRIX_STYLES = [
  'editorial_photo',
  'flat_vector',
  'clay_3d',
  'cyberpunk',
]

export const MATRIX_PRESET_PROMPTS = {
  editorial_photo: 'editorial magazine photograph, 35mm film, soft diffused cinematic lighting, award-winning shot, ultra-detailed',
  flat_vector: 'minimal flat vector art, clean sharp lines, bold solid colors, geometric modern graphic illustration',
  clay_3d: 'charming 3D claymation plasticine sculpt, handcrafted clay texture, stop-motion animation aesthetic, miniature depth of field',
  cyberpunk: 'gritty cyberpunk scene, neon reflections, rain-slicked chrome, dark synthwave palette, high-tech dystopian atmosphere',
  cinematic: 'cinematic still frame, 70mm Panavision anamorphic lens, dramatic moody lighting, atmospheric haze',
  anime: 'vibrant modern anime keyframe, Makoto Shinkai aesthetic, luminous skies, crisp cel shading',
  isometric_3d: 'isometric 3D diorama render, Blender 3D, orthographic perspective, cute stylized textures',
  analog_film: 'vintage 1970s Kodachrome analog film print, authentic grain, faded warm tones, nostalgic vignette',
}

/**
 * Normalizes input styles into exactly 4 distinct style strings.
 *
 * @param {string[]|undefined} inputStyles
 * @returns {string[]}
 */
export function normalizeMatrixStyles(inputStyles) {
  const result = []
  if (Array.isArray(inputStyles)) {
    for (const s of inputStyles) {
      if (typeof s === 'string' && s.trim()) {
        const clean = s.trim().toLowerCase()
        if (!result.includes(clean)) result.push(clean)
      }
      if (result.length === 4) break
    }
  }

  // Backfill up to 4 using defaults
  for (const def of DEFAULT_MATRIX_STYLES) {
    if (result.length >= 4) break
    if (!result.includes(def)) result.push(def)
  }

  return result.slice(0, 4)
}

/**
 * Builds the full prompt for a matrix quadrant cell.
 *
 * @param {string} basePrompt
 * @param {string} styleName
 * @returns {string}
 */
export function buildMatrixCellPrompt(basePrompt, styleName) {
  const cleanBase = String(basePrompt || '').trim()
  const presetDirective = MATRIX_PRESET_PROMPTS[styleName] || (styleName + ' style, aesthetic rendering')
  return cleanBase + ', ' + presetDirective
}

/**
 * Formats a 2x2 markdown presentation grid for chat models.
 *
 * @param {object} params
 * @param {string} params.basePrompt
 * @param {boolean} params.blindMode
 * @param {Array<{id: string, style: string, path: string, url: string, seed: number}>} params.cells
 * @returns {string}
 */
export function formatMatrixMarkdown({ basePrompt, blindMode, cells }) {
  const lines = [
    '### Style Matrix (2×2 Benchmark): "' + basePrompt + '"',
    blindMode ? '_Blind Comparison Mode: styles masked until evaluated_' : '',
    '',
    '| Cell | Style Preset | Seed | Path |',
    '| :---: | :--- | :---: | :--- |',
  ]

  for (const c of cells) {
    const styleLabel = blindMode ? ('Option ' + c.id) : ('**' + c.style + '**')
    lines.push('| **' + c.id + '** | ' + styleLabel + ' | `' + c.seed + '` | `' + c.path + '` |')
  }

  return lines.filter(Boolean).join('\n')
}
