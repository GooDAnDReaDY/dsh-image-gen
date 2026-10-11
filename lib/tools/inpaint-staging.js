import {
  createStagingSession,
  reviewStagedEdit,
  getStagingSession,
} from '../inpaint-staging.js'

/**
 * Registers staging & review workflow tools (#436).
 */
export function registerInpaintStagingTools(ctx, deps = {}) {
  ctx.tools.register({
    name: 'stage_image_edit',
    description: 'Stages a localized inpaint or image modification in preview state for user review before committing.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        image: {
          type: 'string',
          description: 'Original image path or URL to edit.',
        },
        prompt: {
          type: 'string',
          description: 'Edit instruction or prompt for the localized modification.',
        },
        mask: {
          type: 'string',
          description: 'Optional inpainting mask path, base64, or SVG string.',
        },
        bbox: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional bounding box [x1, y1, x2, y2] (normalized 0-1000).',
        },
        previewImage: {
          type: 'string',
          description: 'Initial preview image path if already produced.',
        },
      },
      required: ['image', 'prompt'],
    },
    output: {
      render(args, value) {
        return [
          {
            type: 'text',
            text: `Staging Session Created: [${value?.stageId}]\n` +
              `Status: ${value?.status} (preview only, original preserved)\n` +
              `Instruction: "${value?.prompt}"\n` +
              `Preview: ${value?.previewImage || 'Generating in background...'}`,
          },
        ]
      },
    },
    async execute(args) {
      const storagePath = deps.stagingStoragePath || null
      return createStagingSession(
        {
          originalImage: args.image,
          prompt: args.prompt,
          mask: args.mask,
          bbox: args.bbox,
          previewImage: args.previewImage,
          provider: deps.cfg?.provider || 'fal',
        },
        storagePath
      )
    },
  })

  ctx.tools.register({
    name: 'review_staged_edit',
    description: 'Reviews a staged image edit: accept (commits change), reject (restores original), retry (new prompt), or cancel.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        stageId: {
          type: 'string',
          description: 'ID of the staging session to review.',
        },
        action: {
          type: 'string',
          enum: ['accept', 'reject', 'retry', 'cancel'],
          description: 'Review decision: accept, reject, retry, or cancel.',
        },
        prompt: {
          type: 'string',
          description: 'New instruction if retrying with updated prompt.',
        },
        reason: {
          type: 'string',
          description: 'Optional reason when rejecting or cancelling.',
        },
      },
      required: ['stageId', 'action'],
    },
    output: {
      render(args, value) {
        if (!value?.ok) {
          return [{ type: 'text', text: `Review failed: ${value?.error || 'Unknown error'}` }]
        }
        return [
          {
            type: 'text',
            text: `Review Result: ${value.message}\nStatus: ${value.status}\nStage ID: ${args.stageId}`,
          },
        ]
      },
    },
    async execute(args) {
      const storagePath = deps.stagingStoragePath || null
      return reviewStagedEdit(args.stageId, args.action, { prompt: args.prompt, reason: args.reason }, storagePath)
    },
  })
}
