import { renderToolOutput } from "../attachment-helper.js"
import { defineTool } from '@deepseek-ai/dsh-tools'
import { toLosslessJson } from '../providers.js'
import { slugify } from '../index.js'

export function registerGenerationPackTool(ctx, deps) {
  
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_image_pack',
        description: 'Generate a multi-aspect ratio pack of the same image (e.g. 1:1, 16:9, 9:16) for different platforms.',
        parameters: {
          prompt: { type: 'string', required: true, description: 'Text prompt for image generation.' },
          aspect_ratios: { type: 'array', items: { type: 'string' }, description: 'Target ratios (default: ["1:1", "16:9", "9:16"]).' },
          output_name: { type: 'string', description: 'Base file name for the pack.' },
        },
        output: {
        render: (_args, value) => renderToolOutput(value),
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              images: { type: 'array', items: { type: 'object', additionalProperties: true } },
              count: { type: 'number' },
              warnings: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        async execute(args, exec) {
          const ratios = Array.isArray(args.aspect_ratios) && args.aspect_ratios.length ? args.aspect_ratios : ['1:1', '16:9', '9:16']
                    const generateTool = ctx.tools.get('generate_image')
          const results = []
          const warnings = []
          const seedBase = Math.floor(Math.random() * 100000)

          const packTasks = ratios.map((ratio) => async () => {
            const sizeName = ratio === '16:9' ? 'landscape_16_9' : ratio === '9:16' ? 'portrait_16_9' : ratio === '4:3' ? 'landscape_4_3' : ratio === '3:4' ? 'portrait_4_3' : 'square_hd'
            const name = `${slugify(args.output_name || 'pack')}-${ratio.replace(':', 'x')}`
            try {
              const genResult = await generateTool.execute({
                prompt: args.prompt,
                image_size: sizeName,
                seed: seedBase,
                output_name: name,
              }, exec)
              return { success: true, ratio, genResult }
            } catch (err) {
              return { success: false, ratio, error: err?.message || String(err) }
            }
          })
          const settledPack = await Promise.all(packTasks.map((t) => t()))
          for (const item of settledPack) {
            if (item.success) {
              results.push({ ratio: item.ratio, ...item.genResult })
            } else {
              warnings.push(`Ratio ${item.ratio} failed: ${item.error}`)
            }
          }

          if (results.length === 0 && warnings.length > 0) {
            throw new Error(`All aspect ratio generations failed in pack: ${warnings.join('; ')}`)
          }

          return toLosslessJson({
            images: results,
            count: results.length,
            ...(warnings.length ? { warnings } : {}),
          })
        },
      }),
    )
  }, 'dsh-image-gen: tool generate_image_pack')
}
