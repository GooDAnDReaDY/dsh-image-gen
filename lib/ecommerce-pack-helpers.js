// @ts-check
// ecommerce-pack-helpers.js — E-commerce multi-asset photography suite builder (#527).

/**
 * @typedef {Object} EcommerceShotConfig
 * @property {'hero' | 'lifestyle' | 'macro' | 'banner'} type
 * @property {string} label
 * @property {string} prompt
 * @property {string} negativePrompt
 * @property {'1:1' | '4:3' | '16:9'} aspectRatio
 * @property {'square_hd' | 'landscape_4_3' | 'landscape_16_9'} size
 * @property {string} purpose
 */

/**
 * Default lifestyle settings per category for realistic environment mapping.
 */
export const CATEGORY_LIFESTYLE_DEFAULTS = {
  electronics: 'modern minimalist work desk with walnut monitor riser, gentle soft morning sunlight, muted bokeh',
  fashion: 'sunlit airy boutique atelier with raw linen draping and warm architectural concrete background',
  cosmetics: 'luxurious pale rose marble vanity bathroom counter with gentle water droplets and soft diffused spa lighting',
  furniture: 'scandinavian open-plan living room with light oak flooring, potted ficus plant, and warm ambient window light',
  food: 'rustic slate kitchen island with fresh culinary ingredients, brass accents, and rich chiaroscuro daylight',
  beverage: 'sun-drenched outdoor patio table with condensation drops, frosted glass reflections, and lush green garden blur',
  general: 'clean contemporary lifestyle interior with warm organic textures and soft diffused daylight',
}

/**
 * Builds 4 specialized commercial shot prompts from product reference description.
 *
 * @param {object} params
 * @param {string} params.productDescription Base product description or extracted visual subject
 * @param {string} [params.category] Product category (electronics, fashion, cosmetics, furniture, etc.)
 * @param {string} [params.brandName] Optional brand name to incorporate into packaging
 * @param {string} [params.lifestyleSetting] Custom lifestyle setting override
 * @param {string} [params.materialHints] Inferred or explicit material textures
 * @returns {EcommerceShotConfig[]}
 */
export function buildEcommerceShotPrompts({
  productDescription,
  category = 'general',
  brandName,
  lifestyleSetting,
  materialHints = '',
}) {
  const product = (productDescription || 'premium commercial product').trim()
  const cat = (category || 'general').toLowerCase()
  const defaultSetting = CATEGORY_LIFESTYLE_DEFAULTS[cat] || CATEGORY_LIFESTYLE_DEFAULTS.general
  const setting = (lifestyleSetting || defaultSetting).trim()
  const brandDirective = brandName ? `with refined subtle "${brandName}" branding, ` : ''
  const materials = materialHints ? `, highlighting authentic ${materialHints}` : ''

  const baseNegative =
    'blurry, low quality, distorted proportions, deformed geometry, clutter, artifacts, oversaturated, amateur lighting, harsh shadows'

  return [
    {
      type: 'hero',
      label: 'Catalog Hero Shot',
      purpose: 'Studio catalog hero against pure seamless white background',
      aspectRatio: '1:1',
      size: 'square_hd',
      prompt: `commercial studio product photography of ${product}, ${brandDirective}isolated on seamless pure white background #ffffff, calibrated subtle soft contact shadow beneath product, clean three-point commercial studio lighting, 8k resolution, razor-sharp edge definition${materials}, award-winning e-commerce catalog visual`,
      negativePrompt: `${baseNegative}, busy background, colorful background, harsh black shadows, outdoor setting`,
    },
    {
      type: 'lifestyle',
      label: 'Lifestyle In-Situ Shot',
      purpose: 'Product situated naturally in contextual domestic/professional interior',
      aspectRatio: '4:3',
      size: 'landscape_4_3',
      prompt: `editorial advertising lifestyle photography of ${product}, ${brandDirective}naturally arranged in ${setting}, warm soft directional window daylight, shallow depth of field with 50mm prime lens, authentic contextual environment, architectural digest magazine style${materials}`,
      negativePrompt: `${baseNegative}, plain white background, floating object, unrealistic placement`,
    },
    {
      type: 'macro',
      label: 'Macro Detail Shot',
      purpose: 'Close-up tactile texture and craftsmanship inspection',
      aspectRatio: '1:1',
      size: 'square_hd',
      prompt: `extreme macro photography close-up detail shot of ${product}, ${brandDirective}focusing on exquisite craftsmanship, tactile surface texture, micro-details and precision manufacturing${materials}, 100mm macro f/2.8 lens, tack-sharp focal plane with creamy smooth falloff, pristine specular highlights`,
      negativePrompt: `${baseNegative}, distant shot, wide angle view, low resolution texture`,
    },
    {
      type: 'banner',
      label: 'Marketing Banner Shot',
      purpose: 'Wide 16:9 promotional hero banner with calibrated negative space for copy',
      aspectRatio: '16:9',
      size: 'landscape_16_9',
      prompt: `widescreen 16:9 promotional hero banner for ${product}, ${brandDirective}artfully composed on the right third of the frame, deliberate generous clean negative empty space on the left for marketing typography, sophisticated commercial background with gentle color gradient, premium brand advertising aesthetic${materials}`,
      negativePrompt: `${baseNegative}, centered subject, cluttered composition, no space for text`,
    },
  ]
}

/**
 * Formats Markdown presentation for generated e-commerce package.
 *
 * @param {object} params
 * @param {string} params.category
 * @param {string} [params.brandName]
 * @param {Array<{ type: string, label: string, path?: string, attachmentId?: string, ratio: string, prompt: string }>} params.shots
 * @param {string} [params.summary]
 * @returns {string}
 */
export function formatEcommercePackMarkdown({ category, brandName, shots, summary }) {
  const brandHeader = brandName ? ` for **${brandName}**` : ''
  const lines = [
    `### 🛍️ E-Commerce Photography Suite${brandHeader} (${category})`,
    ``,
    summary ? `${summary}
` : '',
    `| Shot Type | Preview | Aspect Ratio | Target Asset |`,
    `| :--- | :---: | :---: | :--- |`,
  ]

  for (const shot of shots) {
    const preview = shot.path ? `![${shot.label}](${shot.path})` : '*(Generated)*'
    const link = shot.path ? `\`${shot.path}\`` : shot.attachmentId ? `Attachment \`${shot.attachmentId}\`` : '—'
    lines.push(`| **${shot.label}** | ${preview} | \`${shot.ratio}\` | ${link} |`)
  }

  lines.push(
    ``,
    `#### 📦 Suite Specifications`,
    `- **Total Visual Assets:** ${shots.length} cohesive variations (Hero, Lifestyle, Macro, Banner)`,
    `- **Product Category:** \`${category}\``,
    brandName ? `- **Brand Alignment:** \`${brandName}\`` : '',
    `- **Commercial Readiness:** Calibrated for Shopify, Amazon, and omni-channel campaigns.`,
  )

  return lines.filter(Boolean).join('\n')
}
