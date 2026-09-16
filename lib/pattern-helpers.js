// Pure helpers for generate_seamless_pattern (#178)

export function buildSeamlessPrompt(motif, style, density) {
  const d = String(density || 'medium').toLowerCase()
  const densityHint = d === 'low'
    ? 'sparse motif spacing with generous empty background'
    : d === 'high'
      ? 'dense repeating motif coverage with minimal empty background'
      : 'balanced motif spacing'
  const styleBit = style ? ` Style: ${style}.` : ''
  return `Seamless tileable repeating pattern of ${motif}.${styleBit} `
    + 'Motifs must wrap continuously across left/right and top/bottom edges so the image tiles without visible seams. '
    + `Flat even lighting, orthographic top-down view, ${densityHint}. `
    + 'No vignette, no border frame, no watermark, no text.'
}

export function buildPatternCss({ className, sizePx, imagePath }) {
  const name = className || 'dsh-pattern'
  const size = sizePx || 512
  const url = imagePath || `./${name}.png`
  return `/* dsh-image-gen seamless pattern */
.${name} {
  background-image: url('${url}');
  background-repeat: repeat;
  background-size: ${size}px ${size}px;
}
`
}

export function normalizeDensity(value) {
  const v = String(value || 'medium').toLowerCase()
  if (v === 'low' || v === 'high') return v
  return 'medium'
}
