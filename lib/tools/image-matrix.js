// @ts-check
// image-matrix.js — generate_image_matrix tool (#461).
// Batch image variation matrix with deterministic seed/cfg exploration and unified contact sheet.

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
import { assertBudgetAvailable, calculateGenerationCost, reserveSpend } from '../cost-meter.js'
import { resolveInside } from '../security.js'
import {
  buildVariationPlan,
  compositeContactSheet,
  formatImageMatrixMarkdown,
} from '../image-matrix-helpers.js'

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

export function registerImageMatrixTools(ctx, deps) {
  const {
    live,
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_image_matrix',
        description:
          'Generate a batch variation matrix (4 or 9 variants) for a single prompt with deterministic seed or CFG exploration. '
          + 'Composites all variations into a unified Contact Sheet preview grid with numbered tiles for instant visual selection (#461).',
        parameters: {
          prompt: {
            type: 'string',
            required: true,
            description: 'Core subject or scene description to generate variations for.',
          },
          count: {
            type: 'integer',
            enum: [4, 9],
            description: 'Number of matrix variations to generate: 4 (2×2 grid) or 9 (3×3 grid). Default: 4.',
          },
          vary: {
            type: 'string',
            enum: ['seed', 'cfg'],
            description: 'Parameter to explore across variations: "seed" (deterministic random seeds) or "cfg" (guidance scale range). Default: "seed".',
          },
          base_seed: {
            type: 'integer',
            description: 'Optional base seed for reproducible variation exploration.',
          },
          guidance_scale: {
            type: 'number',
            description: 'Base prompt adherence guidance scale (default: 7.0).',
          },
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '16:9', '4:3', '3:4'],
            description: 'Aspect ratio for all matrix tiles (default: 1:1).',
          },
          style: {
            type: 'string',
            description: 'Optional style preset or aesthetic modifier to apply to all variations.',
          },
          output_dir: {
            type: 'string',
            description: 'Optional custom directory path to save images into.',
          },
          output_name: {
            type: 'string',
            description: 'Optional stem name for generated artifacts.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              matrix_id: { type: 'string' },
              prompt: { type: 'string' },
              count: { type: 'integer' },
              vary: { type: 'string' },
              grid: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  rows: { type: 'integer' },
                  cols: { type: 'integer' },
                },
              },
              contact_sheet: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  path: { type: 'string' },
                  url: { type: 'string' },
                  width: { type: 'integer' },
                  height: { type: 'integer' },
                  attachment: { type: 'object', additionalProperties: true },
                },
              },
              manifest_path: { type: 'string' },
              variants: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    id: { type: 'string' },
                    index: { type: 'integer' },
                    seed: { type: 'integer' },
                    guidanceScale: { type: 'number' },
                    path: { type: 'string' },
                    url: { type: 'string' },
                    width: { type: 'integer' },
                    height: { type: 'integer' },
                    attachment: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
          render(args, value) {
            const summary = formatImageMatrixMarkdown({
              prompt: value.prompt,
              count: value.count,
              vary: value.vary,
              contactSheetUrl: value.contact_sheet?.url,
              variants: value.variants || [],
            })
            const metaTag = `<dsh-image-gen-matrix>${JSON.stringify({
              matrix_id: value.matrix_id,
              count: value.count,
              vary: value.vary,
              contact_sheet: value.contact_sheet?.url,
              variants: value.variants?.map((v) => ({ id: v.id, seed: v.seed, cfg: v.guidanceScale })),
            })}</dsh-image-gen-matrix>`
            return [{ type: 'text', text: `${summary}\n\n${metaTag}` }]
          },
          presentationMeta(args, value) {
            return {
              matrix_id: value.matrix_id,
              prompt: value.prompt,
              count: value.count,
              vary: value.vary,
              contact_sheet: value.contact_sheet,
              variants: value.variants || [],
            }
          },
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
          const cfg = live()
          if (cfg.enabled === false) {
            throw new Error('Image generation is disabled in settings (dsh-image-gen.enabled is false); enable it in Settings → Image generation.')
          }

          const rawPrompt = String(args.prompt || '').trim()
          if (!rawPrompt) throw new Error('Parameter "prompt" is required.')

          const effectivePrompt = args.style
            ? `${rawPrompt}, ${args.style} style`
            : rawPrompt

          const count = Number(args.count) === 9 ? 9 : 4
          const vary = args.vary === 'cfg' ? 'cfg' : 'seed'
          const aspectRatio = args.aspect_ratio || '1:1'
          const aspectPixels = ASPECT_RATIOS[aspectRatio] || [1024, 1024]
          const [tileW, tileH] = aspectPixels

          const plan = buildVariationPlan({
            prompt: effectivePrompt,
            count,
            vary,
            baseSeed: args.base_seed,
            baseCfg: args.guidance_scale || 7.0,
          })

          const provider = PROVIDER_KEYS.includes(cfg.provider) ? cfg.provider : 'fal'
          let subscriptionImages
          try {
            subscriptionImages = ctx.get && ctx.get('subscriptionImages')
          } catch (_err) {
            subscriptionImages = undefined
          }

          const estimatedCost = calculateGenerationCost({
            provider,
            model: cfg.model || cfg.customModel || 'default',
            size: `${tileW}x${tileH}`,
            count,
          })
          const batchReservation = reserveSpend(estimatedCost, cfg.dailyBudgetUsd)
          let committed = false

          try {
            const chain = resolveFallbackChain(provider, cfg.fallbackProviders, PROVIDER_KEYS)
            const matrixId = `matrix-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

            const sessionCwd = exec?.agent?.session?.header?.cwd
            const targetDir = args.output_dir || cfg.outputDir || 'generated/images'
            const outDir = resolveInside(sessionCwd || process.cwd(), targetDir)
            await mkdir(outDir, { recursive: true })

            const nameStem = args.output_name
              ? slugify(args.output_name)
              : slugify(`matrix-${vary}-${rawPrompt.slice(0, 32)}`)

            // 1. Generate individual variants in parallel with concurrency 2
            const tasks = plan.variants.map((v) => async () => {
              const providers = makeProviders(
                { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
                {
                  prompt: effectivePrompt,
                  size: 'custom',
                  format: 'png',
                  seed: v.seed,
                  guidanceScale: v.guidanceScale,
                  signal: exec?.signal,
                  aspectPixels,
                  aspectRatio,
                },
              )

              const gen = await executeWithFallback(providers, chain, v.seed, effectivePrompt, {
                logger: ctx.logger,
              })

              const filename = `${nameStem}-${v.id}-${v.seed}.png`
              const { attachment, localUrl } = await saveAttachmentSafe(ctx, {
                bytes: gen.bytes,
                mediaType: 'image/png',
                name: filename,
              })

              const cellCost = Number(gen.cost) || +(estimatedCost / count).toFixed(4)
              batchReservation.commit(cellCost, {
                ctx,
                meta: { provider, model: cfg.model || cfg.customModel, prompt: effectivePrompt, seed: v.seed },
              })

              const filePath = path.join(outDir, filename)
              await writeFile(filePath, gen.bytes)

              // Write sidecar JSON
              await writeFile(
                path.join(outDir, `${nameStem}-${v.id}-${v.seed}.json`),
                JSON.stringify(
                  buildSidecar({
                    prompt: effectivePrompt,
                    size: `${gen.width || tileW}x${gen.height || tileH}`,
                    format: 'png',
                    seed: v.seed,
                    provider: gen._fallback?.providerUsed || provider,
                    deliverAs: cfg.deliverAs || 'link',
                    width: gen.width || tileW,
                    height: gen.height || tileH,
                    mediaType: 'image/png',
                    attachmentId: attachment?.attachmentId,
                    url: localUrl,
                    cost: gen.cost,
                    guidanceScale: v.guidanceScale,
                    matrix_id: matrixId,
                    variant_id: v.id,
                  }),
                  null,
                  2,
                ),
              )

              return {
                id: v.id,
                index: v.index,
                seed: v.seed,
                guidanceScale: v.guidanceScale,
                label: v.label,
                bytes: gen.bytes,
                path: filePath,
                url: localUrl,
                width: gen.width || tileW,
                height: gen.height || tileH,
                attachment,
                cost: gen.cost,
              }
            })

            const cells = await asyncPool(tasks, 2)

            // 2. Composite unified Contact Sheet
            const sheetBytes = await compositeContactSheet({
              tiles: cells.map((c) => ({ bytes: c.bytes, label: c.label })),
              tileWidth: tileW,
              tileHeight: tileH,
              rows: plan.gridRows,
              cols: plan.gridCols,
            })

            const sheetFilename = `${nameStem}-contact-sheet.png`
            const { attachment: sheetAttachment, localUrl: sheetUrl } = await saveAttachmentSafe(ctx, {
              bytes: sheetBytes,
              mediaType: 'image/png',
              name: sheetFilename,
            })

            const sheetFilePath = path.join(outDir, sheetFilename)
            await writeFile(sheetFilePath, sheetBytes)

            // 3. Write session manifest for programmatic variant selection
            const manifestPath = path.join(outDir, `${matrixId}-manifest.json`)
            const manifest = {
              matrix_id: matrixId,
              prompt: effectivePrompt,
              count,
              vary,
              grid: { rows: plan.gridRows, cols: plan.gridCols },
              contact_sheet: {
                path: sheetFilePath,
                url: sheetUrl,
                width: plan.gridCols * tileW,
                height: plan.gridRows * tileH,
                attachment: sheetAttachment,
              },
              created_at: new Date().toISOString(),
              variants: cells.map((c) => ({
                id: c.id,
                index: c.index,
                seed: c.seed,
                guidanceScale: c.guidanceScale,
                path: c.path,
                url: c.url,
                width: c.width,
                height: c.height,
                attachment: c.attachment,
              })),
            }
            await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

            committed = true
            return toLosslessJson({
              matrix_id: matrixId,
              prompt: effectivePrompt,
              count,
              vary,
              grid: { rows: plan.gridRows, cols: plan.gridCols },
              contact_sheet: {
                path: sheetFilePath,
                url: sheetUrl,
                width: plan.gridCols * tileW,
                height: plan.gridRows * tileH,
                attachment: sheetAttachment,
              },
              manifest_path: manifestPath,
              variants: manifest.variants,
            })
          } finally {
            if (!committed) {
              batchReservation.release()
            }
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool generate_image_matrix')
}

