// vision-ocr.js — replace_image_text tool (#180, #360).
// Grounding OCR, background inpainting, and typography re-rendering for visual localization.

import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  PROVIDER_KEYS,
  makeProviders,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { buildDualOutputMarkdown } from '../resolve-image.js'
import { resolveFallbackChain, executeWithFallback } from '../fallback-router.js'
import { assertBudgetAvailable, calculateGenerationCost, recordSpend } from '../cost-meter.js'
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
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'replace_image_text',
        description:
          'Locate text elements in an image using OCR/vision grounding, inpaint the background to erase them, '
          + 'and render crisp translated/replacement typography over the cleaned regions for visual localization.',
        parameters: {
          image: {
            type: 'string',
            description: 'Source image path, attachment ID, or URL containing text to replace.',
          },
          replacements: {
            type: 'array',
            description: 'List of text replacement instructions.',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                find: {
                  type: 'string',
                  description: 'Original text string to search for and erase.',
                },
                replace: {
                  type: 'string',
                  description: 'Replacement text to render in place of the original.',
                },
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
          seed: {
            type: 'integer',
            description: 'Optional seed for reproducible inpainting.',
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
              targetLanguage: { type: 'string' },
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
              maskAttachment: {
                type: 'object',
                additionalProperties: true,
              },
              overlayAttachment: {
                type: 'object',
                additionalProperties: true,
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

          if (!args?.image || typeof args.image !== 'string' || !args.image.trim()) {
            throw new Error('Parameter "image" (URL, file path, or sha256 attachment ID) is required for text replacement.')
          }

          const provider = PROVIDER_KEYS.includes(args.provider || cfg.provider)
            ? (args.provider || cfg.provider)
            : (PROVIDER_KEYS.includes(cfg.provider) ? cfg.provider : 'fal')

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

          if (bboxes.length === 0) {
            const defaultBox = [150, 420, 850, 520]
            bboxes.push(defaultBox)
            overlayItems.push({
              text: args.target_language ? `[${args.target_language}] Localized Text` : 'Localized Text',
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
          const seed = typeof args.seed === 'number' ? args.seed : Math.floor(Math.random() * 2147483647)

          let subscriptionImages
          try { subscriptionImages = ctx.get && ctx.get('subscriptionImages') } catch (_err) { subscriptionImages = undefined }

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
            seed,
            signal: execCtx?.signal,
          }

          const providers = makeProviders(
            { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
            inpaintJob,
          )
          const fallbackChain = resolveFallbackChain(provider, cfg.fallbackProviders, PROVIDER_KEYS)

          const estimatedCost = calculateGenerationCost({
            provider,
            model: cfg.model || cfg.customModel || 'default',
            size: `${imgWidth}x${imgHeight}`,
            count: 1,
          })
          assertBudgetAvailable(estimatedCost, cfg.dailyBudgetUsd)

          const gen = await executeWithFallback(
            providers,
            fallbackChain,
            seed,
            inpaintPrompt,
            { logger: ctx.logger },
          )

          const inpaintedBytes = gen.bytes
          if (!inpaintedBytes) {
            throw new Error('Inpainting failed to return image bytes for text replacement')
          }

          // 5. Composite typography overlay on inpainted background
          let finalBytes = inpaintedBytes
          try {
            const sharpMod = await import('sharp')
            const sharp = sharpMod.default || sharpMod
            finalBytes = await sharp(inpaintedBytes)
              .composite([{ input: overlayBuffer, top: 0, left: 0 }])
              .png()
              .toBuffer()
          } catch (sharpErr) {
            if (ctx.logger?.warn) ctx.logger.warn(`Sharp compositing skipped: ${sharpErr.message}`)
          }

          const usedProvider = gen._fallback?.providerUsed || provider
          const sessionCwd = execCtx?.agent?.session?.header?.cwd
          const targetDir = cfg.outputDir || 'generated/images'
          const outDir = path.resolve(sessionCwd || process.cwd(), targetDir)
          await mkdir(outDir, { recursive: true })
          const timestamp = Date.now()
          const safeSlug = slugify(String(args.image || '').slice(0, 20)) || 'localized-image'

          const filename = `text-replaced-${safeSlug}-${timestamp}.png`
          const { attachment, localUrl } = await saveAttachmentSafe(ctx, {
            bytes: finalBytes,
            mediaType: 'image/png',
            name: filename,
          })

          const diskPath = path.join(outDir, filename)
          await writeFile(diskPath, Buffer.from(finalBytes))

          const maskFilename = `mask-text-${safeSlug}-${timestamp}.svg`
          const { attachment: maskAttachment } = await saveAttachmentSafe(ctx, {
            bytes: maskBuffer,
            mediaType: 'image/svg+xml',
            name: maskFilename,
          })

          const overlayFilename = `overlay-text-${safeSlug}-${timestamp}.svg`
          const { attachment: overlayAttachment } = await saveAttachmentSafe(ctx, {
            bytes: overlayBuffer,
            mediaType: 'image/svg+xml',
            name: overlayFilename,
          })

          const effectiveCost = Number(gen.cost) || estimatedCost
          recordSpend(effectiveCost, {
            ctx,
            meta: { provider: usedProvider, model: cfg.model || cfg.customModel, prompt: inpaintPrompt, seed },
          })

          const dualOutput = buildDualOutputMarkdown({
            action: 'generated',
            filePath: diskPath,
            width: imgWidth,
            height: imgHeight,
            mediaType: 'image/png',
            seed,
            provider: usedProvider,
            model: cfg.model || cfg.customModel || 'replace-image-text',
            cost: gen.cost,
            attachmentId: attachment?.attachmentId,
          })

          const response = {
            summary: dualOutput,
            replacedCount: overlayItems.length,
            bboxes,
            inpaintPrompt,
            targetLanguage: args.target_language || '',
            seed,
            provider: usedProvider,
            path: diskPath,
            url: localUrl,
            attachment,
            maskAttachment,
            overlayAttachment,
            attachmentId: attachment?.attachmentId,
            _fallback: gen._fallback,
          }

          return toLosslessJson(response)
        },
      })
    )
  }, 'dsh-image-gen: tool replace_image_text')
}
