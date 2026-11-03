// @ts-check
// model-matrix.js — compare_models_matrix tool (#503).
// Multi-model shootout comparison matrix tool: concurrently generates across multiple
// providers/models with target settings adapters and Sharp contact sheet compositing.

import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  PROVIDER_KEYS,
  buildSidecar,
  makeProviders,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { calculateGenerationCost, reserveSpend } from '../cost-meter.js'
import { resolveInside } from '../security.js'
import {
  buildComparisonTargets,
  compositeModelMatrixContactSheet,
  formatModelMatrixMarkdown,
} from '../model-matrix-helpers.js'

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

export function registerModelMatrixTools(ctx, deps) {
  const {
    live,
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'compare_models_matrix',
        description:
          'Run a multi-model shootout comparison matrix for a single prompt across multiple AI image generation models and providers concurrently. '
          + 'Adapts aspect ratios to each target, measures execution latency and cost, composites a side-by-side contact sheet with model badges, and formats a markdown comparison table (#503).',
        parameters: {
          prompt: {
            type: 'string',
            required: true,
            description: 'Core subject or scene description to generate across models.',
          },
          models: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of models to benchmark (e.g. ["fal/flux-dev", "gemini/imagen-3", "replicate/flux-schnell", "seedream/seedream-3"]). If omitted, tests top active providers.',
          },
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
            description: 'Requested aspect ratio. Individual targets adapt automatically if unsupported (default: 1:1).',
          },
          seed: {
            type: 'integer',
            description: 'Optional common seed for deterministic fair comparison.',
          },
          guidance_scale: {
            type: 'number',
            description: 'Optional prompt adherence scale (default: 7.0).',
          },
          style: {
            type: 'string',
            description: 'Optional style preset or modifier to apply across all model runs.',
          },
          concurrency: {
            type: 'integer',
            description: 'Maximum concurrent generation jobs (1-4, default: 2).',
          },
          output_dir: {
            type: 'string',
            description: 'Optional custom output directory path.',
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
              shootout_id: { type: 'string' },
              prompt: { type: 'string' },
              totalDurationMs: { type: 'number' },
              modelsCount: { type: 'integer' },
              successCount: { type: 'integer' },
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
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    id: { type: 'string' },
                    provider: { type: 'string' },
                    model: { type: 'string' },
                    label: { type: 'string' },
                    success: { type: 'boolean' },
                    durationMs: { type: 'number' },
                    cost: { type: 'number' },
                    path: { type: 'string' },
                    url: { type: 'string' },
                    width: { type: 'integer' },
                    height: { type: 'integer' },
                    error: { type: 'string' },
                    attachment: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
          render(args, value) {
            const summary = formatModelMatrixMarkdown({
              prompt: value.prompt,
              totalDurationMs: value.totalDurationMs || 0,
              contactSheetUrl: value.contact_sheet?.url,
              results: value.results || [],
            })
            const metaTag = `<dsh-image-gen-shootout>${JSON.stringify({
              shootout_id: value.shootout_id,
              modelsCount: value.modelsCount,
              successCount: value.successCount,
              contact_sheet: value.contact_sheet?.url,
              results: value.results?.map((r) => ({
                id: r.id,
                label: r.label,
                provider: r.provider,
                model: r.model,
                success: r.success,
                durationMs: r.durationMs,
                cost: r.cost,
              })),
            })}</dsh-image-gen-shootout>`
            return [{ type: 'text', text: `${summary}\n\n${metaTag}` }]
          },
          presentationMeta(args, value) {
            return {
              shootout_id: value.shootout_id,
              prompt: value.prompt,
              totalDurationMs: value.totalDurationMs,
              contact_sheet: value.contact_sheet,
              results: value.results || [],
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

          const commonSeed = args.seed !== undefined && args.seed !== null
            ? Math.abs(parseInt(String(args.seed), 10))
            : Math.floor(Math.random() * 1000000)

          const targets = buildComparisonTargets({
            models: args.models,
            requestedRatio: args.aspect_ratio || '1:1',
            cfg,
          })

          if (targets.length === 0) {
            throw new Error('No valid model comparison targets available.')
          }

          let subscriptionImages
          try {
            subscriptionImages = ctx.get && ctx.get('subscriptionImages')
          } catch (_err) {
            subscriptionImages = undefined
          }

          const shootoutId = `shootout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
          const sessionCwd = exec?.agent?.session?.header?.cwd
          const targetDir = args.output_dir || cfg.outputDir || 'generated/images'
          const outDir = resolveInside(sessionCwd || process.cwd(), targetDir)
          await mkdir(outDir, { recursive: true })

          const nameStem = args.output_name
            ? slugify(args.output_name)
            : slugify(`shootout-${rawPrompt.slice(0, 32)}`)

          const startTime = Date.now()

          // Execute each target in parallel pool
          const tasks = targets.map((target) => async () => {
            const targetStart = Date.now()
            const [tileW, tileH] = target.aspectPixels
            const targetCfg = {
              ...cfg,
              provider: target.provider,
              model: target.model,
              customModel: target.model,
              replicateModel: target.model,
            }

            const estimatedCost = calculateGenerationCost({
              provider: target.provider,
              model: target.model,
              size: `${tileW}x${tileH}`,
              count: 1,
            })
            const reservation = reserveSpend(estimatedCost, cfg.dailyBudgetUsd)

            try {
              const providers = makeProviders(
                {
                  fetchImpl: fetch,
                  resolveKey: (ref) => resolveApiKey(ctx, ref),
                  cfg: targetCfg,
                  subscriptionImages,
                },
                {
                  prompt: effectivePrompt,
                  size: 'custom',
                  format: 'png',
                  seed: commonSeed,
                  guidanceScale: args.guidance_scale || 7.0,
                  signal: exec?.signal,
                  aspectPixels: target.aspectPixels,
                  aspectRatio: target.ratio,
                },
              )

              const generator = providers[target.provider]
              if (!generator) {
                throw new Error(`Provider "${target.provider}" is not available or supported.`)
              }

              const gen = await generator(commonSeed, effectivePrompt)
              const durationMs = Date.now() - targetStart

              const filename = `${nameStem}-${target.provider}-${slugify(target.model)}-${commonSeed}.png`
              const { attachment, localUrl } = await saveAttachmentSafe(ctx, {
                bytes: gen.bytes,
                mediaType: 'image/png',
                name: filename,
              })

              const actualCost = Number(gen.cost) || estimatedCost
              reservation.commit(actualCost, {
                ctx,
                meta: { provider: target.provider, model: target.model, prompt: effectivePrompt, seed: commonSeed },
              })

              const filePath = path.join(outDir, filename)
              await writeFile(filePath, gen.bytes)

              // Write sidecar JSON
              await writeFile(
                path.join(outDir, `${nameStem}-${target.provider}-${slugify(target.model)}-${commonSeed}.json`),
                JSON.stringify(
                  buildSidecar({
                    prompt: effectivePrompt,
                    size: `${gen.width || tileW}x${gen.height || tileH}`,
                    format: 'png',
                    seed: commonSeed,
                    provider: target.provider,
                    model: target.model,
                    deliverAs: cfg.deliverAs || 'link',
                    width: gen.width || tileW,
                    height: gen.height || tileH,
                    mediaType: 'image/png',
                    attachmentId: attachment?.attachmentId,
                    url: localUrl,
                    cost: actualCost,
                    shootout_id: shootoutId,
                    shootout_label: target.label,
                    durationMs,
                  }),
                  null,
                  2,
                ),
              )

              return {
                id: target.id,
                provider: target.provider,
                model: target.model,
                label: target.label,
                success: true,
                durationMs,
                cost: actualCost,
                bytes: gen.bytes,
                path: filePath,
                url: localUrl,
                width: gen.width || tileW,
                height: gen.height || tileH,
                attachment,
              }
            } catch (err) {
              const durationMs = Date.now() - targetStart
              reservation.release()
              return {
                id: target.id,
                provider: target.provider,
                model: target.model,
                label: target.label,
                success: false,
                durationMs,
                cost: 0,
                error: err.message || String(err),
              }
            }
          })

          const poolConcurrency = Math.max(1, Math.min(4, Number(args.concurrency) || 2))
          const results = await asyncPool(tasks, poolConcurrency)
          const totalDurationMs = Date.now() - startTime

          const successfulTiles = results.filter((r) => r.success && r.bytes)
          let contactSheet = null

          if (successfulTiles.length >= 2) {
            try {
              const sheetBytes = await compositeModelMatrixContactSheet({
                tiles: successfulTiles.map((t) => ({
                  bytes: t.bytes,
                  label: t.label,
                  durationMs: t.durationMs,
                  cost: t.cost,
                })),
                tileWidth: 512,
                tileHeight: 512,
              })

              const sheetFilename = `${nameStem}-shootout-matrix.png`
              const { attachment: sheetAttachment, localUrl: sheetUrl } = await saveAttachmentSafe(ctx, {
                bytes: sheetBytes,
                mediaType: 'image/png',
                name: sheetFilename,
              })

              const sheetFilePath = path.join(outDir, sheetFilename)
              await writeFile(sheetFilePath, sheetBytes)

              contactSheet = {
                path: sheetFilePath,
                url: sheetUrl,
                attachment: sheetAttachment,
              }
            } catch (err) {
              ctx.logger?.warn?.(`[model-matrix] Failed to composite contact sheet: ${err.message}`)
            }
          }

          // Write session shootout manifest
          const manifestPath = path.join(outDir, `${shootoutId}-manifest.json`)
          const manifest = {
            shootout_id: shootoutId,
            prompt: effectivePrompt,
            seed: commonSeed,
            totalDurationMs,
            modelsCount: targets.length,
            successCount: successfulTiles.length,
            contact_sheet: contactSheet,
            created_at: new Date().toISOString(),
            results: results.map((r) => ({
              id: r.id,
              provider: r.provider,
              model: r.model,
              label: r.label,
              success: r.success,
              durationMs: r.durationMs,
              cost: r.cost,
              path: r.path,
              url: r.url,
              error: r.error,
            })),
          }
          await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

          return toLosslessJson({
            shootout_id: shootoutId,
            prompt: effectivePrompt,
            totalDurationMs,
            modelsCount: targets.length,
            successCount: successfulTiles.length,
            contact_sheet: contactSheet,
            manifest_path: manifestPath,
            results,
          })
        },
      }),
    )
  }, 'dsh-image-gen: tool compare_models_matrix')
}
