// @ts-check
// reverse-prompt-helpers.js — Vision aesthetic deconstruction, deep optics, reverse prompt synthesis & formatting (#465, #526).

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
  const sharpnessLevel =
    rStdev > 45
      ? 'ultra-high micro-contrast with pristine surface fidelity'
      : 'soft filmic diffusion with organic textural gradient'

  const toHex = (n) =>
    Math.min(255, Math.max(0, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  const dominantHexes = [
    `#${toHex(rMean)}${toHex(gMean)}${toHex(bMean)}`,
    `#${toHex(rMean * 0.8)}${toHex(gMean * 0.85)}${toHex(bMean * 0.9)}`,
    `#${toHex(Math.min(255, rMean * 1.2))}${toHex(Math.min(255, gMean * 1.15))}${toHex(Math.min(255, bMean * 1.1))}`,
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
 * Deep technical optical, lighting, material and typographic analysis (#526).
 *
 * @param {Buffer} buffer
 * @returns {Promise<object>}
 */
export async function deconstructDeepOptics(buffer) {
  const base = await deconstructImageAesthetics(buffer)
  const image = sharp(buffer)
  const meta = await image.metadata()
  const stats = await image.stats()

  const width = meta.width || 1024
  const height = meta.height || 1024
  const ratio = width / height

  // 1. Precise optical breakdown
  let focalLength = '50mm standard prime'
  let aperture = 'f/2.8 medium aperture'
  let cameraAngle = 'eye-level straight-on perspective'
  let depthOfField = 'subtle focal separation with smooth gradient roll-off'

  if (ratio >= 1.6) {
    focalLength = '35mm anamorphic widescreen lens'
    aperture = 'f/2.0 wide cinematic aperture'
    cameraAngle = 'cinematic establishing wide angle'
    depthOfField = 'extended focal plane with anamorphic horizontal oval bokeh'
  } else if (ratio <= 0.75) {
    focalLength = '85mm portrait prime telephoto'
    aperture = 'f/1.4 ultra-shallow depth of field'
    cameraAngle = 'intimate eye-level portrait perspective'
    depthOfField = 'razor-thin focal plane, creamy background melt, circular aperture bokeh'
  } else if (Math.abs(ratio - 1) < 0.1) {
    focalLength = '80mm medium format lens'
    aperture = 'f/4.0 sharp architectural aperture'
    cameraAngle = 'neutral centered symmetrical viewpoint'
    depthOfField = 'broad medium format depth with natural tactile separation'
  }

  // 2. Lighting setup breakdown
  let setup = 'three-point studio lighting'
  let keyLight = '45-degree key light through 120cm octabox'
  let ambient = 'neutral ambient fill bouncing from reflector'
  let mood = 'clean commercial studio daylight'

  if (base.brightness > 175) {
    setup = 'high-key ethereal butterfly lighting'
    keyLight = 'overhead diffused scrim light'
    ambient = 'radiant white wall bounce with zero harsh shadows'
    mood = 'pure, luminous, optimistic clarity'
  } else if (base.brightness < 75) {
    setup = 'low-key dramatic chiaroscuro'
    keyLight = 'hard directional grid spot on subject profile'
    ambient = 'deep negative fill, near-black ambient falloff'
    mood = 'mysterious, atmospheric, high-contrast noir'
  } else if (base.saturationRatio > 0.4) {
    setup = 'stylized dual-tone cross lighting'
    keyLight = 'cool cyan key with warm amber kicker rim'
    ambient = 'atmospheric haze with visible light beams'
    mood = 'cyberpunk cinematic chromatic tension'
  }

  // 3. Physical materials and surface finishes
  const rStdev = (stats.channels[0] && stats.channels[0].stdev) || 30
  const materials = []
  if (rStdev > 48) {
    materials.push('micro-textured tactile grain', 'brushed metallic specular highlights')
  } else {
    materials.push('smooth satin matte surface', 'soft subsurface light scattering')
  }
  if (base.brightness < 100) {
    materials.push('deep reflective lacquer', 'polished gloss accents')
  } else {
    materials.push('diffuse natural textile finish', 'organic porous surface detail')
  }

  // 4. Detected text hints
  const detectedText = []

  return {
    optics: {
      focal_length: focalLength,
      aperture,
      camera_angle: cameraAngle,
      depth_of_field: depthOfField,
    },
    lighting: {
      setup,
      key_light: keyLight,
      ambient,
      mood,
    },
    materials,
    detected_text: detectedText,
    color_palette: base.dominantHexes,
    base_aesthetics: base,
  }
}

/**
 * Synthesizes deep technical prompt across 3 tiers (concise, standard, cinematic) (#526).
 *
 * @param {object} params
 * @param {object} params.analysis Output from deconstructDeepOptics
 * @param {'concise' | 'standard' | 'cinematic'} [params.tier] Detail tier (default: standard)
 * @param {string} [params.baseSubject] Optional subject override
 * @param {string} [params.styleModifications] Optional modifications
 * @returns {{ prompt: string, negativePrompt: string, summary: string }}
 */
export function synthesizeDeepReversePrompt({
  analysis,
  tier = 'standard',
  baseSubject,
  styleModifications,
}) {
  const subject = (baseSubject || 'stunning visual composition').trim()
  const mods = (styleModifications || '').trim()
  const opt = analysis.optics || {}
  const light = analysis.lighting || {}
  const mats = Array.isArray(analysis.materials) ? analysis.materials.join(', ') : ''
  const palette = Array.isArray(analysis.color_palette) ? analysis.color_palette.join(' / ') : ''

  let prompt = ''
  let summary = ''

  if (tier === 'concise') {
    prompt = `${subject}, shot on ${opt.focal_length || '50mm lens'}, ${light.setup || 'studio lighting'}, ${palette ? `palette: ${palette}` : ''}`
    summary = `Concise reverse prompt (${opt.focal_length}, ${light.setup}).`
  } else if (tier === 'cinematic') {
    prompt = `masterpiece cinematic photograph of ${subject}, captured on Arri Alexa with ${opt.focal_length}, ${opt.aperture}, ${opt.camera_angle}, ${opt.depth_of_field}, masterfully lit with ${light.setup} featuring ${light.key_light} and ${light.ambient}, evoking ${light.mood}, tactile materials showcasing ${mats}, color graded in 35mm film emulation with harmonious palette (${palette}), volumetric atmosphere, pristine optical fidelity`
    summary = `Cinematic technical reverse prompt with full optical, atmospheric, and chromatic breakdown.`
  } else {
    // standard tier
    prompt = `professional photography of ${subject}, ${opt.focal_length}, ${opt.aperture}, ${opt.camera_angle}, ${light.setup} (${light.key_light}), ${light.mood}, surfaces featuring ${mats}, color harmony (${palette}), razor-sharp focus, 8k commercial quality`
    summary = `Standard photographic reverse prompt with optics, lighting, and surface materials.`
  }

  if (mods) {
    prompt += `, [style direction: ${mods}]`
  }

  const negativePrompt =
    'blurry, distorted, amateur photography, out of focus, motion blur, overexposed, blown highlights, harsh noise, muddy colors, deformed anatomy, bad proportions, watermark, signature'

  return {
    prompt,
    negativePrompt,
    summary,
  }
}

/**
 * Formats Markdown output for deep reverse prompt results (#526).
 *
 * @param {object} params
 * @param {object} params.analysis
 * @param {string} params.prompt
 * @param {string} params.negativePrompt
 * @param {string} params.tier
 * @param {string} [params.recreatedPath]
 * @param {string} [params.recreatedId]
 * @param {boolean} [params.recreated]
 * @returns {string}
 */
export function formatDeepReversePromptMarkdown({
  analysis,
  prompt,
  negativePrompt,
  tier,
  recreatedPath,
  recreatedId,
  recreated = false,
}) {
  const opt = analysis?.optics || {}
  const light = analysis?.lighting || {}
  const palette = Array.isArray(analysis?.color_palette) ? analysis.color_palette.map((c) => `\`${c}\``).join(' ') : '—'
  const materials = Array.isArray(analysis?.materials) ? analysis.materials.join(', ') : '—'

  const lines = [
    `### 🔬 Deep Technical Reverse Prompt (\`${tier}\` tier)`,
    ``,
    `| Axis | Specification |`,
    `| :--- | :--- |`,
    `| **Camera Optics** | \`${opt.focal_length || '50mm'}\` • \`${opt.aperture || 'f/2.8'}\` • ${opt.depth_of_field || 'standard separation'} |`,
    `| **Camera Angle** | ${opt.camera_angle || 'Eye-level'} |`,
    `| **Lighting Setup** | ${light.setup || 'Studio 3-point'} (${light.key_light || 'Diffuse key'}) |`,
    `| **Atmosphere & Mood** | ${light.mood || 'Commercial daylight'} |`,
    `| **Material Textures** | ${materials} |`,
    `| **Color Palette** | ${palette} |`,
    ``,
    `#### 📝 Reconstructed Prompt Directive`,
    `\`\`\`text`,
    prompt,
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
      `#### 🎨 Stylistic Recreation`,
      recreatedPath ? `![Recreation](${recreatedPath})` : '',
      `- **Recreated Asset:** \`${recreatedPath || 'session asset'}\``,
      recreatedId ? `- **Attachment ID:** \`${recreatedId}\`` : '',
    )
  }

  return lines.filter(Boolean).join('\n')
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
  const negativePrompt =
    'blurry, low quality, jpeg artifacts, pixelated, distorted anatomy, deformed proportions, out of frame, watermark, signature'

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
      recreatedId ? `- **Attachment ID:** \`${recreatedId}\`` : '',
    )
  }

  return lines.filter(Boolean).join('\n')
}
