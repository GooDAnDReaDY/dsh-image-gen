import { buildDualOutputMarkdown } from '../resolve-image.js'
// character-sheet.js — generate_character_sheet tool (#181, #358).
// Generates multi-angle character model sheets and turnarounds with visual consistency.

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
import { assertBudgetAvailable, calculateGenerationCost, reserveSpend, recordSpend } from '../cost-meter.js'
import { renderToolOutput } from '../attachment-helper.js'
import {
  CHARACTER_SHEET_LAYOUTS,
  CHARACTER_SHEET_STYLES,
  buildCharacterSheetPrompt,
} from '../character-sheet-helpers.js'

export function registerCharacterSheetTools(ctx, deps) {
  const {
    live,
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
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
              path: { type: 'string' },
              url: { type: 'string' },
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
              _fallback: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
          render: (_args, value) => renderToolOutput(value),
        },
        async execute(args, execCtx) {
          const cfg = typeof live === 'function' ? live() : (live?.value || {})
          if (cfg.enabled === false) {
            throw new Error('Image generation is disabled in settings.')
          }

          if (!args?.prompt || typeof args.prompt !== 'string' || !args.prompt.trim()) {
            throw new Error('Character description prompt is required for character sheet generation.')
          }

          const provider = PROVIDER_KEYS.includes(args.provider || cfg.provider)
            ? (args.provider || cfg.provider)
            : (PROVIDER_KEYS.includes(cfg.provider) ? cfg.provider : 'fal')

          const seed = typeof args.seed === 'number' ? args.seed : Math.floor(Math.random() * 2147483647)

          const sheetPlan = buildCharacterSheetPrompt({
            prompt: args.prompt,
            layout: args.layout,
            style: args.style,
            negativePrompt: args.negativePrompt,
          })

          const aspectPixels = ASPECT_RATIOS[sheetPlan.aspectRatio] || ASPECT_RATIOS['16:9']

          let subscriptionImages
          try { subscriptionImages = ctx.get && ctx.get('subscriptionImages') } catch (_err) { subscriptionImages = undefined }

          const providers = makeProviders(
            { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
            {
              prompt: sheetPlan.prompt,
              negativePrompt: sheetPlan.negativePrompt,
              size: 'custom',
              format: 'png',
              seed,
              signal: execCtx?.signal,
              aspectPixels,
              aspectRatio: sheetPlan.aspectRatio,
              quality: 'high',
            },
          )

          const fallbackChain = resolveFallbackChain(provider, cfg.fallbackProviders, PROVIDER_KEYS)

          const estimatedCost = calculateGenerationCost({
            provider,
            model: cfg.model || cfg.customModel || 'default',
            size: cfg.defaultSize || '1024x1024',
            count: 1,
          })
          const reservation = reserveSpend(estimatedCost, cfg.dailyBudgetUsd)
          let gen
          try {
            gen = await executeWithFallback(
              providers,
              fallbackChain,
              seed,
              sheetPlan.prompt,
              { logger: ctx.logger },
            )
          } catch (err) {
            reservation.release()
            throw err
          }

          const usedProvider = gen._fallback?.providerUsed || provider
          const finalBytes = gen.bytes
          const timestamp = Date.now()
          const safeSlug = slugify(args.prompt.slice(0, 30)) || 'character-sheet'
          const filename = `character-sheet-${sheetPlan.layout}-${safeSlug}-${timestamp}.png`

          let attachment = null
          let localUrl = ''
          let diskPath = ''
          if (finalBytes) {
            const saveRes = await saveAttachmentSafe(ctx, {
              bytes: finalBytes,
              mediaType: 'image/png',
              name: filename,
            })
            attachment = saveRes?.attachment || null
            localUrl = saveRes?.localUrl || ''

            const sessionCwd = execCtx?.agent?.session?.header?.cwd
            const targetDir = cfg.outputDir || 'generated/images'
            const outDir = path.resolve(sessionCwd || process.cwd(), targetDir)
            await mkdir(outDir, { recursive: true })
            diskPath = path.join(outDir, filename)
            await writeFile(diskPath, Buffer.from(finalBytes))
          } else if (gen.url) {
            attachment = {
              url: gen.url,
              mediaType: 'image/png',
              filename,
            }
            localUrl = gen.url
          }

          const effectiveCost = Number(gen.cost) || estimatedCost
          reservation.commit(effectiveCost, {
            ctx,
            meta: { provider: usedProvider, model: cfg.model || cfg.customModel, prompt: sheetPlan.prompt, seed },
          })

          const dualOutput = buildDualOutputMarkdown({
            action: 'generated',
            filePath: diskPath || filename,
            width: aspectPixels[0],
            height: aspectPixels[1],
            mediaType: 'image/png',
            seed,
            provider: usedProvider,
            model: cfg.model || cfg.customModel || 'character-sheet',
            cost: gen.cost,
            attachmentId: attachment?.attachmentId,
          })

          const response = {
            summary: dualOutput,
            prompt: sheetPlan.prompt,
            characterDescription: args.prompt,
            layout: sheetPlan.layout,
            style: sheetPlan.style,
            aspectRatio: sheetPlan.aspectRatio,
            views: sheetPlan.views,
            seed,
            provider: usedProvider,
            attachment,
            path: diskPath,
            url: localUrl,
            attachmentId: attachment?.attachmentId,
            _fallback: gen._fallback,
          }

          return toLosslessJson(response)
        },
      })
    )
  }, 'dsh-image-gen: tool generate_character_sheet')
}
