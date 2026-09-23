import { renderToolOutput } from "../attachment-helper.js"
// processing-basic — core image-gen tools (remove_background, upscale_image, vectorize_image, blend_images). Split from processing.js (#239).

// processing — image-gen tools (remove_background, upscale_image, vectorize_image, blend_images). Extracted from apply() (#216).

import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  computeGenerationHash,
  IMAGE_SIZES,
  tryGenerate,
  fallbackOrder,
  embedPngMetadata,
  removeBackgroundFal,
  upscaleImageFal,
  traceToSvg,
  estimateCost,
  estimateSharpnessAndVariance,
  applyStylePreset,
  resolveStylePreset,
  blendImagesFal,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { resolveConversationImage, analyzeImageWithVision, buildDualOutputMarkdown } from '../resolve-image.js'
import { sanitizeNegativePrompt, supportsNegativePrompt } from '../negative-sanitizer.js'
import { executeWithQualityGate } from '../quality-gate.js'
import { calculateGenerationCost, recordSpend, assertBudgetAvailable } from '../cost-meter.js'
import { trackAndAssertLoopGuard } from '../loop-guard.js'
import { sanitizeErrorAndLogs } from '../security.js'
import { getCachedGeneration, setCachedGeneration } from '../generation-cache.js'
import {
  extractDesignTokens,
  generateCssGradient,
  checkWcagContrast,
  optimizeSvgContent,
  generatePwaIconSuite,
  extractSampleColorsFromBuffer,
} from '../frontend-assets.js'


export function registerProcessingTools(ctx, deps) {
  const {
    config,
    live,
    saveAndAttachResult,
    resolveSource,
    slugify,
    resolveApiKey,
  } = deps
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'remove_background',
        description: 'Remove the background of an image (path or attachment id) and return a transparent PNG.',
        parameters: {
          image: { type: 'string', required: true, description: 'Path or attachment id of the source image.' },
          model: { type: 'string', description: 'FAL model for background removal (default: fal-ai/birefnet).' },
          output_name: { type: 'string', description: 'Custom output file name without extension.' },
        },
        output: {
        render: (_args, value) => renderToolOutput(value),
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              path: { type: 'string' },
              url: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' },
              format: { type: 'string' },
            },
          },
        },
        async execute(args, exec) {
          try {
            const source = await resolveSource(ctx, exec, args.image)
            if (!source || !source.bytes) throw new Error('Source image not found: ' + args.image)
          const cfg = live()
          const res = await removeBackgroundFal(
            { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg },
            { imageBytes: source.bytes, mediaType: source.mediaType, model: args.model, signal: exec.signal }
          )
          const stem = `${slugify(args.output_name || 'nobg')}-${Date.now().toString(36)}`
          const name = `${stem}.png`
          const { attachment, localUrl } = await saveAttachmentSafe(ctx, { bytes: res.bytes, mediaType: 'image/png', name })
          const sessionCwd = exec.agent?.session?.header?.cwd
          const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir || 'generated/images')
          await mkdir(outDir, { recursive: true })
          const filePath = path.join(outDir, name)
          await writeFile(filePath, res.bytes)
          const summary = buildDualOutputMarkdown({
            action: 'background removed',
            filePath,
            width: res.width || attachment.width,
            height: res.height || attachment.height,
            mediaType: 'image/png',
            provider: 'fal',
            model: args.model || 'fal-ai/birefnet',
            attachmentId: attachment.attachmentId,
          })
          return toLosslessJson({
            summary,
            path: filePath,
            url: localUrl,
            width: res.width || attachment.width,
            height: res.height || attachment.height,
            format: 'png',
            attachment,
          })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool remove_background')
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'upscale_image',
        description: 'Upscale an image 2x or 4x with enhanced clarity and detail.',
        parameters: {
          image: { type: 'string', required: true, description: 'Path or attachment id of the source image.' },
          scale: { type: 'number', description: 'Upscale factor: 2 or 4 (default: 2).' },
          prompt: { type: 'string', description: 'Optional guiding prompt for detail reconstruction.' },
          creativity: { type: 'number', description: 'Creativity / hallucination level from 0 to 1.' },
          output_name: { type: 'string', description: 'Custom output file name.' },
        },
        output: {
        render: (_args, value) => renderToolOutput(value),
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              path: { type: 'string' },
              url: { type: 'string' },
              scale: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
        },
        async execute(args, exec) {
          try {
            const source = await resolveSource(ctx, exec, args.image)
            if (!source || !source.bytes) throw new Error('Source image not found: ' + args.image)
          const cfg = live()
          const res = await upscaleImageFal(
            { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg },
            { imageBytes: source.bytes, mediaType: source.mediaType, scale: args.scale, prompt: args.prompt, creativity: args.creativity, signal: exec.signal }
          )
          const stem = `${slugify(args.output_name || 'upscaled')}-${Date.now().toString(36)}`
          const name = `${stem}.png`
          const { attachment, localUrl } = await saveAttachmentSafe(ctx, { bytes: res.bytes, mediaType: 'image/png', name })
          const sessionCwd = exec.agent?.session?.header?.cwd
          const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir || 'generated/images')
          await mkdir(outDir, { recursive: true })
          const filePath = path.join(outDir, name)
          await writeFile(filePath, res.bytes)
          const summary = buildDualOutputMarkdown({
            action: `upscaled (${args.scale || 2}x)`,
            filePath,
            width: res.width || attachment.width,
            height: res.height || attachment.height,
            mediaType: 'image/png',
            provider: 'fal',
            model: 'fal-ai/clarity-upscaler',
            attachmentId: attachment.attachmentId,
          })
          return toLosslessJson({
            summary,
            path: filePath,
            url: localUrl,
            scale: args.scale || 2,
            width: res.width || attachment.width,
            height: res.height || attachment.height,
            attachment,
          })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool upscale_image')
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'vectorize_image',
        description: 'Convert a raster image or icon to SVG vector format.',
        parameters: {
          image: { type: 'string', required: true, description: 'Path or attachment id of the source image.' },
          color_mode: { type: 'string', description: '"color" or "binary" (default: "color").' },
          output_name: { type: 'string', description: 'Custom output file name.' },
        },
        output: {
        render: (_args, value) => renderToolOutput(value),
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              path: { type: 'string' },
              svg: { type: 'string' },
              format: { type: 'string' },
            },
          },
        },
        async execute(args, exec) {
          try {
            const source = await resolveSource(ctx, exec, args.image)
            if (!source || !source.bytes) throw new Error('Source image not found: ' + args.image)
            const cfg = live()
            const res = traceToSvg(source.bytes, { colorMode: args.color_mode })
            const stem = `${slugify(args.output_name || 'vector')}-${Date.now().toString(36)}`
            const name = `${stem}.svg`
            const sessionCwd = exec.agent?.session?.header?.cwd
            const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir || 'generated/images')
            await mkdir(outDir, { recursive: true })
            const filePath = path.join(outDir, name)
            await writeFile(filePath, res.bytes)

            let attachment = null
            let localUrl = ''
            if (ctx.attachments?.saveImage) {
              attachment = await ctx.attachments.saveImage({
                data: new Uint8Array(res.bytes),
                mediaType: 'image/svg+xml',
                name,
              })
              localUrl = '/dsh-image-gen/image?id=' + encodeURIComponent(attachment.attachmentId)
            }

            const summary = `### Vectorized SVG Export\n- **File**: ${filePath}\n- **Format**: SVG (XML vector)\n- **Color mode**: ${args.color_mode || 'color'}\n- **Palette size**: ${res.palette ? res.palette.length : 16} colors\n`
            return toLosslessJson({
              summary,
              path: filePath,
              url: localUrl,
              svg: res.svg,
              format: 'svg',
              attachment,
            })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool vectorize_image')
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'blend_images',
        description: 'Blend multiple images (paths or attachment ids) into a coherent new composition.',
        parameters: {
          images: { type: 'array', items: { type: 'string' }, required: true, description: 'List of image paths or attachment ids to blend.' },
          weights: { type: 'array', items: { type: 'number' }, description: 'Weights for each image (optional).' },
          prompt: { type: 'string', description: 'Guiding prompt for the blend.' },
          output_name: { type: 'string', description: 'Custom output file name.' },
        },
        output: {
        render: (_args, value) => renderToolOutput(value),
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              path: { type: 'string' },
              url: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
        },
        async execute(args, exec) {
          try {
            const cfg = live()
            trackAndAssertLoopGuard(exec?.agent?.session?.id || 'default', { limit: cfg.loopGuardLimit })
            assertBudgetAvailable(0.05, cfg.dailyBudgetUsd)
            const refs = Array.isArray(args.images) ? args.images : [args.images].filter(Boolean)
          const sources = []
          for (const r of refs) {
            const s = await resolveSource(ctx, exec, r)
            if (s && s.bytes) sources.push(s)
          }
          if (sources.length === 0) throw new Error('No valid images found to blend')
          const res = await blendImagesFal(
            { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg },
            { images: sources, weights: args.weights, prompt: args.prompt, signal: exec.signal }
          )
          const stem = `${slugify(args.output_name || 'blended')}-${Date.now().toString(36)}`
          const name = `${stem}.png`
          const { attachment, localUrl } = await saveAttachmentSafe(ctx, { bytes: res.bytes, mediaType: 'image/png', name })
          const sessionCwd = exec.agent?.session?.header?.cwd
          const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir || 'generated/images')
          await mkdir(outDir, { recursive: true })
          const filePath = path.join(outDir, name)
          await writeFile(filePath, res.bytes)
          const summary = buildDualOutputMarkdown({
            action: 'blended composition',
            filePath,
            width: res.width || attachment.width,
            height: res.height || attachment.height,
            mediaType: 'image/png',
            provider: 'fal',
            model: 'fal-ai/image-blend',
            attachmentId: attachment.attachmentId,
          })
          return toLosslessJson({
            summary,
            path: filePath,
            url: localUrl,
            width: res.width || attachment.width,
            height: res.height || attachment.height,
            attachment,
          })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool blend_images')

}
