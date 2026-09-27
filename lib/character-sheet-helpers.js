// character-sheet-helpers.js — helper functions for character_sheet_generator tool (#181).

export const CHARACTER_SHEET_LAYOUTS = {
  turnaround: {
    name: 'turnaround',
    label: 'Full Turnaround (4-view horizontal)',
    aspectRatio: '16:9',
    views: ['front view', 'side profile view', 'three-quarter view', 'back view'],
    directive: 'full character turnaround sheet showing multiple sequential angles: front view, side profile view, three-quarter view, and back view arranged horizontally',
  },
  '1x3': {
    name: '1x3',
    label: 'Triptych (Front, Side, Back)',
    aspectRatio: '16:9',
    views: ['front view', 'side view', 'back view'],
    directive: 'character model sheet with 3 full-body views: front view, side view, back view side-by-side',
  },
  '2x2': {
    name: '2x2',
    label: 'Quad Grid (2x2 Multi-Angle)',
    aspectRatio: '1:1',
    views: ['front view', 'three-quarter view', 'close-up portrait', 'back view'],
    directive: '2x2 character reference sheet grid featuring: top-left front view, top-right three-quarter view, bottom-left close-up facial portrait, bottom-right back view',
  },
  emotions: {
    name: 'emotions',
    label: 'Facial Expression Sheet (4 Expressions)',
    aspectRatio: '1:1',
    views: ['neutral', 'happy / smiling', 'focused / intense', 'shocked / surprised'],
    directive: 'character facial expression sheet displaying identical character with 4 distinct expressions: neutral, happy/smiling, focused/intense, and surprised',
  },
}

export const CHARACTER_SHEET_STYLES = {
  concept_art: {
    name: 'concept_art',
    label: 'Digital Concept Art',
    directive: 'digital concept art, character model sheet, clean sharp silhouette, production reference, ArtStation featured',
  },
  anime: {
    name: 'anime',
    label: 'Anime & Manga',
    directive: 'clean modern anime production sheet, precise lineart, cel-shaded coloring, animation design document',
  },
  '3d_animation': {
    name: '3d_animation',
    label: '3D Feature Film CGI',
    directive: '3D animated feature film character model, subsurface scattering, Octane render, Pixar/Dreamworks aesthetic, cinematic lighting',
  },
  pixel_art: {
    name: 'pixel_art',
    label: '16-bit Pixel Art',
    directive: 'crisp 16-bit pixel art character design sheet, game asset sprite reference, clean pixel clusters, retro aesthetic',
  },
  realistic: {
    name: 'realistic',
    label: 'Cinematic Photorealism',
    directive: 'cinematic studio photography, detailed skin texture, 85mm lens, neutral gray studio backdrop, master lighting',
  },
  comic: {
    name: 'comic',
    label: 'Graphic Novel / Comic',
    directive: 'graphic novel art style, dynamic ink lines, bold cross-hatching, rich comic book color palette',
  },
}

/**
 * Builds the specialized prompt for generating consistent character sheets.
 *
 * @param {object} options
 * @param {string} options.prompt Base character description
 * @param {string} [options.layout] 'turnaround' | '1x3' | '2x2' | 'emotions'
 * @param {string} [options.style] Style preset key
 * @param {string} [options.negativePrompt] Optional negative directives
 * @returns {{ prompt: string, negativePrompt: string, aspectRatio: string, views: string[] }}
 */
export function buildCharacterSheetPrompt(options = {}) {
  const baseDesc = String(options.prompt || '').trim()
  if (!baseDesc) {
    throw new Error('Character description prompt is required for character sheet generation')
  }

  const layoutKey = options.layout && CHARACTER_SHEET_LAYOUTS[options.layout]
    ? options.layout
    : 'turnaround'
  const layoutDef = CHARACTER_SHEET_LAYOUTS[layoutKey]

  const styleKey = options.style && CHARACTER_SHEET_STYLES[options.style]
    ? options.style
    : 'concept_art'
  const styleDef = CHARACTER_SHEET_STYLES[styleKey]

  const consistencyAnchor = 'single unified character sheet, identical person across all angles, same facial features, same hairstyle, identical outfit and colors, consistent proportions, neutral neutral background'

  const finalPrompt = [
    layoutDef.directive,
    `Character: ${baseDesc}`,
    styleDef.directive,
    consistencyAnchor,
  ].filter(Boolean).join(', ')

  const defaultNegative = 'different characters, inconsistent face, mismatched clothing, cropped limbs, cluttered background, chaotic layout, watermark, low quality, distorted anatomy'
  const finalNegative = options.negativePrompt
    ? `${defaultNegative}, ${options.negativePrompt}`
    : defaultNegative

  return {
    prompt: finalPrompt,
    negativePrompt: finalNegative,
    aspectRatio: layoutDef.aspectRatio,
    views: layoutDef.views,
    layout: layoutKey,
    style: styleKey,
  }
}
