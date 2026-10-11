/**
 * Capability Registry and Model Selector (#434)
 * Provides comprehensive capability mapping, strict pre-flight validation,
 * cost estimation, and recommendation for task-specific models and providers.
 */

export const CAPABILITY_REGISTRY = [
  // Fal.ai models
  {
    provider: 'fal',
    modelId: 'fal-ai/flux/dev',
    displayName: 'FLUX.1 [dev]',
    capabilities: ['txt2img', 'img2img', 'inpaint', 'high_res', 'text_rendering'],
    maxResolution: 2048,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
    features: {
      textRendering: true,
      facePreservation: false,
      maskInpainting: true,
      referenceConditioning: false,
      controlnet: false,
    },
    estimatedCostUSD: 0.025,
    pricingSource: 'fal.ai/pricing (2026-09)',
    verifiedDate: '2026-09-15',
    tier: 'pro',
  },
  {
    provider: 'fal',
    modelId: 'fal-ai/flux/schnell',
    displayName: 'FLUX.1 [schnell]',
    capabilities: ['txt2img', 'text_rendering'],
    maxResolution: 1024,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    features: {
      textRendering: true,
      facePreservation: false,
      maskInpainting: false,
      referenceConditioning: false,
      controlnet: false,
    },
    estimatedCostUSD: 0.003,
    pricingSource: 'fal.ai/pricing (2026-09)',
    verifiedDate: '2026-09-15',
    tier: 'economy',
  },
  {
    provider: 'fal',
    modelId: 'fal-ai/flux-general/image-to-image',
    displayName: 'FLUX.1 Image-to-Image',
    capabilities: ['img2img', 'reference'],
    maxResolution: 1536,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    features: {
      textRendering: true,
      facePreservation: false,
      maskInpainting: false,
      referenceConditioning: true,
      controlnet: false,
    },
    estimatedCostUSD: 0.03,
    pricingSource: 'fal.ai/pricing (2026-09)',
    verifiedDate: '2026-09-15',
    tier: 'pro',
  },
  {
    provider: 'fal',
    modelId: 'fal-ai/recraft-v3',
    displayName: 'Recraft v3',
    capabilities: ['txt2img', 'vector', 'text_rendering', 'high_res'],
    maxResolution: 2048,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    features: {
      textRendering: true,
      facePreservation: false,
      maskInpainting: false,
      referenceConditioning: false,
      controlnet: false,
    },
    estimatedCostUSD: 0.04,
    pricingSource: 'fal.ai/pricing (2026-09)',
    verifiedDate: '2026-09-15',
    tier: 'pro',
  },

  // Google Gemini Imagen models
  {
    provider: 'gemini',
    modelId: 'imagen-3.0-generate-002',
    displayName: 'Google Imagen 3.0',
    capabilities: ['txt2img', 'text_rendering', 'high_res'],
    maxResolution: 2048,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    features: {
      textRendering: true,
      facePreservation: false,
      maskInpainting: false,
      referenceConditioning: false,
      controlnet: false,
    },
    estimatedCostUSD: 0.03,
    pricingSource: 'ai.google.dev (2026-09)',
    verifiedDate: '2026-09-01',
    tier: 'pro',
  },
  {
    provider: 'gemini',
    modelId: 'imagen-3.0-capability-001',
    displayName: 'Google Imagen 3.0 Editing',
    capabilities: ['txt2img', 'img2img', 'inpaint', 'outpaint'],
    maxResolution: 1536,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    features: {
      textRendering: true,
      facePreservation: false,
      maskInpainting: true,
      referenceConditioning: true,
      controlnet: false,
    },
    estimatedCostUSD: 0.035,
    pricingSource: 'ai.google.dev (2026-09)',
    verifiedDate: '2026-09-01',
    tier: 'pro',
  },

  // Replicate models
  {
    provider: 'replicate',
    modelId: 'black-forest-labs/flux-1.1-pro',
    displayName: 'Replicate FLUX 1.1 Pro',
    capabilities: ['txt2img', 'text_rendering', 'high_res'],
    maxResolution: 2048,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
    features: {
      textRendering: true,
      facePreservation: false,
      maskInpainting: false,
      referenceConditioning: false,
      controlnet: false,
    },
    estimatedCostUSD: 0.04,
    pricingSource: 'replicate.com/pricing',
    verifiedDate: '2026-09-10',
    tier: 'pro',
  },
  {
    provider: 'replicate',
    modelId: 'stability-ai/sdxl',
    displayName: 'Replicate SDXL',
    capabilities: ['txt2img', 'img2img', 'inpaint'],
    maxResolution: 1024,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    features: {
      textRendering: false,
      facePreservation: false,
      maskInpainting: true,
      referenceConditioning: true,
      controlnet: false,
    },
    estimatedCostUSD: 0.018,
    pricingSource: 'replicate.com/pricing',
    verifiedDate: '2026-09-10',
    tier: 'economy',
  },

  // Local (ComfyUI / Stable Diffusion / A1111)
  {
    provider: 'local',
    modelId: 'sdxl_base',
    displayName: 'Local ComfyUI SDXL Base',
    capabilities: ['txt2img', 'img2img', 'inpaint', 'high_res', 'face_preservation', 'controlnet'],
    maxResolution: 2048,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
    features: {
      textRendering: false,
      facePreservation: true,
      maskInpainting: true,
      referenceConditioning: true,
      controlnet: true,
    },
    estimatedCostUSD: 0.0,
    pricingSource: 'local-hardware (0 USD)',
    verifiedDate: '2026-10-01',
    tier: 'free',
  },
  {
    provider: 'local',
    modelId: 'flux_local',
    displayName: 'Local ComfyUI FLUX',
    capabilities: ['txt2img', 'img2img', 'text_rendering', 'high_res'],
    maxResolution: 2048,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
    features: {
      textRendering: true,
      facePreservation: false,
      maskInpainting: false,
      referenceConditioning: false,
      controlnet: false,
    },
    estimatedCostUSD: 0.0,
    pricingSource: 'local-hardware (0 USD)',
    verifiedDate: '2026-10-01',
    tier: 'free',
  },

  // Seedream backend
  {
    provider: 'seedream',
    modelId: 'seedream-v2',
    displayName: 'Seedream v2',
    capabilities: ['txt2img', 'img2img'],
    maxResolution: 1024,
    supportedAspectRatios: ['1:1', '16:9', '9:16'],
    features: {
      textRendering: false,
      facePreservation: false,
      maskInpainting: false,
      referenceConditioning: false,
      controlnet: false,
    },
    estimatedCostUSD: 0.015,
    pricingSource: 'seedream API',
    verifiedDate: '2026-08-20',
    tier: 'economy',
  },
]

/**
 * Returns the entire capability registry with metadata.
 */
export function getCapabilityRegistry() {
  return [...CAPABILITY_REGISTRY]
}

/**
 * Filter models based on required operations and features.
 * Unknown capabilities are strictly treated as unsupported.
 */
export function filterModelsByCapabilities(requirements = {}, options = {}) {
  const {
    operations = [],
    textRendering = false,
    facePreservation = false,
    maskInpainting = false,
    referenceConditioning = false,
    controlnet = false,
    minResolution = 0,
    aspectRatio = null,
  } = requirements

  const maxCost = requirements.maxCost ?? requirements.maxCostUSD ?? Infinity

  const configuredProviders = Array.isArray(options.configuredProviders)
    ? options.configuredProviders
    : (Array.isArray(requirements.configuredProviders) ? requirements.configuredProviders : null)

  return CAPABILITY_REGISTRY.map((model) => {
    const missing = []

    if (configuredProviders && !configuredProviders.includes(model.provider)) {
      missing.push(`provider_unconfigured:${model.provider}`)
    }

    for (const op of operations) {
      if (!model.capabilities.includes(op)) {
        missing.push(`operation:${op}`)
      }
    }

    if (textRendering && !model.features.textRendering) {
      missing.push('feature:textRendering')
    }
    if (facePreservation && !model.features.facePreservation) {
      missing.push('feature:facePreservation')
    }
    if (maskInpainting && !model.features.maskInpainting) {
      missing.push('feature:maskInpainting')
    }
    if (referenceConditioning && !model.features.referenceConditioning) {
      missing.push('feature:referenceConditioning')
    }
    if (controlnet && !model.features.controlnet) {
      missing.push('feature:controlnet')
    }

    if (minResolution > 0 && model.maxResolution < minResolution) {
      missing.push(`resolution:${model.maxResolution}<${minResolution}`)
    }

    if (aspectRatio && !model.supportedAspectRatios.includes(aspectRatio)) {
      missing.push(`aspectRatio:${aspectRatio}`)
    }

    if (model.estimatedCostUSD > maxCost) {
      missing.push(`cost:${model.estimatedCostUSD}>${maxCost}`)
    }

    return {
      ...model,
      compatible: missing.length === 0,
      missingCapabilities: missing,
    }
  })
}

/**
 * Evaluates requirements and recommends the best model.
 */
export function recommendModelForTask(requirements = {}, options = {}) {
  const evaluated = filterModelsByCapabilities(requirements, options)
  const compatible = evaluated.filter((m) => m.compatible)

  if (compatible.length === 0) {
    const partial = [...evaluated].sort((a, b) => a.missingCapabilities.length - b.missingCapabilities.length)
    return {
      ok: false,
      recommended: null,
      message: 'No model in registry completely satisfies all specified task requirements.',
      alternatives: partial.slice(0, 3).map((m) => ({
        provider: m.provider,
        modelId: m.modelId,
        displayName: m.displayName,
        missing: m.missingCapabilities,
        estimatedCostUSD: m.estimatedCostUSD,
      })),
    }
  }

  // Rank compatible models:
  // 1. Configured providers preferred
  // 2. Cost-effectiveness
  // 3. Higher max resolution
  compatible.sort((a, b) => {
    if (a.estimatedCostUSD !== b.estimatedCostUSD) {
      return a.estimatedCostUSD - b.estimatedCostUSD
    }
    return b.maxResolution - a.maxResolution
  })

  const best = compatible[0]
  const reasons = []
  if (best.estimatedCostUSD === 0) reasons.push('Zero API cost (local backend)')
  else reasons.push(`Estimated cost: $${best.estimatedCostUSD.toFixed(3)}`)
  if (best.features.textRendering && requirements.textRendering) reasons.push('Native high-precision text rendering')
  if (best.features.facePreservation && requirements.facePreservation) reasons.push('Facial identity retention supported')
  if (best.features.maskInpainting && requirements.maskInpainting) reasons.push('Pixel-accurate mask inpainting supported')

  return {
    ok: true,
    recommended: best,
    recommendationReason: reasons.join('; '),
    allCompatibleCount: compatible.length,
    alternatives: compatible.slice(1, 4).map((m) => ({
      provider: m.provider,
      modelId: m.modelId,
      displayName: m.displayName,
      estimatedCostUSD: m.estimatedCostUSD,
    })),
  }
}

/**
 * Pre-flight validation before provider dispatch (#434).
 * Rejects unsupported capabilities BEFORE submitting to provider to avoid wasting credits or losing inputs.
 */
export function validateModelCapability(provider, modelId, requestedFeatures = {}) {
  const model = CAPABILITY_REGISTRY.find(
    (m) => m.provider === provider && (m.modelId === modelId || !modelId)
  )

  if (!model) {
    // Unknown model/provider: return strict unknown warning
    return {
      valid: false,
      status: 'unknown_model',
      reason: `Provider "${provider}" with model "${modelId || 'default'}" is not documented in capability registry.`,
    }
  }

  const {
    operation,
    requiresMask,
    requiresReference,
    requiresFacePreservation,
    requiresTextRender,
  } = requestedFeatures

  if (operation && !model.capabilities.includes(operation)) {
    return {
      valid: false,
      status: 'unsupported_operation',
      reason: `Operation "${operation}" is not supported by model "${model.displayName}" (${model.provider}).`,
    }
  }

  if (requiresMask && !model.features.maskInpainting) {
    return {
      valid: false,
      status: 'unsupported_feature',
      reason: `Mask inpainting is requested but not supported by "${model.displayName}". Discarding mask would corrupt generation.`,
    }
  }

  if (requiresReference && !model.features.referenceConditioning && !model.capabilities.includes('img2img')) {
    return {
      valid: false,
      status: 'unsupported_feature',
      reason: `Reference image conditioning is requested but not supported by "${model.displayName}".`,
    }
  }

  if (requiresFacePreservation && !model.features.facePreservation) {
    return {
      valid: false,
      status: 'unsupported_feature',
      reason: `Face preservation identity transfer is requested but not supported by "${model.displayName}".`,
    }
  }

  if (requiresTextRender && !model.features.textRendering) {
    return {
      valid: false,
      status: 'unsupported_feature',
      reason: `High-fidelity text rendering is required but "${model.displayName}" lacks native text layout capabilities.`,
    }
  }

  return {
    valid: true,
    status: 'supported',
    model,
  }
}
