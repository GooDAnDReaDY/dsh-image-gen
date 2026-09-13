/**
 * @file lib/prompt-polisher.js
 * Curated artistic/photographic style presets, smart prompt enrichment, and palette harmonization.
 */

export const CURATED_STYLES = {
  cinematic: {
    id: 'cinematic',
    label: 'Cinematic Film',
    promptSuffix: 'cinematic 35mm film still, anamorphic lighting, shallow depth of field, color graded, photorealistic details',
    negativePrompt: 'cartoon, illustration, 3d render, oversaturated, blurry, distorted, amateur',
    guidanceScale: 6.5,
  },
  photorealistic: {
    id: 'photorealistic',
    label: 'Photorealistic Studio',
    promptSuffix: 'photorealistic portraiture, 85mm lens, natural studio lighting, micro-textures, 8k resolution, award-winning photography',
    negativePrompt: 'illustration, drawing, anime, 3d render, plastic skin, CGI, doll-like',
    guidanceScale: 7.0,
  },
  anime: {
    id: 'anime',
    label: 'Anime Masterpiece',
    promptSuffix: 'clean anime aesthetic, sharp clean lineart, vibrant cel shading, detailed background scenery, Makoto Shinkai style',
    negativePrompt: 'photorealistic, realistic photo, noisy, deformed, 3d model, lowres',
    guidanceScale: 7.0,
  },
  minimalist_vector: {
    id: 'minimalist_vector',
    label: 'Minimalist Vector',
    promptSuffix: 'minimalist vector art, clean sharp outlines, flat color fills, modern graphic design, Bauhaus aesthetics, SVG vector style',
    negativePrompt: 'photorealistic, heavy gradients, 3d render, noisy texture, clutter, photorealism',
    guidanceScale: 7.5,
  },
  isometric_3d: {
    id: 'isometric_3d',
    label: 'Isometric 3D',
    promptSuffix: 'isometric 3D render, ambient occlusion, miniature diorama, Octane render, smooth clay surface, soft global illumination',
    negativePrompt: 'flat, 2d, hand-drawn sketch, chaotic background, realistic photo',
    guidanceScale: 7.0,
  },
  analog_film: {
    id: 'analog_film',
    label: 'Analog 35mm Film',
    promptSuffix: 'vintage 35mm photograph, Kodak Portra 400 color science, authentic film grain, subtle halation, nostalgic muted tones',
    negativePrompt: 'digital CGI, harsh sharpening, plastic, 3d render, oversaturated digital look',
    guidanceScale: 6.5,
  },
  cyberpunk: {
    id: 'cyberpunk',
    label: 'Cyberpunk Neon',
    promptSuffix: 'cyberpunk aesthetic, high-tech dark city, neon volumetric lighting, rain-slicked reflective surfaces, moody atmosphere',
    negativePrompt: 'daylight, sunshine, pastoral, cartoon, pastel colors, washed out',
    guidanceScale: 7.5,
  },
  pixel_art: {
    id: 'pixel_art',
    label: '16-bit Retro Pixel Art',
    promptSuffix: '16-bit retro pixel art, crisp pixel grid, authentic dithered shading, nostalgic arcade palette, master pixel artwork',
    negativePrompt: 'smooth vector, 3d render, blurry, modern photography, anti-aliased gradients',
    guidanceScale: 8.0,
  },
  oil_painting: {
    id: 'oil_painting',
    label: 'Classical Oil Painting',
    promptSuffix: 'classical fine art oil painting, impasto brushstrokes, textured canvas, chiaroscuro lighting, museum masterpiece',
    negativePrompt: 'photograph, digital vector, 3d CGI, plastic, flat anime',
    guidanceScale: 7.0,
  },
  claymation: {
    id: 'claymation',
    label: 'Claymation Stop-Motion',
    promptSuffix: 'handcrafted claymation stop-motion aesthetic, tactile plasticine clay texture, studio macro softbox lighting, Aardman inspired',
    negativePrompt: 'digital CGI, flat vector, photographic humans, harsh synthetic gloss',
    guidanceScale: 7.5,
  },
}

/**
 * Normalizes a style identifier or alias into a canonical style key.
 */
export function normalizeStyleKey(key) {
  if (!key) return null
  const cleaned = String(key).trim().toLowerCase().replace(/[-\s]/g, '_')
  if (CURATED_STYLES[cleaned]) return cleaned
  // Alias mapping
  if (cleaned === 'isometric') return 'isometric_3d'
  if (cleaned === 'vector' || cleaned === 'minimalist') return 'minimalist_vector'
  if (cleaned === 'film' || cleaned === 'analog') return 'analog_film'
  if (cleaned === 'photo' || cleaned === 'realism') return 'photorealistic'
  return cleaned
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

export function listCuratedStyles() {
  return Object.values(CURATED_STYLES).map(s => ({
    id: s.id,
    label: s.label,
    guidanceScale: s.guidanceScale,
  }))
}
