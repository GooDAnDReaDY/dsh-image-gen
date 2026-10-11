import {
  getCapabilityRegistry,
  recommendModelForTask,
  validateModelCapability,
} from '../capabilities.js'

/**
 * Registers capability-based model selection tools (#434).
 */
export function registerCapabilityTools(ctx, deps = {}) {
  ctx.tools.register({
    name: 'select_image_model',
    description: 'Recommends the best provider and model based on required task capabilities (text rendering, inpainting, face preservation, cost limits).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operations: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required operations, e.g. ["txt2img", "inpaint", "img2img"].',
        },
        textRendering: {
          type: 'boolean',
          description: 'Whether native high-precision text rendering is required.',
        },
        facePreservation: {
          type: 'boolean',
          description: 'Whether facial identity likeness preservation is required.',
        },
        maskInpainting: {
          type: 'boolean',
          description: 'Whether pixel-accurate inpainting mask support is required.',
        },
        referenceConditioning: {
          type: 'boolean',
          description: 'Whether reference image guidance is required.',
        },
        controlnet: {
          type: 'boolean',
          description: 'Whether structural ControlNet guidance is required.',
        },
        minResolution: {
          type: 'number',
          description: 'Minimum resolution in pixels (e.g. 1024 or 2048).',
        },
        maxCostUSD: {
          type: 'number',
          description: 'Maximum estimated cost in USD per generation.',
        },
      },
    },
    output: {
      render(args, value) {
        if (!value?.ok) {
          return [{ type: 'text', text: `Capability selection: ${value?.message || 'No matching model found.'}` }]
        }
        const rec = value.recommended
        return [
          {
            type: 'text',
            text: `Recommended Model: ${rec.displayName} (${rec.provider}/${rec.modelId})\nReason: ${value.recommendationReason}\nEstimated Cost: $${rec.estimatedCostUSD} (Source: ${rec.pricingSource})`,
          },
        ]
      },
    },
    async execute(args) {
      const requirements = {
        operations: args.operations || [],
        textRendering: Boolean(args.textRendering),
        facePreservation: Boolean(args.facePreservation),
        maskInpainting: Boolean(args.maskInpainting),
        referenceConditioning: Boolean(args.referenceConditioning),
        controlnet: Boolean(args.controlnet),
        minResolution: args.minResolution || 0,
        maxCost: args.maxCostUSD || Infinity,
      }

      // Check configured provider list from deps or runtime
      const configuredProviders = deps.cfg?.provider ? [deps.cfg.provider] : null
      return recommendModelForTask(requirements, { configuredProviders })
    },
  })

  ctx.tools.register({
    name: 'validate_model_features',
    description: 'Pre-flight check if a model or provider supports specific generation features before running the task.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        provider: {
          type: 'string',
          description: 'Provider name (fal, gemini, replicate, local, seedream).',
        },
        modelId: {
          type: 'string',
          description: 'Specific model identifier.',
        },
        operation: {
          type: 'string',
          description: 'Requested operation (txt2img, img2img, inpaint).',
        },
        requiresMask: {
          type: 'boolean',
          description: 'Whether operation requires inpainting mask.',
        },
        requiresReference: {
          type: 'boolean',
          description: 'Whether operation requires reference image.',
        },
        requiresFacePreservation: {
          type: 'boolean',
          description: 'Whether operation requires face preservation.',
        },
        requiresTextRender: {
          type: 'boolean',
          description: 'Whether operation requires text rendering.',
        },
      },
      required: ['provider'],
    },
    output: {
      render(args, value) {
        return [
          {
            type: 'text',
            text: value.valid
              ? `Validation PASSED for ${args.provider}: ${value.model?.displayName}`
              : `Validation FAILED (${value.status}): ${value.reason}`,
          },
        ]
      },
    },
    async execute(args) {
      return validateModelCapability(args.provider, args.modelId, args)
    },
  })
}
