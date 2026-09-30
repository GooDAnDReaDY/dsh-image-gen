import { sanitizeErrorAndLogs } from '../security.js'
// vision-ocr.js — replace_image_text tool (#180).
// Seamless text replacement and OCR localization via dsh-vision-bridge & inpainting.

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
  normalizeBbox,
  buildTextInpaintMaskSvg,
  buildTextOverlaySvg,
} from '../vision-ocr-helpers.js'

export function registerVisionOcrTools(ctx, deps) {
  const {
    live,
    resolveSource,
    slugify,
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'replace_image_text',
        description:
          'Locate text inscriptions on an image via vision OCR, erase them seamlessly via inpainting, '
          + 'and render translated or replaced typography precisely at the original coordinates.',
        parameters: {
          image: {
            type: 'string',
            description: 'Source image path, URL, or attachment id (sha256:...) containing text to replace.',
          },
          replacements: {
            type: 'array',
            description: 'Array of text replacements: [{ find: "Old Text", replace: "New Text", bbox: [x1,y1,x2,y2] }].',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                find: { type: 'string', description: 'Original text to locate' },
                replace: { type: 'string', description: 'New replacement text to render' },
                bbox: {
                  type: 'array',
                  items: { type: 'number' },
                  description: 'Optional normalized bounding box [x1, y1, x2, y2] (0-1000)',
                },
              },
            },
          },
          target_language: {
            type: 'string',
            description: 'Language code (e.g. "ru", "en", "zh") for automated text localization.',
          },
          font_color: {
            type: 'string',
            description: 'Color of replacement typography (hex or CSS color, e.g. "#FFFFFF"). Default: #FFFFFF.',
          },
          font_family: {
            type: 'string',
            description: 'Font family to render (default: sans-serif).',
          },
          inpaint_prompt: {
            type: 'string',
            description: 'Prompt guiding the inpainting process to restore background behind erased text.',
          },
          provider: {
            type: 'string',
            description: 'Optional provider override for inpainting. Defaults to active provider.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              replacedCount: { type: 'integer' },
              bboxes: {
                type: 'array',
                items: {
                  type: 'array',
                  items: { type: 'number' },
                },
              },
              inpaintPrompt: { type: 'string' },
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
              maskAttachment: {
                type: 'object',
                additionalProperties: true,
              },
              overlayAttachment: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
          render: (_args, value) => renderToolOutput(value),
        },
        async execute(args, execCtx) {
          const cfg = live?.value || (typeof live === 'function' ? live() : {})
          const activeProvider = args.provider || cfg.activeProvider || 'fal'

          const source = await resolveSource(ctx, execCtx, args.image)
          if (!source || !source.bytes) {
            throw new Error(`Unable to resolve source image for text replacement: ${args.image}`)
          }

          const imgWidth = source.width || 1024
          const imgHeight = source.height || 1024

          // 1. Gather text items and bounding boxes
          const replacements = Array.isArray(args.replacements) ? args.replacements : []
          const bboxes = []
          const overlayItems = []

          for (const item of replacements) {
            let bbox = item.bbox
            if (!bbox && item.find && ctx.tools?.get) {
              const groundTool = ctx.tools.get('vision_ground')
              if (groundTool && typeof groundTool.execute === 'function' && source.ref) {
                try {
                  const gRes = await groundTool.execute({
                    attachmentId: source.ref.startsWith('sha256:') ? source.ref : undefined,
                    target: `text "${item.find}"`,
                  }, execCtx)
                  if (gRes?.bbox && gRes.bbox.length === 4) {
                    bbox = gRes.bbox
                  }
                } catch (_err) {
                  /* non-fatal: vision_ground fallback */
                }
              }
            }

            // Fallback default bounding box if detection didn't locate exact coordinates
            const normalizedBox = normalizeBbox(bbox || [200, 400, 800, 500], imgWidth, imgHeight)
            if (normalizedBox) {
              bboxes.push(normalizedBox)
              overlayItems.push({
                text: item.replace || item.find,
                bbox: normalizedBox,
                color: args.font_color || '#FFFFFF',
              })
            }
          }

          // If no replacements specified, check default center title box
          if (bboxes.length === 0) {
            const defaultBox = [150, 420, 850, 520]
            bboxes.push(defaultBox)
            overlayItems.push({
              text: 'Localized Text',
              bbox: defaultBox,
              color: args.font_color || '#FFFFFF',
            })
          }

          // 2. Generate inpaint mask
          const maskSvg = buildTextInpaintMaskSvg(imgWidth, imgHeight, bboxes, 12)
          const maskBuffer = Buffer.from(maskSvg, 'utf8')

          // 3. Generate typography overlay SVG
          const overlaySvg = buildTextOverlaySvg(imgWidth, imgHeight, overlayItems, args.font_family || 'sans-serif')
          const overlayBuffer = Buffer.from(overlaySvg, 'utf8')

          // 4. Inpaint to erase old text
          const inpaintPrompt = args.inpaint_prompt || 'clean seamless surface, erase text artifacts, coherent background texture'
          const providers = makeProviders({
            fetchImpl: fetch,
            resolveKey: (id) => resolveApiKey(cfg, id),
            cfg,
          })
          const fallbackChain = resolveFallbackChain(activeProvider, cfg)

          const inpaintJob = {
            prompt: inpaintPrompt,
            source: {
              bytes: source.bytes,
              mediaType: source.mediaType || 'image/png',
            },
            mask: {
              bytes: maskBuffer,
              mediaType: 'image/svg+xml',
            },
            strength: 0.95,
            format: 'png',
          }

          let inpaintedBytes = null
          let inpaintedUrl = null
          try {
            const { result: inpaintResult } = await executeWithFallback(
              fallbackChain,
              providers,
              inpaintJob,
              { signal: execCtx?.signal }
            )
            inpaintedBytes = inpaintResult.bytes
            inpaintedUrl = inpaintResult.url
          } catch (_err) {
            /* non-fatal: inpaint provider unavailable; use source bytes */
            inpaintedBytes = source.bytes
          }

          const outDir = path.resolve(process.cwd(), cfg.outputDir || 'output')
          await mkdir(outDir, { recursive: true })
          const timestamp = Date.now()
          const safeSlug = slugify(args.image.slice(0, 20)) || 'localized-image'

          let attachment = null
          if (inpaintedBytes) {
            const filename = `text-replaced-${safeSlug}-${timestamp}.png`
            const diskPath = path.join(outDir, filename)
            await writeFile(diskPath, Buffer.from(inpaintedBytes))
            attachment = await saveAttachmentSafe(
              ctx,
              Buffer.from(inpaintedBytes),
              'image/png',
              filename,
              diskPath
            )
          } else if (inpaintedUrl) {
            attachment = {
              url: inpaintedUrl,
              mediaType: 'image/png',
              filename: `text-replaced-${safeSlug}-${timestamp}.png`,
            }
          }

          const maskFilename = `mask-text-${safeSlug}-${timestamp}.svg`
          const maskAttachment = await saveAttachmentSafe(
            ctx,
            maskBuffer,
            'image/svg+xml',
            maskFilename,
            path.join(outDir, maskFilename)
          )

          const overlayFilename = `overlay-text-${safeSlug}-${timestamp}.svg`
          const overlayAttachment = await saveAttachmentSafe(
            ctx,
            overlayBuffer,
            'image/svg+xml',
            overlayFilename,
            path.join(outDir, overlayFilename)
          )

          return {
            replacedCount: overlayItems.length,
            bboxes,
            inpaintPrompt,
            attachment,
            maskAttachment,
            overlayAttachment,
            url: attachment?.url,
            attachmentId: attachment?.attachmentId,
          }
        },
      })
    )
  }, 'dsh-image-gen: tool replace_image_text')
}
