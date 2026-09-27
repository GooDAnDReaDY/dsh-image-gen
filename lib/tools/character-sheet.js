// character-sheet.js — generate_character_sheet tool (#181).
// Generates multi-angle character model sheets and turnarounds with visual consistency.

import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  ASPECT_RATIOS,
  buildSidecar,
  makeProviders,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { resolveFallbackChain, executeWithFallback } from '../fallback-router.js'
import { renderToolOutput } from '../attachment-helper.js'
import {
  CHARACTER_SHEET_LAYOUTS,
  CHARACTER_SHEET_STYLES,
  buildCharacterSheetPrompt,
} from '../character-sheet-helpers.js'

export function registerCharacterSheetTools(ctx, deps) {
  const {
    live,
    slugify,
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_character_sheet',
        description:
          'Generate a multi-angle character model sheet or turnaround reference with high visual identity consistency. '
          + 'Supports horizontal turnarounds (front, profile, 3/4, back), 1x3 triptychs, 2x2 grids, and facial emotion sheets across concept, anime, 3D, and comic styles.',
        parameters: {
          prompt: {
            type: 'string',
            description: 'Core character description (e.g. "female cyborg detective with neon violet hair, yellow trenchcoat, cybernetic arm").',
          },
          layout: {
            type: 'string',
            enum: ['turnaround', '1x3', '2x2', 'emotions'],
            description: 'Layout arrangement: "turnaround" (4 sequential horizontal views), "1x3" (front, side, back), "2x2" (quad angles), or "emotions" (4 facial expressions). Default: turnaround.',
          },
          style: {
            type: 'string',
            enum: ['concept_art', 'anime', '3d_animation', 'pixel_art', 'realistic', 'comic'],
            description: 'Artistic rendering style. Default: concept_art.',
          },
          negativePrompt: {
            type: 'string',
            description: 'Negative prompt directives to suppress unwanted elements.',
          },
          seed: {
            type: 'integer',
            description: 'RNG seed for reproducible character generation across sessions.',
          },
          provider: {
            type: 'string',
            description: 'Optional provider override (e.g. fal, replicate, local). Defaults to active provider.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              prompt: { type: 'string' },
              layout: { type: 'string' },
              style: { type: 'string' },
              aspectRatio: { type: 'string' },
              views: {
                type: 'array',
                items: { type: 'string' },
              },
              seed: { type: 'integer' },
              provider: { type: 'string' },
              attachment: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  attachmentId: { type: 'string' },
                  url: { type: 'string' },
                  mediaType: { type: 'string' },
                  filename: { type: 'string' },
                  byteSize: { type: 'integer' },
                },
              },
            },
          },
          render: (result, renderCtx) =>
            renderToolOutput(result, renderCtx, {
              title: (res) => `Character Sheet (${res.layout || 'turnaround'}) — ${res.style || 'concept_art'}`,
              subtitle: (res) => (res.views ? `Views: ${res.views.join(' | ')}` : ''),
            }),
        },
        async execute(args, execCtx) {
          const cfg = live.value
          const activeProvider = args.provider || cfg.activeProvider || 'fal'
          const seed = typeof args.seed === 'number' ? args.seed : Math.floor(Math.random() * 2147483647)

          const sheetPlan = buildCharacterSheetPrompt({
            prompt: args.prompt,
            layout: args.layout,
            style: args.style,
            negativePrompt: args.negativePrompt,
          })

          const providers = makeProviders({
            fetchImpl: fetch,
            resolveKey: (id) => resolveApiKey(cfg, id),
            cfg,
          })

          const fallbackChain = resolveFallbackChain(activeProvider, cfg)

          const aspectPixels = ASPECT_RATIOS[sheetPlan.aspectRatio] || ASPECT_RATIOS['16:9']

          const jobPayload = {
            prompt: sheetPlan.prompt,
            negativePrompt: sheetPlan.negativePrompt,
            aspectRatio: sheetPlan.aspectRatio,
            aspectPixels,
            format: 'png',
            seed,
            quality: 'high',
          }

          const { result: genResult, provider: usedProvider } = await executeWithFallback(
            fallbackChain,
            providers,
            jobPayload,
            { signal: execCtx?.signal }
          )

          const timestamp = Date.now()
          const safeSlug = slugify(args.prompt.slice(0, 30)) || 'character-sheet'
          const filename = `character-sheet-${sheetPlan.layout}-${safeSlug}-${timestamp}.png`

          let attachment = null
          if (genResult.bytes) {
            const outDir = path.resolve(process.cwd(), cfg.outputDir || 'output')
            await mkdir(outDir, { recursive: true })
            const diskPath = path.join(outDir, filename)
            await writeFile(diskPath, Buffer.from(genResult.bytes))

            attachment = await saveAttachmentSafe(
              ctx,
              Buffer.from(genResult.bytes),
              'image/png',
              filename,
              diskPath
            )
          } else if (genResult.url) {
            attachment = {
              url: genResult.url,
              mediaType: 'image/png',
              filename,
            }
          }

          const response = {
            prompt: sheetPlan.prompt,
            characterDescription: args.prompt,
            layout: sheetPlan.layout,
            style: sheetPlan.style,
            aspectRatio: sheetPlan.aspectRatio,
            views: sheetPlan.views,
            seed,
            provider: usedProvider,
            attachment,
          }

          if (attachment?.attachmentId) {
            response.attachmentId = attachment.attachmentId
          }
          if (attachment?.url) {
            response.url = attachment.url
          }

          return response
        },
      })
    )
  }, 'dsh-image-gen: tool generate_character_sheet')
}
