// editing — image-gen tools (edit_image, vary_image). Extracted from apply() (#216).

import { defineTool } from '@deepseek-ai/dsh-tools'
import { polishPrompt } from '../prompt-polisher.js'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  computeGenerationHash,
  IMAGE_SIZES,
  OUTPUT_FORMATS,
  PROVIDER_KEYS,
  buildSidecar,
  makeProviders,
  ASPECT_RATIOS,
  pixelDiff,
  normalizeCount,
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


export function registerEditingTools(ctx, deps) {
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
        name: 'edit_image',
        description:
          'Edit an existing image using inpainting, targeted modification, or object replacement. '
          + 'Describe the desired changes in prompt. '
          + 'If image is omitted or "latest", automatically resolves the most recent image from the conversation session (#144). '
          + 'Leverages @goodandready/dsh-vision-bridge for pre-edit composition analysis (#145). '
          + 'Optionally accepts mask (path or attachment id) and strength (0.1-1.0). Returns safe dual-output (#150).',
        parameters: {
          prompt: {
            type: 'string',
            required: true,
            description: 'Detailed description of the modification or edit to perform on the image.',
          },
          image: {
            type: 'string',
            description: 'Path or attachment id of the source image. Defaults to "latest" to auto-resolve from session history.',
          },
          mask: {
            type: 'string',
          },
          mask_image: {
            type: 'string',
            description: 'Optional path or attachment id of the inpaint mask image (alias for mask).',
            description: 'Optional path or attachment id of the inpaint mask image.',
          },
          strength: {
            type: 'number',
            description: 'Denoising / edit strength between 0.1 and 1.0 (default 0.75 for edits, 0.9 for mask inpainting).',
          },
          output_name: {
            type: 'string',
            description: 'Optional file name stem for the saved edited image.',
          },
          output_dir: {
            type: 'string',
            description: 'Optional custom directory to write edited image into.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              summary: { type: 'string' },
              path: { type: 'string' },
              url: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' },
              seed: { type: 'number' },
              provider: { type: 'string' },
              cost: { type: 'number' },
              format: { type: 'string' },
              attachment: { type: 'object', additionalProperties: true },
              visionAnalysis: { type: 'string' },
            },
          },
        },
        async execute(args, exec) {
          try {
            const cfg = live()
            trackAndAssertLoopGuard(exec?.agent?.session?.id || 'default', { limit: cfg.loopGuardLimit })
            const estimatedCostEdit = calculateGenerationCost({
              provider: cfg.provider || 'fal',
              model: cfg.model,
              size: cfg.defaultSize || 'square_hd',
              count: 1,
            })
            assertBudgetAvailable(estimatedCostEdit, cfg.dailyBudgetUsd)
            const source = await resolveConversationImage(ctx, exec, args.image)
          const maskRef = args.mask_image || args.mask
          const mask = maskRef ? await resolveSource(ctx, exec, maskRef) : undefined
          const vision = await analyzeImageWithVision(ctx, exec, source)

          let effectivePrompt = args.prompt
          if (vision.available && vision.summary) {
            effectivePrompt = `${args.prompt} (Context: modifying ${vision.summary})`
          }

          const provider = cfg.provider || 'fal'
          const deps = {
            fetchImpl: fetch,
            resolveKey: (ref) => resolveApiKey(ctx, ref),
            cfg,
          }

          const seed = Math.floor(Math.random() * 100000)
          const strength = args.strength ?? (mask ? 0.85 : 0.65)
          const format = cfg.defaultFormat || 'png'
          const size = cfg.defaultSize || 'square_hd'

          const job = {
            prompt: effectivePrompt,
            size,
            format,
            seed,
            source,
            mask,
            strength,
            provider,
          }

          const providers = makeProviders(deps, job)
          const fn = providers[provider] || providers.fal || providers.custom
          const gen = await fn(seed, effectivePrompt)

          const stem = args.output_name ? slugify(args.output_name) : `${source.name}-edit-${seed}`
          const name = `${stem}.${format}`

          const result = await saveAndAttachResult(ctx, exec, cfg, {
            bytes: gen.bytes,
            mediaType: gen.mediaType || 'image/png',
            name,
            stem,
            prompt: args.prompt,
            size,
            format,
            seed: gen.seed ?? seed,
            provider,
            model: cfg.model,
            cost: gen.cost,
            sourceUrl: gen.sourceUrl,
            deliverAs: cfg.deliverAs || 'both',
            args,
            action: 'edited',
          })

          if (vision.summary) {
            result.visionAnalysis = vision.summary
          }
          return toLosslessJson(result)
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool edit_image')
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'vary_image',
        description:
          'Generate subtle or creative variations of an existing image while preserving overall composition and structure. '
          + 'Pass variation_strength between 0.1 (subtle difference) and 0.9 (strong reinterpretation, default 0.35). '
          + 'If image is omitted or "latest", automatically resolves the most recent image from the conversation session (#144). '
          + 'Returns safe dual-output for text-only LLMs (#150).',
        parameters: {
          image: {
            type: 'string',
            description: 'Path or attachment id of the source image. Defaults to "latest" to auto-resolve from session history.',
          },
          prompt: {
            type: 'string',
            description: 'Optional prompt to steer the variation towards a specific mood, lighting, or style.',
          },
          variation_strength: {
            type: 'number',
            description: 'Strength of variation between 0.1 and 0.9. Default: 0.35.',
          },
          count: {
            type: 'integer',
            description: 'Number of variations to produce (1-4, default 1).',
          },
          output_name: {
            type: 'string',
            description: 'Optional file name stem for the saved variations.',
          },
          output_dir: {
            type: 'string',
            description: 'Optional custom directory to write variations into.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              summary: { type: 'string' },
              path: { type: 'string' },
              url: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' },
              seed: { type: 'number' },
              provider: { type: 'string' },
              cost: { type: 'number' },
              format: { type: 'string' },
              attachment: { type: 'object', additionalProperties: true },
              variations: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
          },
        },
        async execute(args, exec) {
          try {
            const cfg = live()
            trackAndAssertLoopGuard(exec?.agent?.session?.id || 'default', { limit: cfg.loopGuardLimit })
            const count = normalizeCount(args.count || 1)
            const estimatedCostVary = calculateGenerationCost({
              provider: cfg.provider || 'fal',
              model: cfg.model,
              size: cfg.defaultSize || 'square_hd',
              count,
            })
            assertBudgetAvailable(estimatedCostVary, cfg.dailyBudgetUsd)
            const source = await resolveConversationImage(ctx, exec, args.image)
          const vision = await analyzeImageWithVision(ctx, exec, source)

          const provider = cfg.provider || 'fal'
          const deps = {
            fetchImpl: fetch,
            resolveKey: (ref) => resolveApiKey(ctx, ref),
            cfg,
          }
          const variationStrength = Math.max(0.05, Math.min(0.95, args.variation_strength ?? 0.35))
          const baseSeed = Math.floor(Math.random() * 100000)
          const format = cfg.defaultFormat || 'png'
          const size = cfg.defaultSize || 'square_hd'

          const promptText = args.prompt || (vision.available ? `variation of ${vision.summary}` : 'high fidelity variation preserving composition')

          const results = []
          for (let i = 0; i < count; i++) {
            const currentSeed = baseSeed + i
            const job = {
              prompt: promptText,
              size,
              format,
              seed: currentSeed,
              source,
              strength: variationStrength,
              provider,
            }

            const providers = makeProviders(deps, job)
            const fn = providers[provider] || providers.fal || providers.custom
            const gen = await fn(currentSeed, promptText)

            const stem = args.output_name
              ? `${slugify(args.output_name)}-var-${i + 1}`
              : `${source.name}-var-${currentSeed}`
            const name = `${stem}.${format}`

            const item = await saveAndAttachResult(ctx, exec, cfg, {
              bytes: gen.bytes,
              mediaType: gen.mediaType || 'image/png',
              name,
              stem,
              prompt: promptText,
              size,
              format,
              seed: gen.seed ?? currentSeed,
              provider,
              model: cfg.model,
              cost: gen.cost,
              sourceUrl: gen.sourceUrl,
              deliverAs: cfg.deliverAs || 'both',
              args,
              action: `variation (${variationStrength})`,
            })
            results.push(item)
          }

          const first = results[0]
          return toLosslessJson({
            ...first,
            variations: results.map((r) => ({ path: r.path, attachmentId: r.attachment?.attachmentId, seed: r.seed })),
          })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool vary_image')

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'remix_image',
        description:
          'Artistically remix, vary, or transform an existing image with controlled creativity (denoising strength), prompt steering, and curated style presets. '
          + 'Allows fine-tuning whether the image closely retains original geometry (low creativity ~0.25) or boldly explores new aesthetic interpretations (~0.65).',
        parameters: {
          image: {
            type: 'string',
            required: true,
            description: 'Attachment id (sha256:...), file path, or URL of the base image to remix.',
          },
          prompt: {
            type: 'string',
            description: 'Direct prompt describing desired remix changes or artistic direction (e.g. "cyberpunk neon atmosphere with wet reflection").',
          },
          creativity: {
            type: 'number',
            description: 'Variation intensity / denoising strength between 0.05 (near identical) and 0.95 (complete reimagining). Default is 0.45.',
          },
          style_preset: {
            type: 'string',
            description: 'Optional curated style preset (e.g. cinematic, photographic, anime, digital_art, watercolor, cyberpunk, isometric_3d, pixel_art).',
          },
          count: {
            type: 'number',
            description: 'Number of variations to generate (1 to 4, default 1).',
          },
          seed: {
            type: 'number',
            description: 'Optional integer seed for reproducible variation results.',
          },
          output_name: {
            type: 'string',
            description: 'Optional custom filename stem for the saved remix.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              summary: { type: 'string' },
              path: { type: 'string' },
              url: { type: 'string' },
              seed: { type: 'number' },
              provider: { type: 'string' },
              cost: { type: 'number' },
              creativity: { type: 'number' },
              style_preset: { type: 'string' },
              remixes: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
          },
        },
        async execute(args, exec) {
          try {
            const cfg = live()
            trackAndAssertLoopGuard(exec?.agent?.session?.id || 'default', { limit: cfg.loopGuardLimit })
            const count = normalizeCount(args.count || 1)
            const estimatedCost = calculateGenerationCost({
              provider: cfg.provider || 'fal',
              model: cfg.model,
              size: cfg.defaultSize || 'square_hd',
              count,
            })
            assertBudgetAvailable(estimatedCost, cfg.dailyBudgetUsd)

            const source = await resolveConversationImage(ctx, exec, args.image)
            const vision = await analyzeImageWithVision(ctx, exec, source)

            const provider = cfg.provider || 'fal'
            const deps = {
              fetchImpl: fetch,
              resolveKey: (ref) => resolveApiKey(ctx, ref),
              cfg,
            }

            const strength = Math.max(0.05, Math.min(0.95, args.creativity ?? 0.45))
            const baseSeed = args.seed !== undefined ? args.seed : Math.floor(Math.random() * 100000)
            const format = cfg.defaultFormat || 'png'
            const size = cfg.defaultSize || 'square_hd'

            let rawPrompt = args.prompt || (vision.available ? `creative remix of ${vision.summary}` : 'artistic remix preserving core visual composition')
            const polished = polishPrompt(rawPrompt, {
              stylePreset: args.style_preset,
              autoEnhance: cfg.autoEnhancePrompt ?? true,
            })

            const results = []
            for (let i = 0; i < count; i++) {
              const currentSeed = baseSeed + i
              const job = {
                prompt: polished.prompt,
                negativePrompt: polished.negativePrompt,
                size,
                format,
                seed: currentSeed,
                source,
                strength,
                provider,
              }

              const providers = makeProviders(deps, job)
              const fn = providers[provider] || providers.fal || providers.custom
              const gen = await fn(currentSeed, polished.prompt)

              const stem = args.output_name
                ? `${slugify(args.output_name)}-remix-${i + 1}`
                : `${source.name}-remix-${currentSeed}`
              const name = `${stem}.${format}`

              const item = await saveAndAttachResult(ctx, exec, cfg, {
                bytes: gen.bytes,
                mediaType: gen.mediaType || 'image/png',
                name,
                stem,
                prompt: polished.prompt,
                size,
                format,
                seed: gen.seed ?? currentSeed,
                provider,
                model: cfg.model,
                cost: gen.cost,
                sourceUrl: gen.sourceUrl,
                deliverAs: cfg.deliverAs || 'both',
                args,
                action: `remix (creativity: ${strength}${args.style_preset ? ', style: ' + args.style_preset : ''})`,
              })
              results.push(item)
            }

            const first = results[0]
            return toLosslessJson({
              ...first,
              creativity: strength,
              style_preset: args.style_preset,
              remixes: results.map((r) => ({ path: r.path, attachmentId: r.attachment?.attachmentId, seed: r.seed })),
            })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool remix_image')

}
