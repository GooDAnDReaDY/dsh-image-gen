import { sanitizeErrorAndLogs } from '../security.js'
// diagram.js — beautify_diagram tool (#185).
// Transforms raw Mermaid / Graphviz diagrams into high-end 3D isometric architectural illustrations.

import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  ASPECT_RATIOS,
  makeProviders,
  saveAttachmentSafe,
} from '../providers.js'
import { resolveFallbackChain, executeWithFallback } from '../fallback-router.js'
import { renderToolOutput } from '../attachment-helper.js'
import {
  DIAGRAM_3D_STYLES,
  buildDiagramIllustrationPrompt,
} from '../diagram-helpers.js'

export function registerDiagramTools(ctx, deps) {
  const {
    live,
    slugify,
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
            },
          },
          render: (_args, value) => renderToolOutput(value),
        },
        async execute(args, execCtx) {
          const cfg = live?.value || (typeof live === 'function' ? live() : {})
          const activeProvider = args.provider || cfg.activeProvider || 'fal'
          const seed = typeof args.seed === 'number' ? args.seed : Math.floor(Math.random() * 2147483647)

          const plan = buildDiagramIllustrationPrompt({
            diagram: args.diagram,
            style: args.style,
            title: args.title,
            aspectRatio: args.aspect_ratio || '16:9',
          })

          const providers = makeProviders({
            fetchImpl: fetch,
            resolveKey: (id) => resolveApiKey(cfg, id),
            cfg,
          })
          const fallbackChain = resolveFallbackChain(activeProvider, cfg)
          const aspectPixels = ASPECT_RATIOS[plan.aspectRatio] || ASPECT_RATIOS['16:9']

          const jobPayload = {
            prompt: plan.prompt,
            negativePrompt: plan.negativePrompt,
            aspectRatio: plan.aspectRatio,
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

          const outDir = path.resolve(process.cwd(), cfg.outputDir || 'output')
          await mkdir(outDir, { recursive: true })
          const timestamp = Date.now()
          const safeSlug = slugify(args.title || 'architecture-diagram') || 'diagram'
          const filename = `diagram-3d-${safeSlug}-${timestamp}.png`

          let attachment = null
          if (genResult.bytes) {
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

          return {
            title: args.title || 'System Architecture',
            style: plan.style,
            aspectRatio: plan.aspectRatio,
            detectedNodes: plan.parsedNodes,
            prompt: plan.prompt,
            seed,
            provider: usedProvider,
            attachment,
            url: attachment?.url,
            attachmentId: attachment?.attachmentId,
          }
        },
      })
    )
  }, 'dsh-image-gen: tool beautify_diagram')
}
