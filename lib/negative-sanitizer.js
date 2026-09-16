// lib/negative-sanitizer.js
// Negative prompt sanitizer & smart enhancer for diffusion models (#165)

/**
 * Standard defect keywords grouped by category.
 */
export const DEFAULT_DEFECT_TERMS = [
  'blurry',
  'low quality',
  'worst quality',
  'deformed',
  'disfigured',
  'bad anatomy',
  'extra limbs',
  'missing limbs',
  'poorly drawn face',
  'poorly drawn hands',
  'missing fingers',
  'extra fingers',
  'watermark',
  'signature',
  'jpeg artifacts',
]

/**
 * Models that explicitly benefit from negative prompts (SD 1.5, SD 2.x, SDXL, ComfyUI, etc.).
 * FLUX, DALL-E, and Ideogram generally ignore or misinterpret negative prompts.
 */
export function supportsNegativePrompt(provider, model) {
  const p = String(provider || '').toLowerCase()
  const m = String(model || '').toLowerCase()

  if (p === 'fal' && (m.includes('flux') || m.includes('recraft'))) return false
  if (p === 'codex' || p === 'openai' || m.includes('dall-e') || m.includes('gpt-image')) return false
  if (p === 'grok' || m.includes('aurora')) return false

  // Diffusion / Comfy / A1111 / SDXL / Seedream / Replicate (SD variants)
  if (p === 'local' || p === 'seedream') return true
  if (m.includes('stable-diffusion') || m.includes('sdxl') || m.includes('sd-') || m.includes('illustrious') || m.includes('pony')) return true
  if (p === 'custom' && (m.includes('sd') || m.includes('diffusion'))) return true

  return false
}

/**
 * Clean and split prompt into normalized lowercase terms.
 */
export function splitTerms(promptStr) {
  if (!promptStr || typeof promptStr !== 'string') return []
  return promptStr
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function normalizeWord(word) {
  if (!word) return ''
  return word
    .toLowerCase()
    .replace(/(y|ies|ing|ed|s)$/, '')
    .replace(/(.)\1+$/, '$1') // e.g. blurr -> blur
}

/**
 * Checks whether a negative term contradicts a positive prompt intent.
 * E.g. If user asks for "grainy vintage 35mm film", don't inject "grain" or "vintage".
 */
export function contradictsPositive(negativeTerm, positivePrompt) {
  const pos = String(positivePrompt || '').toLowerCase()
  const neg = String(negativeTerm || '').toLowerCase().trim()

  if (!pos || !neg) return false

  // Check direct inclusion or overlap
  const posWords = pos.match(/[a-z0-9]+/g) || []
  const negWords = neg.match(/[a-z0-9]+/g) || []

  // Stylistic keywords where positive intent must be respected
  const styleKeywords = [
    'blur', 'blurry', 'grain', 'grainy', 'vintage', 'noise', 'noisy',
    'monochrome', 'grayscale', 'sketch', 'drawing', 'dark', 'shadowy',
  ]

  for (const nw of negWords) {
    const nwNorm = normalizeWord(nw)
    for (const styleKw of styleKeywords) {
      if (nw === styleKw || nwNorm === normalizeWord(styleKw)) {
        // Look if positive prompt contains this style word or normalized form
        if (posWords.some((pw) => pw === styleKw || normalizeWord(pw) === nwNorm)) {
          return true
        }
      }
    }
  }

  return false
}

/**
 * Sanitize, merge, and deduplicate negative prompt with default safety defect terms.
 *
 * @param {Object} options
 * @param {string} [options.positivePrompt]
 * @param {string} [options.userNegative]
 * @param {string[]} [options.additionalTerms]
 * @param {boolean} [options.autoInjectDefects=true]
 * @returns {string} Sanitized negative prompt
 */
export function sanitizeNegativePrompt({
  positivePrompt = '',
  userNegative = '',
  additionalTerms = [],
  autoInjectDefects = true,
} = {}) {
  const seen = new Set()
  const result = []

  const addTerm = (rawTerm) => {
    const term = String(rawTerm || '').trim()
    if (!term) return
    const key = term.toLowerCase()
    if (seen.has(key)) return
    if (contradictsPositive(term, positivePrompt)) return
    seen.add(key)
    result.push(term)
  }

  // 1. User's explicit negative prompt comes first (preserves user intent and weights like "(bad:1.2)")
  const userTerms = splitTerms(userNegative)
  for (const t of userTerms) {
    addTerm(t)
  }

  // 2. Preset / additional negative terms
  for (const t of additionalTerms) {
    if (typeof t === 'string') {
      for (const sub of splitTerms(t)) addTerm(sub)
    }
  }

  // 3. Built-in defect terms (if enabled)
  if (autoInjectDefects) {
    for (const d of DEFAULT_DEFECT_TERMS) {
      addTerm(d)
    }
  }

  return result.join(', ')
}
