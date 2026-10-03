import { buildPresentationMeta } from '../attachment-helper.js'
import { registerGenerationPackTool } from './generation-pack.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  computeGenerationHash,
  IMAGE_SIZES,
  OUTPUT_FORMATS,
  PROVIDER_KEYS,
  makeProviders,
  normalizeCount,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { buildDualOutputMarkdown } from '../resolve-image.js'
import { executeWithQualityGate } from '../quality-gate.js'
import { calculateGenerationCost, assertBudgetAvailable, reserveSpend } from '../cost-meter.js'
import { trackAndAssertLoopGuard } from '../loop-guard.js'
import { getCachedGeneration } from '../generation-cache.js'
import { resolveFallbackChain, executeWithFallback } from '../fallback-router.js'
import {
  readHistory,
  findCachedGeneration,
  findCached,
  findCachedByPrompt,
  cachedResult,
} from '../history.js'
import {
  asyncPool,
  validateGenerationParams,
  prepareGenerationPrompt,
  saveGeneratedImageArtifact,
} from '../generation-helpers.js'

// generation — image-gen tools (generate_image, generate_image_pack). Extracted from apply() (#216).

export function registerGenerationTools(ctx, deps, options = {}) {
  const {
    config,
    live,
    resolveSource,
    slugify,
    resolveApiKey,
  } = deps
  ctx.effect(() => {
    ctx.tools.register(
    defineTool({
      name: 'generate_image',
      description: 'Generate an image from prompt. Saves the image to workspace and conversation. Pass count (1-4) for variations.',
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description: 'Detailed description of the image to generate.',
        },
        image_size: {
          type: 'string',
          description: `One of: ${IMAGE_SIZES.join(', ')}. Default: ${config?.defaultSize || 'square_hd'}.`,
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
          description: 'Optional aspect ratio (e.g. 16:9, 1:1), overrides image_size.',
        },
        seed: {
          type: 'integer',
          description: 'Optional seed for reproducible output.',
        },
        output_format: {
          type: 'string',
          enum: OUTPUT_FORMATS,
          description: `Output format. Default: ${config?.defaultFormat || 'png'}.`,
        },
        output_name: {
          type: 'string',
          description: 'Optional file name stem for the saved image.',
        },
        output_dir: {
          type: 'string',
          description: 'Optional custom directory to write images into.',
        },
        style_preset: {
          type: 'string',
          description: 'Optional style preset: cinematic, photorealistic, anime, minimalist_vector, isometric_3d, analog_film, cyberpunk, claymation.',
        },
        palette_colors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional hex color codes (#1e1b4b) to harmonize palette.',
        },
        count: {
          type: 'integer',
          description: 'Variations count (1-4, default 1).',
        },
        prompts: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
            ],
          },
          description: 'Optional list of prompts for batch generation.',
        },
        negative_prompt: {
          type: 'string',
          description: 'Optional text describing what NOT to draw.',
        },
        guidance_scale: {
          type: 'number',
          description: 'Optional prompt adherence (1-20).',
        },
        quality: {
          type: 'string',
          enum: ['auto', 'low', 'medium', 'high'],
          description: 'Optional quality for supported providers.',
        },
        style: {
          type: 'string',
          description: 'Optional style preset for supported providers.',
        },
        source_image: {
          type: 'string',
          description: 'Optional source image path or attachment ID for img2img.',
        },
        mask: {
          type: 'string',
          description: 'Optional inpaint mask path or attachment ID.',
        },
        strength: {
          type: 'number',
          description: 'Optional edit strength (0-1).',
        },
        quality_gate: {
          type: 'boolean',
          description: 'Optional automated quality gate override.',
        },
        force: {
          type: 'boolean',
          description: 'Bypass cache and force new generation.',
        },
        reference_image: {
          type: 'string',
          description: 'Optional reference image path or URL for consistency.',
        },
        reference_strength: {
          type: 'number',
          description: 'Strength of reference influence (0.1-1.0).',
        },
        face_reference: {
          type: 'string',
          description: 'Portrait reference image for facial identity preservation.',
        },
        face_strength: {
          type: 'number',
          description: 'Facial identity similarity weight (0.1-1.0).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            summary: { type: 'string' },
            channel: { type: 'string' },
            provider: { type: 'string' },
            model: { type: 'string' },
            _fallback: {
              type: 'object',
              additionalProperties: true,
              properties: {
                triggered: { type: 'boolean' },
                primaryProvider: { type: 'string' },
                providerUsed: { type: 'string' },
                attempts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                      provider: { type: 'string' },
                      durationMs: { type: 'number' },
                      success: { type: 'boolean' },
                      error: { type: 'string' },
                    },
                  },
                },
              },
            },
            path: { type: 'string' },
            url: { type: 'string' },
            width: { type: 'integer' },
            height: { type: 'integer' },
            seed: { type: 'integer' },
            prompt: { type: 'string' },
            originalPrompt: { type: 'string' },
            format: { type: 'string' },
            cost: { type: 'number' },
            fromCache: { type: 'boolean' },
            qualityReport: { type: 'object', additionalProperties: true },
            anchor: {
              type: 'object',
              additionalProperties: true,
              properties: {
                label: { type: 'string' },
                mode: { type: 'string' },
              },
            },
            attachment: {
              type: 'object',
              additionalProperties: true,
              properties: {
                attachmentId: { type: 'string' },
                mediaType: { type: 'string' },
                bytes: { type: 'integer' },
                width: { type: 'integer' },
                height: { type: 'integer' },
                name: { type: 'string' },
              },
            },
            images: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  path: { type: 'string' },
                  url: { type: 'string' },
                  width: { type: 'integer' },
                  height: { type: 'integer' },
                  seed: { type: 'integer' },
                  prompt: { type: 'string' },
                  originalPrompt: { type: 'string' },
                  format: { type: 'string' },
                  cost: { type: 'number' },
                  fromCache: { type: 'boolean' },
                  qualityReport: { type: 'object', additionalProperties: true },
                  _fallback: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                      triggered: { type: 'boolean' },
                      primaryProvider: { type: 'string' },
                      providerUsed: { type: 'string' },
                      attempts: {
                        type: 'array',
                        items: {
                          type: 'object',
                          additionalProperties: true,
                          properties: {
                            provider: { type: 'string' },
                            durationMs: { type: 'number' },
                            success: { type: 'boolean' },
                            error: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                  provider: { type: 'string' },
                  model: { type: 'string' },
                  attachment: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                      attachmentId: { type: 'string' },
                      mediaType: { type: 'string' },
                      bytes: { type: 'integer' },
                      width: { type: 'integer' },
                      height: { type: 'integer' },
                      name: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      render(args, value) {
          const list = value.images || [value]
          const lines = list.map((img) => `Generated image (${img.width}×${img.height}, ${img.format}, seed ${img.seed}) via ${value.provider || 'image-gen'}/${value.model || 'default'}: ${img.path}`)
          const summary = lines.join('\n')
          if (live().deliverAs !== 'image') {
            const urls = list.map((img) => img.url).filter(Boolean)
            const mdLinks = list.map((img) => `![Generated Image](${img.url})`).join('\n')
            return [{ type: 'text', text: urls.length ? `${summary}\n${mdLinks}` : summary }]
          }
          const blocks = [{ type: 'text', text: summary }]
          for (const img of list) if (img.attachment) blocks.push({ type: 'image', attachment: img.attachment })
          return blocks
        },
        presentationMeta(args, value) {
          return buildPresentationMeta(value)
        },
      },
      isConcurrencySafe: () => false,
      timeoutMs: (config?.timeoutMs || 180000) + 30000,
      async execute(args, exec) {
        const cfg = live()

        // #168: Fail-fast loop guard protecting against runaway agent loops
        const sessionId = exec?.agent?.session?.id || exec?.agent?.session?.header?.id || 'session'
        if (cfg.loopGuardLimit > 0) {
          trackAndAssertLoopGuard(sessionId, {
            limit: cfg.loopGuardLimit,
            prompt: args.prompt,
            exec,
          })
        }

        const { provider, deliverAs, size, aspectPixels, format } = validateGenerationParams(cfg, args)

        // Subscriptions service is optional: without it, subscription providers
        // gracefully decline while other providers continue functioning.
        let subscriptionImages
        try { subscriptionImages = ctx.get && ctx.get('subscriptionImages') } catch (_err) { subscriptionImages = undefined }

        const source = args.source_image ? await resolveSource(ctx, exec, args.source_image) : undefined
        const mask = args.mask ? await resolveSource(ctx, exec, args.mask) : undefined

        const {
          enhanced,
          effectivePrompt,
          effectiveNegative,
          effectiveGuidance,
          activeAnchor,
          resolvedFaceRef,
          resolvedRefImage,
        } = await prepareGenerationPrompt({ ctx, cfg, args, exec, sessionId, provider, resolveSource })

        // #167: Assert daily budget availability before calling API
        const totalCount = Array.isArray(args.prompts) && args.prompts.length ? args.prompts.length : normalizeCount(args.count)
        const estimatedCost = calculateGenerationCost({
          provider,
          model: cfg.model || cfg.customModel,
          size,
          count: totalCount,
        })
        assertBudgetAvailable(estimatedCost, cfg.dailyBudgetUsd)
        const providers = makeProviders(
          { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
          {
            prompt: effectivePrompt,
            size,
            format,
            seed: args.seed,
            signal: exec?.signal,
            negativePrompt: effectiveNegative,
            guidanceScale: effectiveGuidance,
            source,
            mask,
            strength: args.strength,
            quality: args.quality,
            style: args.style,
            aspectPixels,
            aspectRatio: args.aspect_ratio,
            faceReference: resolvedFaceRef,
            faceStrength: args.face_strength || activeAnchor?.strength,
            referenceImage: resolvedRefImage,
            referenceStrength: args.reference_strength || activeAnchor?.strength,
            onProgress: exec?.onProgress,
            callId: exec?.callId,
          },
        )
        // Subscription providers return {ok:false, reason} instead of throwing:
        // rejection reaches the model as text. Without this guard,
        // execution would proceed with empty bytes.
        const guard = (generated) => { if (generated && generated.ok === false) throw new Error(generated.reason) }

        const seedBase = args.seed ?? Math.floor(Math.random() * 100000)
        // Fallback cascade: evaluate configured provider, falling back to alternates
        // (fal -> custom -> codex -> grok), accumulating failure diagnostics.
        const order = resolveFallbackChain(provider, cfg.fallbackProviders, PROVIDER_KEYS)
        const qgEnabled = args.quality_gate ?? cfg.qualityGate
        const generators = Object.fromEntries(PROVIDER_KEYS.map((k) => [
          k,
          async (s, p) => {
            let totalAttempts = 0
            let accumulatedCost = 0
            // #353, #355: Pipeline reserves budget per attempt, evaluates raw gen.bytes, and commits spend per attempt
            const perAttemptCost = Number(estimatedCost / totalCount) || 0.02
            const rawGenerate = async (seedVal) => {
              const reservation = reserveSpend(perAttemptCost, cfg.dailyBudgetUsd)
              totalAttempts++
              try {
                const gen = await providers[k](seedVal, p)
                guard(gen)
                const attemptCost = Number(gen.cost) || perAttemptCost
                accumulatedCost += attemptCost
                reservation.commit(attemptCost, {
                  ctx,
                  meta: { provider: k, model: cfg.model || cfg.customModel, prompt: p, seed: seedVal },
                })
                return gen
              } catch (err) {
                reservation.release()
                throw err
              }
            }

            const { generated: acceptedGen, qualityReport } = await executeWithQualityGate(
              rawGenerate,
              {
                initialSeed: s,
                enabled: qgEnabled,
                ctx,
                prompt: p,
              }
            )

            // Save the accepted artifact ONCE (spend already committed per attempt)
            const saved = await saveGeneratedImageArtifact({
              ctx,
              exec,
              cfg,
              args,
              gen: acceptedGen,
              promptArg: p,
              jobSeed: qualityReport.seedUsed ?? s,
              provider,
              deliverAs,
              size,
              format,
              effectiveNegative,
              effectiveGuidance,
              enhanced,
              slugify,
              estimatedCost: accumulatedCost || estimatedCost,
              totalCount,
              recordSpend: false,
            })

            return {
              ...saved,
              qualityReport: {
                ...qualityReport,
                attempts: totalAttempts,
                totalCost: accumulatedCost,
              },
            }
          }
        ]))
        const images = []
        const historyEntries = (cfg.cacheBySeed || cfg.cacheByPrompt) ? await readHistory() : []
        const checkCache = async (seedVal, promptVal) => {
          // #357: force disables ALL caches (both disk cache and history cache)
          if (args.force) return undefined

          const effectiveModel = provider === 'custom'
            ? (cfg.customModel || cfg.model || 'dall-e-3')
            : (cfg.model || cfg.customModel)

          const h = computeGenerationHash({
            provider,
            model: effectiveModel,
            prompt: promptVal,
            seed: seedVal,
            size: args.aspect_ratio ? 'custom' : (args.image_size || cfg.defaultSize),
            style: args.style,
            stylePreset: (args.style_preset !== undefined && args.style_preset !== null && args.style_preset !== '')
              ? args.style_preset
              : (cfg.stylePreset || cfg.defaultStylePreset),
            format: args.output_format || cfg.defaultFormat || 'png',
            aspectRatio: args.aspect_ratio || cfg.defaultAspectRatio,
            negativePrompt: args.negative_prompt || cfg.negativePrompt,
            quality: args.quality,
            strength: args.strength,
            sourceImage: args.image || args.source_image,
            maskImage: args.mask_image || args.mask,
            reference: args.reference_images || args.reference_image,
          })

          // #170: Content-addressed disk cache check (<50ms return)
          if (cfg.diskCache !== false) {
            const diskHit = getCachedGeneration(h, { force: args.force })
            if (diskHit) {
              const extension = diskHit.mediaType === 'image/jpeg' ? 'jpg' : diskHit.mediaType === 'image/webp' ? 'webp' : 'png'
              const stem = `${slugify(args.output_name || promptVal)}-${Date.now().toString(36)}-${seedVal}`
              const name = `${stem}.${extension}`
              const { attachment, localUrl } = await saveAttachmentSafe(ctx, { bytes: diskHit.bytes, mediaType: diskHit.mediaType, name })
              const sessionCwd = exec?.agent?.session?.header?.cwd
              const targetDir = (args.output_dir && String(args.output_dir).trim()) || cfg.outputDir || 'generated/images'
              const outDir = path.resolve(sessionCwd || process.cwd(), targetDir)
              await mkdir(outDir, { recursive: true })
              const filePath = path.join(outDir, name)
              await writeFile(filePath, diskHit.bytes)

              return {
                path: filePath,
                url: localUrl,
                width: diskHit.width || attachment.width,
                height: diskHit.height || attachment.height,
                seed: seedVal,
                prompt: promptVal,
                cost: 0,
                fromCache: true,
                format: diskHit.mediaType.replace('image/', ''),
                attachment: {
                  attachmentId: attachment.attachmentId,
                  mediaType: attachment.mediaType,
                  bytes: attachment.bytes,
                  width: attachment.width,
                  height: attachment.height,
                  name: attachment.name,
                },
              }
            }
          }

          if (!cfg.cacheBySeed && !cfg.cacheByPrompt) return undefined
          const hPrompt = h
          const found = findCachedGeneration(historyEntries, hPrompt)
          if (found) return await cachedResult(found)
          const requestedCriteria = {
            format: args.output_format || cfg.defaultFormat || 'png',
            aspectRatio: args.aspect_ratio || cfg.defaultAspectRatio,
            size: args.aspect_ratio ? 'custom' : (args.image_size || cfg.defaultSize),
          }
          if (cfg.cacheBySeed) {
            const bySeed = await findCached(historyEntries, seedVal, promptVal, requestedCriteria)
            if (bySeed) return await cachedResult(bySeed)
          }
          if (cfg.cacheByPrompt) {
            const byPrompt = await findCachedByPrompt(historyEntries, promptVal, requestedCriteria)
            if (byPrompt) return await cachedResult(byPrompt)
          }
          return undefined
        }

        const batchPrompts = Array.isArray(args.prompts) && args.prompts.length ? args.prompts : null
        if (batchPrompts) {
          const tasks = batchPrompts.map((item, i) => async () => {
            const text = typeof item === 'string' ? item : (item && item.text) || ''
            const cached = await checkCache(seedBase + i, text)
            return cached || await executeWithFallback(generators, order, seedBase + i, text, { logger: ctx.logger })
          })
          const parallelResults = await asyncPool(tasks, 3)
          images.push(...parallelResults)
        } else {
          const count = normalizeCount(args.count)
          const tasks = Array.from({ length: count }, (_, i) => async () => {
            const cached = await checkCache(seedBase + i, effectivePrompt)
            return cached || await executeWithFallback(generators, order, seedBase + i, effectivePrompt, { logger: ctx.logger })
          })
          const parallelResults = await asyncPool(tasks, 3)
          images.push(...parallelResults)
        }
        const first = images[0]
        let dualOutputSummary = buildDualOutputMarkdown({
          action: 'generated',
          filePath: first.path,
          width: first.width,
          height: first.height,
          mediaType: first.mediaType || ('image/' + (first.format || 'png')),
          seed: first.seed,
          provider,
          model: cfg.model || cfg.customModel || 'default',
          cost: first.cost,
          attachmentId: first.attachment?.attachmentId || 'N/A',
        })
        if (first.qualityReport?.exhausted) {
          dualOutputSummary += `\n\n> ⚠️ **Quality Gate Warning**: Visual quality checks failed after ${first.qualityReport.attempts || 3} attempts (${first.qualityReport.defect || 'defect detected'}). Image retained with potential defects.`
        }
        return toLosslessJson({ summary: dualOutputSummary, channel: provider, provider, model: cfg.model || cfg.customModel, _fallback: first._fallback, anchor: activeAnchor ? { label: activeAnchor.label, mode: activeAnchor.mode } : undefined, ...first, images })
      },
    }),
  )
  }, 'dsh-image-gen: tool generate_image')
  if (!options.coreOnly) {
    registerGenerationPackTool(ctx, deps)
  }
}
