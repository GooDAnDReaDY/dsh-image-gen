// diagram.js — beautify_diagram tool (#185, #359).
// Transforms raw Mermaid / Graphviz diagrams into high-end 3D isometric architectural illustrations.

import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  ASPECT_RATIOS,
  PROVIDER_KEYS,
  makeProviders,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { buildDualOutputMarkdown } from '../resolve-image.js'
import { resolveFallbackChain, executeWithFallback } from '../fallback-router.js'
import { assertBudgetAvailable, calculateGenerationCost, reserveSpend, recordSpend } from '../cost-meter.js'
import { renderToolOutput } from '../attachment-helper.js'
import {
  DIAGRAM_3D_STYLES,
  buildDiagramIllustrationPrompt,
} from '../diagram-helpers.js'

export function registerDiagramTools(ctx, deps) {
  const {
    live,
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'beautify_diagram',
        description:
          'Transform raw Mermaid or Graphviz diagrams into stunning 3D isometric architectural illustrations '
          + 'with glowing data pipes, glassmorphism cards, and pristine technical lighting for documentation and hero blocks.',
        parameters: {
          diagram: {
            type: 'string',
            description: 'Raw Mermaid diagram source code, Graphviz DOT text, or image path/attachment.',
          },
          style: {
            type: 'string',
            enum: ['isometric_3d', 'cyber_blueprint', 'clay_minimal', 'glossy_dark'],
            description: '3D rendering aesthetic style. Default: isometric_3d.',
          },
          title: {
            type: 'string',
            description: 'Optional architecture title or headline to feature in the composition.',
          },
          aspect_ratio: {
            type: 'string',
            enum: ['16:9', '1:1', '4:3', '21:9'],
            description: 'Aspect ratio for documentation header or hero banner (default: 16:9).',
          },
          seed: {
            type: 'integer',
            description: 'Optional seed for reproducible diagram generation.',
          },
          provider: {
            type: 'string',
            description: 'Optional provider override. Defaults to active provider.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              title: { type: 'string' },
              style: { type: 'string' },
              aspectRatio: { type: 'string' },
              detectedNodes: {
                type: 'array',
                items: { type: 'string' },
              },
              prompt: { type: 'string' },
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

          if (!args?.diagram || typeof args.diagram !== 'string' || !args.diagram.trim()) {
            throw new Error('Diagram content (Mermaid code, ASCII, or description) is required for beautify_diagram.')
          }

          const provider = PROVIDER_KEYS.includes(args.provider || cfg.provider)
            ? (args.provider || cfg.provider)
            : (PROVIDER_KEYS.includes(cfg.provider) ? cfg.provider : 'fal')

          const seed = typeof args.seed === 'number' ? args.seed : Math.floor(Math.random() * 2147483647)

          const plan = buildDiagramIllustrationPrompt({
            diagram: args.diagram,
            style: args.style,
            title: args.title,
            aspectRatio: args.aspect_ratio || '16:9',
          })

          const aspectPixels = ASPECT_RATIOS[plan.aspectRatio] || ASPECT_RATIOS['16:9']

          let subscriptionImages
          try { subscriptionImages = ctx.get && ctx.get('subscriptionImages') } catch (_err) { subscriptionImages = undefined }

          const providers = makeProviders(
            { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
            {
              prompt: plan.prompt,
              negativePrompt: plan.negativePrompt,
              size: 'custom',
              format: 'png',
              seed,
              signal: execCtx?.signal,
              aspectPixels,
              aspectRatio: plan.aspectRatio,
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
              plan.prompt,
              { logger: ctx.logger },
            )
          } catch (err) {
            reservation.release()
            throw err
          }

          const usedProvider = gen._fallback?.providerUsed || provider
          const finalBytes = gen.bytes
          const timestamp = Date.now()
          const safeSlug = slugify(args.title || 'architecture-diagram') || 'diagram'
          const filename = `diagram-3d-${safeSlug}-${timestamp}.png`

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
            meta: { provider: usedProvider, model: cfg.model || cfg.customModel, prompt: plan.prompt, seed },
          })

          const dualOutput = buildDualOutputMarkdown({
            action: 'generated',
            filePath: diskPath || filename,
            width: aspectPixels[0],
            height: aspectPixels[1],
            mediaType: 'image/png',
            seed,
            provider: usedProvider,
            model: cfg.model || cfg.customModel || 'beautify-diagram',
            cost: gen.cost,
            attachmentId: attachment?.attachmentId,
          })

          const response = {
            summary: dualOutput,
            title: args.title || 'System Architecture',
            style: plan.style,
            aspectRatio: plan.aspectRatio,
            detectedNodes: plan.parsedNodes,
            prompt: plan.prompt,
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
  }, 'dsh-image-gen: tool beautify_diagram')
}
