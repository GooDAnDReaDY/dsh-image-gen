import { renderToolOutput } from "../attachment-helper.js"
// sketch — sketch_to_image tool (#146)

import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  makeProviders,
  toLosslessJson,
} from '../providers.js'
import { resolveConversationImage, analyzeImageWithVision } from '../resolve-image.js'
import { calculateGenerationCost, assertBudgetAvailable } from '../cost-meter.js'
import { trackAndAssertLoopGuard } from '../loop-guard.js'
import { sanitizeErrorAndLogs } from '../security.js'

const SKETCH_PROMPT_SUFFIX =
  'Detailed finished artwork derived from the provided line sketch. '
  + 'Preserve the original composition, geometry, and proportions of the sketch. '
  + 'Fill with coherent materials, lighting, and color while keeping the silhouette faithful.'

function isSvgSource(source) {
  const mt = String(source?.mediaType || '').toLowerCase()
  if (mt.includes('svg')) return true
  const head = source?.bytes ? Buffer.from(source.bytes).subarray(0, 256).toString('utf8') : ''
  return head.includes('<svg')
}

export function registerSketchTools(ctx, deps) {
  const {
    live,
    saveAndAttachResult,
    slugify,
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'sketch_to_image',
        description:
          'Turn a rough sketch, wireframe, or line drawing into a finished illustration (#146). '
          + 'Accepts a raster sketch (PNG/JPEG) or SVG outline plus a text prompt. '
          + 'Uses image-to-image with lower denoise strength so composition and proportions of the sketch are preserved. '
          + 'If image is omitted or "latest", resolves the most recent image from the conversation session.',
        parameters: {
          prompt: {
            type: 'string',
            required: true,
            description: 'What the finished image should look like (style, materials, lighting, mood).',
          },
          image: {
            type: 'string',
            description: 'Path or attachment id of the sketch. Defaults to "latest" to auto-resolve from session history.',
          },
          strength: {
            type: 'number',
            description: 'Denoise strength 0.1-1.0. Lower keeps more of the sketch geometry (default 0.45).',
          },
          output_name: {
            type: 'string',
            description: 'Optional file name stem for the saved image.',
          },
          output_dir: {
            type: 'string',
            description: 'Optional custom directory to write the image into.',
          },
        },
        output: {
        render: (_args, value) => renderToolOutput(value),
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              summary: { type: 'string' },
              path: { type: 'string' },
              url: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' },
              seed: { type: 'number' },
              provider: { type: 'string' },
              cost: { type: 'number' },
              format: { type: 'string' },
              attachment: { type: 'object', additionalProperties: true },
              inputFormat: { type: 'string' },
              strength: { type: 'number' },
            },
          },
        },
        async execute(args, exec) {
          try {
            const cfg = live()
            trackAndAssertLoopGuard(exec?.agent?.session?.id || 'default', { limit: cfg.loopGuardLimit })
            const estimated = calculateGenerationCost({
              provider: cfg.provider || 'fal',
              model: cfg.model,
              size: cfg.defaultSize || 'square_hd',
              count: 1,
            })
            assertBudgetAvailable(estimated, cfg.dailyBudgetUsd)

            const source = await resolveConversationImage(ctx, exec, args.image)
            if (!source?.bytes) {
              throw new Error('sketch_to_image: no sketch image resolved. Provide image path/attachment id or attach a sketch in the conversation.')
            }
            const svg = isSvgSource(source)
            if (svg) {
              // Normalize media type so providers that accept SVG get a correct data URL.
              source.mediaType = 'image/svg+xml'
            }

            const vision = await analyzeImageWithVision(ctx, exec, source)
            let effectivePrompt = `${args.prompt}\n\n${SKETCH_PROMPT_SUFFIX}`
            if (vision.available && vision.summary) {
              effectivePrompt += `\nSketch content: ${vision.summary}`
            }

            const provider = cfg.provider || 'fal'
            const pdeps = {
              fetchImpl: fetch,
              resolveKey: (ref) => resolveApiKey(ctx, ref),
              cfg,
            }
            const seed = Math.floor(Math.random() * 100000)
            const strength = args.strength ?? 0.45
            const format = cfg.defaultFormat || 'png'
            const size = cfg.defaultSize || 'square_hd'

            const job = {
              prompt: effectivePrompt,
              size,
              format,
              seed,
              source,
              strength,
              provider,
              signal: exec?.signal,
            }
            const providers = makeProviders(pdeps, job)
            const fn = providers[provider] || providers.fal || providers.custom
            const gen = await fn(seed, effectivePrompt)

            const stem = args.output_name ? slugify(args.output_name) : `sketch-${seed}`
            const name = `${stem}.${format}`
            const result = await saveAndAttachResult(ctx, exec, cfg, {
              bytes: gen.bytes,
              mediaType: gen.mediaType || 'image/png',
              name,
              stem,
              prompt: args.prompt,
              size,
              format,
              seed: gen.seed ?? seed,
              provider,
              model: cfg.model,
              cost: gen.cost,
              sourceUrl: gen.sourceUrl,
              deliverAs: cfg.deliverAs || 'both',
              args,
              action: 'sketch_to_image',
            })
            result.inputFormat = svg ? 'svg' : String(source.mediaType || 'image/png')
            result.strength = strength
            if (vision.summary) result.visionAnalysis = vision.summary
            return toLosslessJson(result)
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool sketch_to_image')
}
