// style-matrix.js — generate_style_matrix tool (#286).
// Parallel 2×2 style matrix explorer with blind A/B compare and one-click preset selection.

import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  ASPECT_RATIOS,
  PROVIDER_KEYS,
  buildSidecar,
  makeProviders,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { resolveFallbackChain, executeWithFallback } from '../fallback-router.js'
import {
  normalizeMatrixStyles,
  buildMatrixCellPrompt,
  formatMatrixMarkdown,
} from '../style-matrix-helpers.js'

async function asyncPool(tasks, concurrency = 2) {
  const results = new Array(tasks.length)
  let nextIdx = 0
  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++
      results[idx] = await tasks[idx]()
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results
}

export function registerStyleMatrixTools(ctx, deps) {
  const {
    live,
    slugify,
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_style_matrix',
        description:
          'Generate a 2×2 visual style exploration matrix for a single subject or concept. '
          + 'Renders 4 distinct artistic styles in parallel for rapid comparison or blind evaluation.',
        parameters: {
          prompt: {
            type: 'string',
            required: true,
            description: 'Core subject or scene description to benchmark across styles, e.g. "a lone astronaut sitting on Mars campfire".',
          },
          styles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional array of 4 style presets to compare. Defaults to: editorial_photo, flat_vector, clay_3d, cyberpunk.',
          },
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '16:9', '4:3', '3:4'],
            description: 'Aspect ratio for all matrix cells (default: 1:1).',
          },
          blind_mode: {
            type: 'boolean',
            description: 'When true, masks style names in the initial view to facilitate unbiased visual judging.',
          },
          seed: {
            type: 'integer',
            description: 'Base seed for the matrix generations.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              matrix_id: { type: 'string' },
              base_prompt: { type: 'string' },
              blind_mode: { type: 'boolean' },
              cells: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    id: { type: 'string' },
                    style: { type: 'string' },
                    path: { type: 'string' },
                    url: { type: 'string' },
                    seed: { type: 'integer' },
                    width: { type: 'integer' },
                    height: { type: 'integer' },
                    attachment: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
          render(args, value) {
            const summary = formatMatrixMarkdown({
              basePrompt: value.base_prompt,
              blindMode: value.blind_mode,
              cells: value.cells || [],
            })
            return [{ type: 'text', text: summary }]
          },
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
          const cfg = live()
          if (cfg.enabled === false) {
            throw new Error('Image generation is disabled in settings.')
          }

          const basePrompt = String(args.prompt || '').trim()
          if (!basePrompt) throw new Error('Parameter "prompt" is required.')

          const activeStyles = normalizeMatrixStyles(args.styles)
          const aspectRatio = args.aspect_ratio || '1:1'
          const aspectPixels = ASPECT_RATIOS[aspectRatio] || [1024, 1024]
          const blindMode = Boolean(args.blind_mode)
          const baseSeed = args.seed ?? Math.floor(Math.random() * 100000)

          const provider = PROVIDER_KEYS.includes(cfg.provider) ? cfg.provider : 'fal'
          let subscriptionImages
          try { subscriptionImages = ctx.get && ctx.get('subscriptionImages') } catch { subscriptionImages = undefined }

          const chain = resolveFallbackChain(provider, cfg.fallbackProviders, PROVIDER_KEYS)
          const quadrantIds = ['A', 'B', 'C', 'D']
          const matrixId = `matrix-${Date.now().toString(36)}`

          const sessionCwd = exec.agent?.session?.header?.cwd
          const targetDir = cfg.outputDir || 'generated/images'
          const outDir = path.resolve(sessionCwd || process.cwd(), targetDir)
          await mkdir(outDir, { recursive: true })

          const tasks = activeStyles.map((styleName, idx) => async () => {
            const quadrantId = quadrantIds[idx] || `Q${idx + 1}`
            const cellSeed = baseSeed + idx * 1013
            const cellPrompt = buildMatrixCellPrompt(basePrompt, styleName)

            const providers = makeProviders(
              { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
              {
                prompt: cellPrompt,
                size: 'custom',
                format: 'png',
                seed: cellSeed,
                signal: exec.signal,
                aspectPixels,
                aspectRatio,
              },
            )

            const gen = await executeWithFallback(providers, chain, cellSeed, cellPrompt, {
              logger: ctx.logger,
            })

            const stem = `${slugify(`matrix-${styleName}-${basePrompt}`)}-${Date.now().toString(36)}-${cellSeed}`
            const filename = `${stem}.png`
            const { attachment, localUrl } = await saveAttachmentSafe(ctx, {
              bytes: gen.bytes,
              mediaType: 'image/png',
              name: filename,
            })

            const filePath = path.join(outDir, filename)
            await writeFile(filePath, gen.bytes)

            await writeFile(
              path.join(outDir, `${stem}.json`),
              JSON.stringify(buildSidecar({
                prompt: cellPrompt,
                size: `${gen.width || aspectPixels[0]}x${gen.height || aspectPixels[1]}`,
                format: 'png',
                seed: cellSeed,
                provider: gen._fallback?.providerUsed || provider,
                deliverAs: cfg.deliverAs || 'link',
                width: gen.width || aspectPixels[0],
                height: gen.height || aspectPixels[1],
                mediaType: 'image/png',
                attachmentId: attachment.attachmentId,
                url: localUrl,
                cost: gen.cost,
              }), null, 2),
            )

            return {
              id: quadrantId,
              index: idx,
              style: styleName,
              prompt: cellPrompt,
              seed: cellSeed,
              path: filePath,
              url: localUrl,
              width: gen.width || aspectPixels[0],
              height: gen.height || aspectPixels[1],
              attachment,
              cost: gen.cost,
            }
          })

          const cells = await asyncPool(tasks, 2)

          const summary = formatMatrixMarkdown({
            basePrompt,
            blindMode,
            cells,
          })

          return toLosslessJson({
            matrix_id: matrixId,
            base_prompt: basePrompt,
            blind_mode: blindMode,
            aspect_ratio: aspectRatio,
            cells,
            summary,
          })
        },
      }),
    )
  }, 'dsh-image-gen: tool generate_style_matrix')
}
