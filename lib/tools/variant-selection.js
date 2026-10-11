import {
  createVariantSession,
  selectVariantWinner,
  getVariantSession,
} from '../variant-selection.js'

/**
 * Registers variant comparison and winner selection tools (#438).
 */
export function registerVariantTools(ctx, deps = {}) {
  ctx.tools.register({
    name: 'evaluate_image_variants',
    description: 'Sets up a side-by-side comparison session for multiple image options with structured criteria.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          description: 'Title for the evaluation session.',
        },
        variants: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              path: { type: 'string' },
              label: { type: 'string' },
              seed: { type: 'number' },
              prompt: { type: 'string' },
            },
          },
          description: 'Array of at least 2 image variants to evaluate.',
        },
      },
      required: ['variants'],
    },
    output: {
      render(args, value) {
        return [
          {
            type: 'text',
            text: `Variant Session Created: [${value?.selectionId}] "${value?.name}"\n` +
              `Variants (${value?.variants?.length}):\n` +
              (value?.variants || [])
                .map((v) => `  #${v.index}: ${v.label} (seed: ${v.seed || 'none'}) - ${v.path}`)
                .join('\n'),
          },
        ]
      },
    },
    async execute(args) {
      const storagePath = deps.variantStoragePath || null
      return createVariantSession(
        {
          name: args.name,
          variants: args.variants,
        },
        storagePath
      )
    },
  })

  ctx.tools.register({
    name: 'select_variant_winner',
    description: 'Designates the winning variant, tags discards/refinements, and prepares continuation payload for next pipeline step.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        selectionId: {
          type: 'string',
          description: 'Evaluation session ID.',
        },
        winnerIndex: {
          type: 'number',
          description: 'Index of winning variant (0-based).',
        },
        winnerPath: {
          type: 'string',
          description: 'Path of winning variant (alternative to winnerIndex).',
        },
        refineIndexes: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional indexes of variants kept for refinement.',
        },
        nextAction: {
          type: 'string',
          enum: ['none', 'upscale', 'edit', 'remix', 'vectorize'],
          description: 'Next action to execute with the winner.',
        },
        actionParams: {
          type: 'object',
          additionalProperties: true,
          description: 'Parameters for the next action.',
        },
      },
      required: ['selectionId'],
    },
    output: {
      render(args, value) {
        if (!value?.ok) return [{ type: 'text', text: `Selection failed: ${value?.error}` }]
        const w = value.winner
        return [
          {
            type: 'text',
            text: `Selected Winner: Option #${w.index} (${w.label})\n` +
              `Path: ${w.path}\n` +
              `Next Action: ${value.continuationPayload?.action || 'None'}\n` +
              (value.continuationPayload ? `Continuation Ready: ${JSON.stringify(value.continuationPayload.params)}` : ''),
          },
        ]
      },
    },
    async execute(args) {
      const storagePath = deps.variantStoragePath || null
      return selectVariantWinner(
        args.selectionId,
        {
          winnerIndex: args.winnerIndex,
          winnerPath: args.winnerPath,
          refineIndexes: args.refineIndexes,
          nextAction: args.nextAction,
          actionParams: args.actionParams,
        },
        storagePath
      )
    },
  })
}
