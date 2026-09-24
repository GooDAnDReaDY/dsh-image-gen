// theme-pair-helpers.js — helper functions for generate_theme_pair (#189)

export const THEME_STYLES = [
  'minimalist',
  'isometric',
  'flat',
  '3d_render',
  'lineart',
  'cyberpunk',
  'claymorphism',
  'glassmorphism',
]

/**
 * Synthesizes prompt directives for light and dark theme variants.
 * @param {object} opts
 * @param {string} opts.prompt - Core user prompt
 * @param {string} [opts.style] - Aesthetic style
 * @param {number} [opts.darkContrastBoost=1.2] - Contrast boost multiplier for dark theme
 * @returns {{ lightPrompt: string, darkPrompt: string }}
 */
export function buildThemePairPrompts({ prompt, style, darkContrastBoost = 1.2 }) {
  const cleanPrompt = String(prompt || '').trim()
  const styleDirective = style ? `, in ${style} aesthetic style` : ''

  const lightDirectives = [
    'light mode color palette',
    'clean pure white background (#ffffff)',
    'soft ambient occlusion shadows',
    'balanced crisp natural daylight illumination',
    'subtle pastel secondary accents',
    'high daytime readability',
  ].join(', ')

  const contrastNotes = (darkContrastBoost && darkContrastBoost > 1.0)
    ? `enhanced ${Math.round(darkContrastBoost * 100)}% dynamic range highlights, luminous neon edge glow`
    : 'luminous subtle edge glow'

  const darkDirectives = [
    'dark mode color palette',
    'deep dark slate or obsidian background (#0f172a, #18181b)',
    contrastNotes,
    'vibrant high-contrast focal points',
    'sleek night UI aesthetics',
    'eye-comfort calibrated dark surface tones',
  ].join(', ')

  const lightPrompt = `${cleanPrompt}${styleDirective}, ${lightDirectives}`
  const darkPrompt = `${cleanPrompt}${styleDirective}, ${darkDirectives}`

  return { lightPrompt, darkPrompt }
}

/**
 * Builds responsive HTML/CSS snippets for adaptive theme switching.
 * @param {object} opts
 * @param {string} opts.lightSrc - Light image path or url
 * @param {string} opts.darkSrc - Dark image path or url
 * @param {string} [opts.alt] - Alt text
 * @returns {{ html: string, css: string }}
 */
export function buildThemePairSnippet({ lightSrc, darkSrc, alt = 'Theme adaptive graphic' }) {
  const html = `<picture class="dsh-theme-pair">
  <source srcset="${darkSrc}" media="(prefers-color-scheme: dark)">
  <img src="${lightSrc}" alt="${alt}" loading="lazy">
</picture>`

  const css = `/* CSS media-query & class-based dark theme switching */
.dsh-theme-pair img {
  max-width: 100%;
  height: auto;
  display: block;
  border-radius: 8px;
  transition: opacity 0.3s ease;
}

/* Optional manual class override: <body class="dark"> or <html class="dark"> */
:is(.dark, [data-theme="dark"]) .dsh-theme-pair img {
  content: url("${darkSrc}");
}`

  return { html, css }
}