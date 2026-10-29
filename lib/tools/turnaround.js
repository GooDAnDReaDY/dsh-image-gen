// @ts-check
// turnaround.js — generate_turnaround_sheet tool (#464).
// Multi-angle turnaround sheet generator for 3D, gamedev, and product assets.

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
  DEFAULT_TURNAROUND_ANGLES,
  ALL_SUPPORTED_ANGLES,
  buildTurnaroundPrompt,
  sliceTurnaroundSheet,
  formatTurnaroundMarkdown,
} from '../turnaround-helpers.js'

export function registerTurnaroundTools(ctx, deps) {
  const {
    live,
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_turnaround_sheet',
        description:
          'Generate multi-angle synchronized turnaround model sheets for characters, props, and 3D assets. '
          + 'Automatically slices the generated sheet into individual perspective files (front, side, back, isometric) with matching scale (#464).',
        parameters: {
          prompt: {
            type: 'string',
            required: true,
            description: 'Core subject description to generate turnaround angles for (e.g. "cyberpunk female ninja with dual cyber-blades").',
          },
          subject_type: {
            type: 'string',
            enum: ['character', 'prop', 'vehicle', 'creature'],
            description: 'Asset category for pose alignment: "character" (T/A pose), "prop", "vehicle", or "creature". Default: "character".',
          },
          angles: {
            type: 'array',
            items: { type: 'string', enum: ALL_SUPPORTED_ANGLES },
            description: 'List of perspective angles to include: front, side, back, three_quarter, iso_45, top. Default: ["front", "side", "back", "three_quarter"].',
          },
          seed: {
            type: 'integer',
            description: 'Optional seed for reproducible synthesis.',
          },
          style: {
            type: 'string',
            description: 'Optional style preset or aesthetic modifier (e.g. "game concept art", "cel shaded anime", "clay 3d").',
          },
          output_dir: {
            type: 'string',
            description: 'Optional custom directory path to save model sheet and slices into.',
          },
          output_name: {
            type: 'string',
            description: 'Optional custom filename stem.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              prompt: { type: 'string' },
              subject_type: { type: 'string' },
              angles: {
                type: 'array',
                items: { type: 'string' },
              },
              seed: { type: 'integer' },
              sheet: {
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
              slices: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    angle: { type: 'string' },
                    index: { type: 'integer' },
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
            const summary = formatTurnaroundMarkdown({
              prompt: value.prompt,
              subjectType: value.subject_type,
              angles: value.angles || [],
              sheetUrl: value.sheet?.url,
              slices: value.slices || [],
              manifestPath: value.manifest_path,
            })
            const metaTag = `<dsh-image-gen-turnaround>${JSON.stringify({
              subject_type: value.subject_type,
              angles: value.angles,
              sheet_url: value.sheet?.url,
              slices: value.slices?.map((s) => ({ angle: s.angle, path: s.path })),
            })}</dsh-image-gen-turnaround>`
            return [{ type: 'text', text: `${summary}\n\n${metaTag}` }]
          },
          presentationMeta(args, value) {
            return {
              prompt: value.prompt,
              subject_type: value.subject_type,
              angles: value.angles,
              sheet: value.sheet,
              slices: value.slices || [],
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

          const subjectType = args.subject_type || 'character'
          const angles = Array.isArray(args.angles) && args.angles.length >= 2
            ? args.angles
            : DEFAULT_TURNAROUND_ANGLES

          const effectivePrompt = buildTurnaroundPrompt({
            prompt: rawPrompt,
            subjectType,
            angles,
            style: args.style,
          })

          // Wide aspect ratio for horizontal multi-view row
          const aspectPixels = [1536, 864]
          const seed = args.seed ?? Math.floor(Math.random() * 100000)

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
            size: '1536x864',
            count: 1,
          })
          const reservation = reserveSpend(estimatedCost, cfg.dailyBudgetUsd)
          let committed = false

          try {
            const chain = resolveFallbackChain(provider, cfg.fallbackProviders, PROVIDER_KEYS)
            const sessionCwd = exec?.agent?.session?.header?.cwd
            const targetDir = args.output_dir || cfg.outputDir || 'generated/images'
            const outDir = resolveInside(sessionCwd || process.cwd(), targetDir)
            await mkdir(outDir, { recursive: true })

            const nameStem = args.output_name
              ? slugify(args.output_name)
              : slugify(`turnaround-${subjectType}-${rawPrompt.slice(0, 28)}`)

            // 1. Generate panoramic model sheet
            const providers = makeProviders(
              { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
              {
                prompt: effectivePrompt,
                size: 'custom',
                format: 'png',
                seed,
                signal: exec?.signal,
                aspectPixels,
                aspectRatio: '16:9',
              },
            )

            const gen = await executeWithFallback(providers, chain, seed, effectivePrompt, {
              logger: ctx.logger,
            })

            const sheetFilename = `${nameStem}-turnaround-sheet-${seed}.png`
            const { attachment: sheetAttachment, localUrl: sheetUrl } = await saveAttachmentSafe(ctx, {
              bytes: gen.bytes,
              mediaType: 'image/png',
              name: sheetFilename,
            })

            const effectiveCost = Number(gen.cost) || estimatedCost
            reservation.commit(effectiveCost, {
              ctx,
              meta: { provider, model: cfg.model || cfg.customModel, prompt: effectivePrompt, seed },
            })

            const sheetFilePath = path.join(outDir, sheetFilename)
            await writeFile(sheetFilePath, gen.bytes)

            // 2. Automatically slice turnaround sheet into angle files
            const extractedSlices = await sliceTurnaroundSheet({
              sheetBuffer: gen.bytes,
              angles,
            })

            const savedSlices = []
            for (const s of extractedSlices) {
              const sliceFilename = `${nameStem}-${s.angle}-${seed}.png`
              const { attachment: sliceAttachment, localUrl: sliceUrl } = await saveAttachmentSafe(ctx, {
                bytes: s.buffer,
                mediaType: 'image/png',
                name: sliceFilename,
              })

              const slicePath = path.join(outDir, sliceFilename)
              await writeFile(slicePath, s.buffer)

              savedSlices.push({
                angle: s.angle,
                index: s.index,
                path: slicePath,
                url: sliceUrl,
                width: s.width,
                height: s.height,
                attachment: sliceAttachment,
              })
            }

            // 3. Save model sheet manifest JSON
            const manifestPath = path.join(outDir, `${nameStem}-${seed}-manifest.json`)
            const manifest = {
              prompt: rawPrompt,
              effective_prompt: effectivePrompt,
              subject_type: subjectType,
              angles,
              seed,
              provider: gen._fallback?.providerUsed || provider,
              sheet: {
                path: sheetFilePath,
                url: sheetUrl,
                width: gen.width || aspectPixels[0],
                height: gen.height || aspectPixels[1],
              },
              slices: savedSlices.map((s) => ({
                angle: s.angle,
                index: s.index,
                width: s.width,
                height: s.height,
                path: s.path,
                url: s.url,
              })),
              created_at: new Date().toISOString(),
            }
            await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

            // 4. Save sidecar JSON for the master sheet
            await writeFile(
              path.join(outDir, `${nameStem}-turnaround-sheet-${seed}.json`),
              JSON.stringify(
                buildSidecar({
                  prompt: effectivePrompt,
                  size: `${gen.width || aspectPixels[0]}x${gen.height || aspectPixels[1]}`,
                  format: 'png',
                  seed,
                  provider: gen._fallback?.providerUsed || provider,
                  deliverAs: cfg.deliverAs || 'link',
                  width: gen.width || aspectPixels[0],
                  height: gen.height || aspectPixels[1],
                  mediaType: 'image/png',
                  attachmentId: sheetAttachment?.attachmentId,
                  url: sheetUrl,
                  cost: gen.cost,
                  subject_type: subjectType,
                  angles,
                  manifest_path: manifestPath,
                }),
                null,
                2,
              ),
            )

            committed = true
            return toLosslessJson({
              prompt: rawPrompt,
              subject_type: subjectType,
              angles,
              seed,
              sheet: {
                path: sheetFilePath,
                url: sheetUrl,
                width: gen.width || aspectPixels[0],
                height: gen.height || aspectPixels[1],
                attachment: sheetAttachment,
              },
              manifest_path: manifestPath,
              slices: savedSlices,
            })
          } finally {
            if (!committed) {
              reservation.release()
            }
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool generate_turnaround_sheet')
}

