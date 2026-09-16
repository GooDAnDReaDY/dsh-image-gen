// Pure helpers for generate_responsive_mockups (#173) — no cordis imports.

export const DEVICE_ORDER = ['mobile', 'tablet', 'desktop']

export const DEVICE_PRESETS = {
  mobile: {
    id: 'mobile',
    label: 'Mobile',
    aspect: '9:16',
    size: 'portrait_16_9',
    fileStem: 'mockup-mobile',
    viewport: 'iPhone-class mobile viewport 375×812, portrait 9:16',
    layoutHint:
      'Single-column mobile UI mockup: compact header, stacked content, thumb-reachable bottom actions. '
      + 'Preserve the same product, brand colors, typography family and visual language as the desktop and tablet versions.',
  },
  tablet: {
    id: 'tablet',
    label: 'Tablet',
    aspect: '3:4',
    size: 'portrait_4_3',
    fileStem: 'mockup-tablet',
    viewport: 'iPad-class tablet viewport 768×1024, portrait 3:4',
    layoutHint:
      'Tablet UI mockup with two-column or wide single-column layout, roomier spacing than mobile, '
      + 'same product screens, brand colors, and component language as mobile and desktop versions.',
  },
  desktop: {
    id: 'desktop',
    label: 'Desktop',
    aspect: '16:9',
    size: 'landscape_16_9',
    fileStem: 'mockup-desktop',
    viewport: 'desktop viewport 1440×900 / 1920×1080, landscape 16:10–16:9',
    layoutHint:
      'Desktop UI mockup with multi-column layout, full navigation chrome and wide content area. '
      + 'Same product, brand palette and component language as mobile and tablet versions.',
  },
}

export function normalizeDevices(input) {
  if (input == null) return [...DEVICE_ORDER]
  const list = Array.isArray(input) ? input : [input]
  const cleaned = list
    .map((d) => String(d || '').trim().toLowerCase())
    .filter((d) => DEVICE_ORDER.includes(d))
  const unique = []
  for (const d of cleaned) {
    if (!unique.includes(d)) unique.push(d)
  }
  return unique.length ? unique : [...DEVICE_ORDER]
}

export function resolveDevicePreset(device) {
  return DEVICE_PRESETS[String(device || '').toLowerCase()] || DEVICE_PRESETS.mobile
}

/**
 * Build a shared semantic base prompt so the three viewports stay visually coherent.
 * Device-specific lines only restate composition constraints, not the product idea.
 */
export function buildResponsivePrompt(basePrompt, { device, stylePreset, paletteColors } = {}) {
  const preset = resolveDevicePreset(device)
  const core = String(basePrompt || '').trim()
  const style = stylePreset ? ` Style preset: ${stylePreset}.` : ''
  const palette = Array.isArray(paletteColors) && paletteColors.length
    ? ` Dominant brand colors must remain consistent across all responsive mockups: ${paletteColors.join(', ')}.`
    : ''
  return `Responsive UI product mockup of: ${core}.${style}${palette} `
    + `Render as a polished ${preset.viewport}. ${preset.layoutHint} `
    + 'Keep the same information architecture, iconography language, spacing rhythm and color palette across mobile, tablet and desktop variants. '
    + 'High-fidelity interface design, clean UI, realistic device framing only if needed, no lorem-ipsum walls of unreadable text, no watermark.'
}

export function mockupFileName(device, { outputName } = {}) {
  const preset = resolveDevicePreset(device)
  const stem = String(outputName || '').trim()
    ? String(outputName).trim().replace(/\.(png|jpe?g|webp)$/i, '')
    : preset.fileStem
  // Issue requires mockup-mobile.png style names when default stem is used.
  if (!outputName) return `${preset.fileStem}.png`
  return `${stem}-${preset.id}.png`
}

export function deviceMeta(device) {
  const preset = resolveDevicePreset(device)
  return {
    device: preset.id,
    label: preset.label,
    aspect: preset.aspect,
    size: preset.size,
    viewport: preset.viewport,
  }
}
