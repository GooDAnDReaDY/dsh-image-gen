/**
 * @file lib/prompt-polisher.js
 * Curated artistic/photographic style presets, smart prompt enrichment, and palette harmonization (#457).
 */

import {
  CANONICAL_STYLE_PRESETS,
  CANONICAL_STYLE_PRESETS as CURATED_STYLES,
  normalizeStyleKey,
  STYLE_PRESETS,
  SUPPORTED_STYLE_PRESET_NAMES,
  resolveStylePreset,
  applyStylePreset,
} from './style-presets.js'

export {
  CANONICAL_STYLE_PRESETS,
  CURATED_STYLES,
  normalizeStyleKey,
  STYLE_PRESETS,
  SUPPORTED_STYLE_PRESET_NAMES,
  resolveStylePreset,
  applyStylePreset,
}

/**
 * Smart prompt enrichment: adds photographic & lighting cues if requested.
 */
export function enrichWithQualityCues(prompt, styleKey = null) {
  if (!prompt || typeof prompt !== 'string') return prompt
  let p = prompt.trim()
  const lower = p.toLowerCase()
  
  // Only append if not already containing lighting/detail tokens
  const hasLighting = lower.includes('lighting') || lower.includes('light') || lower.includes('illumination')
  const hasDetail = lower.includes('detailed') || lower.includes('highres') || lower.includes('sharp') || lower.includes('resolution')

  const additions = []
  if (!hasLighting) additions.push('balanced natural lighting')
  if (!hasDetail && styleKey !== 'minimalist_vector' && styleKey !== 'pixel_art') additions.push('high visual clarity')

  if (additions.length > 0) {
    p = p.endsWith('.') ? `${p} ${additions.join(', ')}.` : `${p}, ${additions.join(', ')}`
  }
  return p
}

/**
 * Polish and enrich a prompt with styles, auto-enhancements, and optional palette constraints.
 * 
 * @param {string} basePrompt 
 * @param {string|null} stylePreset 
 * @param {object} [options]
 * @param {boolean} [options.autoEnhance=false]
 * @param {string[]} [options.paletteColors=null]
 * @param {string} [options.existingNegative]
 * @param {number} [options.existingGuidance]
 * @returns {{ prompt: string, negativePrompt?: string, guidanceScale?: number, styleApplied?: string }}
 */
export function polishPrompt(basePrompt, stylePreset = null, {
  autoEnhance = false,
  paletteColors = null,
  existingNegative = '',
  existingGuidance = undefined,
} = {}) {
  let prompt = String(basePrompt || '').trim()
  let negative = existingNegative ? String(existingNegative).trim() : ''
  let guidance = existingGuidance
  let styleApplied = null

  const key = normalizeStyleKey(stylePreset)
  const preset = key ? CURATED_STYLES[key] : null

  if (preset) {
    styleApplied = preset.id
    if (preset.promptSuffix && !prompt.toLowerCase().includes(preset.promptSuffix.toLowerCase())) {
      prompt = prompt.endsWith('.') ? `${prompt} ${preset.promptSuffix}.` : `${prompt}, ${preset.promptSuffix}`
    }
    if (preset.negativePrompt) {
      negative = [negative, preset.negativePrompt].filter(Boolean).join(', ')
    }
    if (guidance === undefined && preset.guidanceScale !== undefined) {
      guidance = preset.guidanceScale
    }
  } else if (stylePreset && typeof stylePreset === 'string' && stylePreset.trim() && stylePreset !== 'none') {
    // Custom style suffix string
    const customSuffix = stylePreset.trim()
    if (!prompt.toLowerCase().includes(customSuffix.toLowerCase())) {
      prompt = `${prompt}, in ${customSuffix} style`
    }
  }

  // Auto-enhance prompt if toggled
  if (autoEnhance) {
    prompt = enrichWithQualityCues(prompt, styleApplied)
  }

  // Palette constraint injection
  if (Array.isArray(paletteColors) && paletteColors.length > 0) {
    const validHex = paletteColors
      .map(c => String(c).trim().toUpperCase())
      .filter(c => /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(c))
    
    if (validHex.length > 0) {
      const paletteDirective = `chromatic palette strictly dominated by ${validHex.join(', ')}, harmonious color grading`
      prompt = `${prompt}, ${paletteDirective}`
      const paletteNeg = 'clashing foreign colors, dissonant hues, out-of-palette tints'
      negative = [negative, paletteNeg].filter(Boolean).join(', ')
    }
  }

  return {
    prompt,
    negativePrompt: negative || undefined,
    guidanceScale: guidance,
    styleApplied: styleApplied || undefined,
  }
}
