// ui-asset-helpers.js — Helper constants and prompt builder for generate_ui_asset (#284).

export const UI_ASSET_TYPES = ['icon', 'illustration', 'badge', 'sticker', 'hero_banner']
export const LAYOUT_COMPOSITIONS = ['isolated', 'left_empty', 'right_empty', 'top_empty', 'center_empty']
export const COLOR_MODES = ['flat', 'monochrome', 'duotone', 'full_color']

/**
 * Augments the user's prompt with specialized UI design directives and negative space constraints.
 */
export function buildUiAssetPrompt({
  prompt,
  asset_type = 'icon',
  layout_composition = 'isolated',
  color_mode = 'flat',
}) {
  const typeMap = {
    icon: 'crisp minimalist app icon, vector iconographic style, sharp contours, modern UI asset',
    illustration: 'digital editorial tech illustration, modern flat vector scene, web app asset',
    badge: 'gamified badge emblem, achievement icon, metallic and enamel accents, clean vector badge',
    sticker: 'die-cut vector sticker graphic, bold clean outlines, crisp edges, sticker asset',
    hero_banner: 'marketing website hero illustration, modern corporate SaaS graphic',
  }

  const layoutMap = {
    isolated: 'centered single subject, solid plain white background, generous empty padding on all sides, clean isolation',
    left_empty: 'subject placed strictly on the right half, left 60% entirely empty negative space copy space for headlines and UI text with plain flat background',
    right_empty: 'subject placed strictly on the left half, right 60% entirely empty negative space copy space for headlines and UI text with plain flat background',
    top_empty: 'subject anchored at bottom edge, upper 60% completely empty negative space copy space for banner typography',
    center_empty: 'composition framed around outer borders and corners, center area completely empty negative space for search bar or central logo',
  }

  const colorMap = {
    flat: 'flat vector colors, clean solid fills, no photorealism, no noisy textures',
    monochrome: 'monochromatic single-color palette, high contrast minimal style',
    duotone: 'two-tone duotone aesthetic, sharp complementary contrast',
    full_color: 'vibrant modern UI color scheme, harmonious hex accents',
  }

  const baseType = typeMap[asset_type] || typeMap.icon
  const layout = layoutMap[layout_composition] || layoutMap.isolated
  const color = colorMap[color_mode] || colorMap.flat

  return `${String(prompt || '').trim()}, ${baseType}, ${layout}, ${color}`
}
