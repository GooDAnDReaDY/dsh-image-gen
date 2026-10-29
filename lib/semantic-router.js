// @ts-check
// semantic-router.js — Smart prompt-to-model semantic router for optimal image provider selection (#462).

/**
 * Keyword rules and weights for semantic intent classification.
 */
const INTENT_RULES = {
  typography: {
    weight: 1.4,
    keywords: [
      'text', 'typography', 'font', 'fonts', 'letters', 'lettering', 'words',
      'quote', 'quotes', 'slogan', 'signboard', 'sign', 'billboard', 'banner with text',
      'book cover', 'magazine cover', 't-shirt text', 'spelled out', 'named',
      'written', 'headline', 'typographic', 'neon sign', 'street sign',
    ],
  },
  photorealism: {
    weight: 1.2,
    keywords: [
      'photo', 'photograph', 'photorealistic', 'portrait', '35mm', 'dslr',
      'raw photo', 'candid', 'skin texture', 'studio portrait', 'macro photo',
      'documentary', 'hyperrealistic', 'cinematic lighting', 'film still',
      'bokeh', 'depth of field', 'polaroid', 'kodachrome', 'national geographic',
    ],
  },
  vector_icon: {
    weight: 1.3,
    keywords: [
      'vector', 'icon', 'svg', 'flat icon', 'pictogram', 'glyph', 'clip art',
      'sticker', 'symbol', 'minimalist logo', 'app icon', 'line art',
      'monoline', 'graphic design asset', 'flat illustration', 'ui icon',
    ],
  },
  diagram_schematic: {
    weight: 1.3,
    keywords: [
      'diagram', 'schematic', 'blueprint', 'flowchart', 'floor plan',
      'architectural plan', 'wiring diagram', 'infographic', 'circuit diagram',
      'technical drawing', 'wireframe', 'system architecture', 'mindmap',
    ],
  },
  fast_draft: {
    weight: 1.1,
    keywords: [
      'draft', 'sketch', 'quick preview', 'rough', 'scribble', 'thumbnail',
      'low-fi', 'fast preview', 'doodle', 'wip', 'concept thumbnail',
    ],
  },
}

/**
 * Classifies the semantic intention of a generation prompt.
 *
 * @param {string} prompt
 * @returns {{
 *   intent: 'typography' | 'photorealism' | 'vector_icon' | 'diagram_schematic' | 'fast_draft' | 'general_art',
 *   confidence: number,
 *   reasoning: string,
 *   matchedKeywords: string[],
 *   hasQuotedText: boolean
 * }}
 */
export function classifyPromptIntent(prompt) {
  const text = String(prompt || '').toLowerCase()
  if (!text.trim()) {
    return {
      intent: 'general_art',
      confidence: 0.5,
      reasoning: 'Empty or unspecified prompt defaulted to general artistic generation.',
      matchedKeywords: [],
      hasQuotedText: false,
    }
  }

  // Check for quoted phrases (e.g. text saying "GOOD MORNING")
  const quoteRegex = /["'«»“”]([^"'«»“”]{2,})["'«»“”]/g
  const quotedMatches = []
  let match
  while ((match = quoteRegex.exec(prompt)) !== null) {
    if (match[1] && match[1].trim().length > 1) {
      quotedMatches.push(match[1].trim())
    }
  }
  const hasQuotedText = quotedMatches.length > 0

  const scores = {
    typography: hasQuotedText ? 1.8 : 0,
    photorealism: 0,
    vector_icon: 0,
    diagram_schematic: 0,
    fast_draft: 0,
  }

  const matchedKeywordsMap = {
    typography: hasQuotedText ? [`quoted_text: "${quotedMatches[0]}"`] : [],
    photorealism: [],
    vector_icon: [],
    diagram_schematic: [],
    fast_draft: [],
  }

  for (const [intent, rule] of Object.entries(INTENT_RULES)) {
    for (const kw of rule.keywords) {
      // Word boundary match or substring for compound phrases
      const regex = new RegExp(`\\b${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i')
      if (regex.test(text)) {
        scores[intent] += rule.weight
        matchedKeywordsMap[intent].push(kw)
      }
    }
  }

  let topIntent = 'general_art'
  let highestScore = 0

  for (const [intent, score] of Object.entries(scores)) {
    if (score > highestScore) {
      highestScore = score
      topIntent = intent
    }
  }

  if (highestScore < 0.9) {
    return {
      intent: 'general_art',
      confidence: 0.6,
      reasoning: 'Standard artistic or conceptual scene with no strong domain-specific keywords.',
      matchedKeywords: [],
      hasQuotedText,
    }
  }

  const confidence = Math.min(0.99, +(0.5 + highestScore * 0.15).toFixed(2))
  const matchedList = matchedKeywordsMap[topIntent] || []
  let intentExplanation = ''

  switch (topIntent) {
    case 'typography':
      intentExplanation = `Detected text/lettering intent (${matchedList.join(', ')}). Requires high-fidelity typography rendering.`
      break
    case 'photorealism':
      intentExplanation = `Detected photographic realism intent (${matchedList.join(', ')}). Requires natural skin/lighting rendering.`
      break
    case 'vector_icon':
      intentExplanation = `Detected vector/icon graphic intent (${matchedList.join(', ')}). Requires flat geometric asset synthesis.`
      break
    case 'diagram_schematic':
      intentExplanation = `Detected technical schematic/diagram intent (${matchedList.join(', ')}). Requires crisp structural line work.`
      break
    case 'fast_draft':
      intentExplanation = `Detected rapid draft/sketch intent (${matchedList.join(', ')}). Requires low-latency fast generation.`
      break
    default:
      intentExplanation = 'General creative rendering.'
  }

  return {
    intent: /** @type {any} */ (topIntent),
    confidence,
    reasoning: intentExplanation,
    matchedKeywords: matchedList,
    hasQuotedText,
  }
}

/**
 * Resolves the optimal provider and model based on classified prompt intent and active configuration.
 *
 * @param {object} params
 * @param {string} params.prompt
 * @param {object} [params.intent]
 * @param {object} params.cfg
 * @param {string[]} [params.availableProviders]
 * @returns {{
 *   detected_intent: string,
 *   selected_provider: string,
 *   selected_model: string,
 *   reasoning: string,
 *   confidence: number,
 *   matched_keywords: string[],
 *   auto_routed: boolean
 * }}
 */
export function resolveOptimalProvider({
  prompt,
  intent,
  cfg = {},
  availableProviders = ['fal', 'gemini', 'custom', 'seedream', 'replicate', 'local'],
}) {
  const classified = intent || classifyPromptIntent(prompt)
  const defaultProvider = cfg.provider && availableProviders.includes(cfg.provider)
    ? cfg.provider
    : (availableProviders[0] || 'fal')

  // Check explicit config overrides
  const customMappings = cfg.semanticRouting || cfg.semanticRouter?.mappings || {}
  if (customMappings[classified.intent]) {
    const override = customMappings[classified.intent]
    const selectedProvider = override.provider || defaultProvider
    const selectedModel = override.model || cfg.model || 'default'
    return {
      detected_intent: classified.intent,
      selected_provider: selectedProvider,
      selected_model: selectedModel,
      reasoning: `${classified.reasoning} Routed via user-configured override for "${classified.intent}".`,
      confidence: classified.confidence,
      matched_keywords: classified.matchedKeywords,
      auto_routed: true,
    }
  }

  let selectedProvider = defaultProvider
  let selectedModel = cfg.model || 'default'
  let rationale = classified.reasoning

  switch (classified.intent) {
    case 'typography':
      if (availableProviders.includes('fal')) {
        selectedProvider = 'fal'
        selectedModel = 'fal-ai/flux/dev'
        rationale += ' Routed to FLUX Dev on FAL for accurate spelling and text typography.'
      } else if (availableProviders.includes('gemini')) {
        selectedProvider = 'gemini'
        selectedModel = 'imagen-3.0-generate-002'
        rationale += ' Routed to Gemini Imagen 3 for strong semantic text synthesis.'
      }
      break

    case 'photorealism':
      if (availableProviders.includes('fal')) {
        selectedProvider = 'fal'
        selectedModel = 'fal-ai/flux/dev'
        rationale += ' Routed to FLUX Dev for realistic camera bokeh, lighting, and fine skin detail.'
      } else if (availableProviders.includes('custom')) {
        selectedProvider = 'custom'
        selectedModel = cfg.customModel || 'sdxl-photoreal'
        rationale += ' Routed to custom photorealistic model pipeline.'
      }
      break

    case 'vector_icon':
      if (availableProviders.includes('fal')) {
        selectedProvider = 'fal'
        selectedModel = 'fal-ai/recraft-v3'
        rationale += ' Routed to Recraft v3 on FAL for precision vector iconography and clean SVG styling.'
      } else {
        selectedProvider = defaultProvider
        rationale += ` Routed to ${defaultProvider} with vector optimization.`
      }
      break

    case 'diagram_schematic':
      if (availableProviders.includes('gemini')) {
        selectedProvider = 'gemini'
        selectedModel = 'imagen-3.0-generate-002'
        rationale += ' Routed to Gemini Imagen 3 for technical schematic and diagram structural fidelity.'
      } else if (availableProviders.includes('fal')) {
        selectedProvider = 'fal'
        selectedModel = 'fal-ai/flux/dev'
        rationale += ' Routed to FLUX Dev for crisp line work and technical layouts.'
      }
      break

    case 'fast_draft':
      if (availableProviders.includes('local')) {
        selectedProvider = 'local'
        selectedModel = 'sdxl-turbo'
        rationale += ' Routed to local offline pipeline for near-instant sub-second preview drafting.'
      } else if (availableProviders.includes('fal')) {
        selectedProvider = 'fal'
        selectedModel = 'fal-ai/flux/schnell'
        rationale += ' Routed to FLUX Schnell on FAL for high-speed preview generation.'
      }
      break

    case 'general_art':
    default:
      selectedProvider = defaultProvider
      selectedModel = cfg.model || cfg.customModel || 'default'
      rationale += ` Routed to standard workspace primary engine (${defaultProvider}).`
      break
  }

  return {
    detected_intent: classified.intent,
    selected_provider: selectedProvider,
    selected_model: selectedModel,
    reasoning: rationale.trim(),
    confidence: classified.confidence,
    matched_keywords: classified.matchedKeywords,
    auto_routed: true,
  }
}

