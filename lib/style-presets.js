/**
 * @file lib/style-presets.js
 * Curated aesthetic style presets, engine modifiers, and prompt enrichment (#457).
 */

export const CANONICAL_STYLE_PRESETS = {
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
  isometric_3d: {
    id: 'isometric_3d',
    label: 'Isometric 3D',
    promptSuffix: 'isometric 3D render, ambient occlusion, miniature diorama, Octane render, smooth clay surface, soft global illumination',
    negativePrompt: 'flat, 2d, hand-drawn sketch, chaotic background, realistic photo',
    guidanceScale: 7.0,
  },
  pixel_art: {
    id: 'pixel_art',
    label: '16-bit Retro Pixel Art',
    promptSuffix: '16-bit retro pixel art, crisp pixel grid, authentic dithered shading, nostalgic arcade palette, master pixel artwork',
    negativePrompt: 'smooth vector, 3d render, blurry, modern photography, anti-aliased gradients',
    guidanceScale: 8.0,
  },
  cinematic: {
    id: 'cinematic',
    label: 'Cinematic Film',
    promptSuffix: 'cinematic film still, cinematic 35mm film still, dramatic lighting, highly detailed',
    negativePrompt: 'cartoon, illustration, 3d render, oversaturated, blurry, distorted, amateur',
    guidanceScale: 6.5,
  },
  minimalist_vector: {
    id: 'minimalist_vector',
    label: 'Minimalist Vector',
    promptSuffix: 'minimalist vector art, clean sharp outlines, flat color fills, modern graphic design, Bauhaus aesthetics, SVG vector style',
    negativePrompt: 'photorealistic, heavy gradients, 3d render, noisy texture, clutter, photorealism',
    guidanceScale: 7.5,
  },
  claymation: {
    id: 'claymation',
    label: 'Claymation Stop-Motion',
    promptSuffix: 'handcrafted claymation stop-motion aesthetic, tactile plasticine clay texture, studio macro softbox lighting, Aardman inspired',
    negativePrompt: 'digital CGI, flat vector, photographic humans, harsh synthetic gloss',
    guidanceScale: 7.5,
  },
  cyberpunk: {
    id: 'cyberpunk',
    label: 'Cyberpunk Neon',
    promptSuffix: 'cyberpunk aesthetic, high-tech dark city, neon volumetric lighting, rain-slicked reflective surfaces, moody atmosphere',
    negativePrompt: 'daylight, sunshine, pastoral, cartoon, pastel colors, washed out',
    guidanceScale: 7.5,
  },
  analog_film: {
    id: 'analog_film',
    label: 'Analog 35mm Film',
    promptSuffix: 'vintage 35mm photograph, Kodak Portra 400 color science, authentic film grain, subtle halation, nostalgic muted tones',
    negativePrompt: 'digital CGI, harsh sharpening, plastic, 3d render, oversaturated digital look',
    guidanceScale: 6.5,
  },
  oil_painting: {
    id: 'oil_painting',
    label: 'Classical Oil Painting',
    promptSuffix: 'classical fine art oil painting, impasto brushstrokes, textured canvas, chiaroscuro lighting, museum masterpiece',
    negativePrompt: 'photograph, digital vector, 3d CGI, plastic, flat anime',
    guidanceScale: 7.0,
  },
}

export const SUPPORTED_STYLE_PRESET_NAMES = Object.keys(CANONICAL_STYLE_PRESETS)

const ALIAS_MAP = {
  isometric: 'isometric_3d',
  vector: 'minimalist_vector',
  minimalist: 'minimalist_vector',
  film: 'analog_film',
  analog: 'analog_film',
  photo: 'photorealistic',
  realism: 'photorealistic',
  clay: 'claymation',
  pixel: 'pixel_art',
  oil: 'oil_painting',
}

/**
 * Normalizes a style identifier or alias into a canonical style key.
 *
 * @param {string} key
 * @returns {string|null}
 */
export function normalizeStyleKey(key) {
  if (!key) return null
  const cleaned = String(key).trim().toLowerCase().replace(/[-\s]/g, '_')
  if (CANONICAL_STYLE_PRESETS[cleaned]) return cleaned
  if (ALIAS_MAP[cleaned]) return ALIAS_MAP[cleaned]
  return cleaned
}

/** Complete dictionary with canonical keys and convenience aliases */
export const STYLE_PRESETS = {
  ...CANONICAL_STYLE_PRESETS,
  isometric: CANONICAL_STYLE_PRESETS.isometric_3d,
  vector: CANONICAL_STYLE_PRESETS.minimalist_vector,
  minimalist: CANONICAL_STYLE_PRESETS.minimalist_vector,
  film: CANONICAL_STYLE_PRESETS.analog_film,
  analog: CANONICAL_STYLE_PRESETS.analog_film,
  photo: CANONICAL_STYLE_PRESETS.photorealistic,
  realism: CANONICAL_STYLE_PRESETS.photorealistic,
  clay: CANONICAL_STYLE_PRESETS.claymation,
  pixel: CANONICAL_STYLE_PRESETS.pixel_art,
  oil: CANONICAL_STYLE_PRESETS.oil_painting,
}

/**
 * Resolves style preset key and returns prompt modifier, combined negative prompt, and recommended guidance scale.
 *
 * @param {string} styleKeyOrText
 * @param {string} [existingNegative]
 * @param {number} [existingGuidance]
 * @returns {{ promptSuffix: string, negativePrompt?: string, guidanceScale?: number, presetName?: string }}
 */
export function resolveStylePreset(styleKeyOrText, existingNegative, existingGuidance) {
  if (!styleKeyOrText) {
    return { promptSuffix: '', negativePrompt: existingNegative, guidanceScale: existingGuidance }
  }
  const raw = String(styleKeyOrText).trim()
  if (!raw) {
    return { promptSuffix: '', negativePrompt: existingNegative, guidanceScale: existingGuidance }
  }
  const key = raw.toLowerCase().replace(/[-\s]/g, '_')
  if (key === 'none' || key === 'default' || key === 'off') {
    return { promptSuffix: '', negativePrompt: existingNegative, guidanceScale: existingGuidance }
  }
  const canonicalKey = normalizeStyleKey(key) || key
  const preset = STYLE_PRESETS[canonicalKey] || STYLE_PRESETS[key]
  if (preset && typeof preset === 'object') {
    const negParts = []
    if (existingNegative && typeof existingNegative === 'string' && existingNegative.trim()) {
      negParts.push(existingNegative.trim())
    }
    if (preset.negativePrompt && typeof preset.negativePrompt === 'string') {
      const existingTerms = new Set((existingNegative || '').toLowerCase().split(/[,;\n]+/).map(s => s.trim()).filter(Boolean))
      const presetTerms = preset.negativePrompt.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)
      const freshPresetTerms = presetTerms.filter(t => !existingTerms.has(t.toLowerCase()))
      if (freshPresetTerms.length > 0) {
        negParts.push(freshPresetTerms.join(', '))
      }
    }
    const combinedNeg = negParts.join(', ')
    return {
      promptSuffix: preset.promptSuffix,
      negativePrompt: combinedNeg || undefined,
      guidanceScale: existingGuidance ?? preset.guidanceScale,
      presetName: preset.id || canonicalKey,
    }
  }
  return {
    promptSuffix: typeof preset === 'string' ? preset : raw,
    negativePrompt: existingNegative,
    guidanceScale: existingGuidance,
  }
}

/**
 * Applies style preset to a base prompt string.
 *
 * @param {string} prompt
 * @param {string} styleKeyOrText
 * @returns {string}
 */
export function applyStylePreset(prompt, styleKeyOrText) {
  if (!styleKeyOrText) return prompt
  const res = resolveStylePreset(styleKeyOrText)
  return res.promptSuffix ? `${prompt}, ${res.promptSuffix}` : prompt
}
