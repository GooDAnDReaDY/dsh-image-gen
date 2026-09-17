import { polishPrompt } from '../prompt-polisher.js'
import { registerGenerationPackTool } from './generation-pack.js'

/** Run an array of async task functions with a concurrency cap */
async function asyncPool(tasks, concurrency = 3) {
  const results = new Array(tasks.length)
  let nextIdx = 0
  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++
      results[idx] = await tasks[idx]()
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results
}

// generation — image-gen tools (generate_image, generate_image_pack). Extracted from apply() (#216).

import { defineTool } from '@deepseek-ai/dsh-tools'
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


export function registerGenerationTools(ctx, deps) {
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
      name: 'generate_image',
      description:
        'Generate an image with the configured image provider. '
        + 'Saves the image to the session workspace and shows it in the conversation. '
        + 'Depending on how the deployment is configured the result carries either the image itself or a link to it; '
        + 'when you only get a link, answer from the prompt and the link rather than claiming to see the picture. '
        + 'Use for any text-to-image request. Pass count (1-4) to generate several variations in one call; cost scales with count (default 1).',
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description: 'Detailed description of the image to generate (subject, style, lighting, composition, colors).',
        },
        image_size: {
          type: 'string',
          description: `One of: ${IMAGE_SIZES.join(', ')}. Default: ${config.defaultSize}.`,
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
          description: 'Optional aspect ratio; overrides image_size when both are given. Sent as width/height to providers that accept pixels.',
        },
        seed: {
          type: 'integer',
          description: 'Optional seed for reproducible output.',
        },
        output_format: {
          type: 'string',
          enum: OUTPUT_FORMATS,
          description: `Output format. Default: ${config.defaultFormat}.`,
        },
        output_name: {
          type: 'string',
          description: 'Optional file name stem for the saved image (defaults to a slug of the prompt).',
        },
        output_dir: {
          type: 'string',
          description: 'Optional custom directory to write images into (relative to session cwd or absolute). Defaults to outputDir from settings.',
        },
        style_preset: {
          type: 'string',
          description: 'Optional style preset: cinematic, photorealistic, anime, minimalist_vector, isometric_3d, analog_film, cyberpunk, claymation.',
        },
        palette_colors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional array of hex color codes (#1e1b4b) to constrain and harmonize the color palette.',
        },
        count: {
          type: 'integer',
          description: 'Number of variations to generate in one call, 1-4 (default 1). Cost scales with count.',
        },
        prompts: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
            ],
          },
          description: 'Optional list of prompts (strings or {text}); one image is generated per prompt. When set, overrides count and the single prompt.',
        },
        negative_prompt: {
          type: 'string',
          description: 'Optional text describing what NOT to draw; sent to providers that support it (ignored otherwise).',
        },
        guidance_scale: {
          type: 'number',
          description: 'Optional prompt adherence (e.g. 1-20); sent to providers that support it (ignored otherwise).',
        },
        quality: {
          type: 'string',
          enum: ['auto', 'low', 'medium', 'high'],
          description: 'Optional quality for providers that support it (seedream, gemini). Ignored otherwise.',
        },
        style: {
          type: 'string',
          description: 'Optional style preset for providers that support it (seedream, gemini). Ignored otherwise.',
        },
        source_image: {
          type: 'string',
          description: 'Optional path to an image file or an attachment id (sha256:...) to edit instead of drawing from scratch. Only providers that support image editing accept it; others refuse with a clear reason.',
        },
        mask: {
          type: 'string',
          description: 'Optional path or attachment id of a mask image (same size as source) to restrict the edit to a region. Only used when source_image is set and the provider supports masks.',
        },
        strength: {
          type: 'number',
          description: 'Optional edit strength (0-1) for providers that accept it; higher keeps more of the original.',
        },
        quality_gate: {
          type: 'boolean',
          description: 'Optional override to enable/disable automated quality gate and defect re-rolling for this call.',
        },
        force: {
          type: 'boolean',
          description: 'Optional flag to bypass content-addressed cache and force a new API generation.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            path: { type: 'string' },
            url: { type: 'string' },
            width: { type: 'integer' },
            height: { type: 'integer' },
            seed: { type: 'integer' },
            prompt: { type: 'string' },
            format: { type: 'string' },
            attachment: {
              type: 'object',
              additionalProperties: false,
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
                additionalProperties: false,
                properties: {
                  path: { type: 'string' },
                  url: { type: 'string' },
                  width: { type: 'integer' },
                  height: { type: 'integer' },
                  seed: { type: 'integer' },
                  prompt: { type: 'string' },
                  format: { type: 'string' },
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
            return [{ type: 'text', text: urls.length ? `${summary}\n${urls.join('\n')}` : summary }]
          }
          const blocks = [{ type: 'text', text: summary }]
          for (const img of list) if (img.attachment) blocks.push({ type: 'image', attachment: img.attachment })
          return blocks
        },
      },
      isConcurrencySafe: () => false,
      timeoutMs: config.timeoutMs + 30000,
      async execute(args, exec) {
        const cfg = live()

        // #168: Fail-fast loop guard protecting against runaway agent loops
        const sessionId = exec.agent?.session?.id || exec.agent?.session?.header?.id || 'session'
        if (cfg.loopGuardLimit > 0) {
          trackAndAssertLoopGuard(sessionId, {
            limit: cfg.loopGuardLimit,
            prompt: args.prompt,
          })
        }
        if (cfg.enabled === false) {
          throw new Error('Image generation is disabled in settings (dsh-image-gen.enabled is false); enable it in Settings → Image generation.')
        }
        const provider = PROVIDER_KEYS.includes(cfg.provider) ? cfg.provider : 'fal'
        const deliverAs = cfg.deliverAs
        const size = args.aspect_ratio ? 'custom' : (args.image_size ?? cfg.defaultSize)
        if (!args.aspect_ratio && !IMAGE_SIZES.includes(size)) {
          throw new Error(`Invalid image_size "${size}". One of: ${IMAGE_SIZES.join(', ')}`)
        }
        const aspectPixels = args.aspect_ratio ? ASPECT_RATIOS[args.aspect_ratio] : undefined
        const format = args.output_format ?? cfg.defaultFormat
        if (!OUTPUT_FORMATS.includes(format)) {
          throw new Error(`Invalid output_format "${format}". One of: ${OUTPUT_FORMATS.join(', ')}`)
        }
      // Subscriptions service is optional: without it, subscription providers
      // gracefully decline while other providers continue functioning.
        let subscriptionImages
        try { subscriptionImages = ctx.get && ctx.get('subscriptionImages') } catch (noService) { subscriptionImages = undefined }

        const source = args.source_image ? await resolveSource(ctx, exec, args.source_image) : undefined
        const mask = args.mask ? await resolveSource(ctx, exec, args.mask) : undefined
        const enhanced = await enhancePrompt(ctx, cfg, args.prompt, exec.signal, provider)
        const effectiveStyle = args.style || cfg.stylePreset
        const styleInfo = resolveStylePreset(effectiveStyle, args.negative_prompt, args.guidance_scale)
        const effectivePrompt = styleInfo.promptSuffix ? `${enhanced.prompt}, ${styleInfo.promptSuffix}` : enhanced.prompt

        // #165: Negative prompt sanitizer for diffusion models
        let effectiveNegative = styleInfo.negativePrompt
        if (supportsNegativePrompt(provider, cfg.model || cfg.customModel)) {
          effectiveNegative = sanitizeNegativePrompt({
            positivePrompt: effectivePrompt,
            userNegative: effectiveNegative,
            autoInjectDefects: true,
          })
        }
        const effectiveGuidance = styleInfo.guidanceScale

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
          { prompt: effectivePrompt, size, format, seed: args.seed, signal: exec.signal, negativePrompt: effectivePolishedNegative, guidanceScale: effectiveGuidance, source, mask, strength: args.strength, quality: args.quality, style: args.style, aspectPixels, aspectRatio: args.aspect_ratio },
        )
      // Subscription providers return {ok:false, reason} instead of throwing:
      // rejection reaches the model as text. Without this guard,
      // execution would proceed with empty bytes.
        const guard = (generated) => { if (generated && generated.ok === false) throw new Error(generated.reason) }
        const one = async (jobSeed, providerKey, promptArg = effectivePrompt) => {
          const gen = await providers[providerKey](jobSeed, promptArg)
          guard(gen)
          const mediaType = gen.mediaType || 'image/png'
          let bytes = gen.bytes
          if (mediaType === 'image/png') {
            bytes = embedPngMetadata(bytes, {
              prompt: promptArg,
              seed: gen.seed,
              provider,
              model: cfg.model || cfg.customModel,
              negative_prompt: effectiveNegative,
              guidance_scale: effectiveGuidance,
              width: gen.width,
              height: gen.height,
            })
          }
          const extension = mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : 'png'
          const stem = `${slugify(args.output_name || promptArg)}-${Date.now().toString(36)}-${jobSeed}`
          const name = `${stem}.${extension}`

          const { attachment, localUrl } = await saveAttachmentSafe(ctx, { bytes, mediaType, name })

          const sessionCwd = exec.agent?.session?.header?.cwd
          const targetDir = (args.output_dir && String(args.output_dir).trim()) || cfg.outputDir || 'generated/images'
          const outDir = path.resolve(sessionCwd || process.cwd(), targetDir)
          await mkdir(outDir, { recursive: true })
          const filePath = path.join(outDir, name)
          await writeFile(filePath, bytes)

        // Sidecar: metadata written alongside image file, making the output
        // directory self-documenting without external database dependencies.
          await writeFile(
            path.join(outDir, `${stem}.json`),
            JSON.stringify(buildSidecar({
              prompt: promptArg,
              size,
              format,
              seed: gen.seed,
              provider,
              deliverAs,
              width: gen.width || attachment.width,
              height: gen.height || attachment.height,
              mediaType,
              attachmentId: attachment.attachmentId,
              url: deliverAs === 'image' && gen.sourceUrl ? gen.sourceUrl : localUrl,
              cost: gen.cost,
            }), null, 2),
          )

          const cacheHash = computeGenerationHash({
            provider,
            model: cfg.model || cfg.customModel,
            prompt: promptArg,
            seed: gen.seed,
            size: args.image_size || cfg.defaultSize,
            style: args.style || cfg.stylePreset,
          })

          // #170: Store in content-addressed disk cache
          if (cfg.diskCache !== false) {
            setCachedGeneration(cacheHash, {
              bytes,
              mediaType,
              width: gen.width || attachment.width,
              height: gen.height || attachment.height,
              seed: gen.seed,
              meta: { prompt: promptArg, provider, model: cfg.model || cfg.customModel, cost: gen.cost },
            })
          }
          const entry = {
            path: filePath,
            prompt: promptArg,
            provider,
            model: cfg.model,
            size,
            format,
            seed: gen.seed,
            cacheHash,
            thumbnailUrl: localUrl,
            width: gen.width || attachment.width,
            height: gen.height || attachment.height,
            mediaType,
            bytes: attachment.bytes,
            createdAt: new Date().toISOString(),
            attachmentId: attachment.attachmentId,
          }
          let current = await readHistory()
          current = await pruneHistory(current, cfg.pruneDays)
          current.unshift(entry)
          if (current.length > (cfg.historyLimit || 50)) current.length = cfg.historyLimit || 50
          await writeHistory(current)

          // #167: Record spend in cost meter
          recordSpend(gen.cost || (estimatedCost / totalCount), {
            ctx,
            meta: { provider, model: cfg.model || cfg.customModel, prompt: promptArg, seed: gen.seed },
          })

          return {
            path: filePath,
            url: deliverAs === 'image' && gen.sourceUrl ? gen.sourceUrl : localUrl,
            width: gen.width || attachment.width,
            height: gen.height || attachment.height,
            seed: gen.seed,
            prompt: promptArg,
            ...(enhanced.enhanced ? { originalPrompt: args.prompt } : {}),
            cost: gen.cost,
            format: mediaType.replace('image/', ''),
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

        const seedBase = args.seed ?? Math.floor(Math.random() * 100000)
        // Fallback cascade: evaluate configured provider, falling back to alternates
        // (fal -> custom -> codex -> grok), accumulating failure diagnostics.
        const order = fallbackOrder(provider)
        const qgEnabled = args.quality_gate ?? cfg.qualityGate
        const generators = Object.fromEntries(PROVIDER_KEYS.map((k) => [
          k,
          async (s, p) => {
            const { generated, qualityReport } = await executeWithQualityGate(
              (seedVal) => one(seedVal, k, p),
              {
                initialSeed: s,
                enabled: qgEnabled,
                ctx,
                prompt: p,
              }
            )
            return { ...generated, qualityReport }
          }
        ]))
        const images = []
        const historyEntries = (cfg.cacheBySeed || cfg.cacheByPrompt) ? await readHistory() : []
        const checkCache = async (seedVal, promptVal) => {
          const h = computeGenerationHash({
            provider,
            model: cfg.model || cfg.customModel,
            prompt: promptVal,
            seed: seedVal,
            size: args.image_size || cfg.defaultSize,
            style: args.style || cfg.stylePreset,
          })

          // #170: Content-addressed disk cache check (<50ms return)
          if (cfg.diskCache !== false && !args.force) {
            const diskHit = getCachedGeneration(h, { force: args.force })
            if (diskHit) {
              const extension = diskHit.mediaType === 'image/jpeg' ? 'jpg' : diskHit.mediaType === 'image/webp' ? 'webp' : 'png'
              const stem = `${slugify(args.output_name || promptVal)}-${Date.now().toString(36)}-${seedVal}`
              const name = `${stem}.${extension}`
              const { attachment, localUrl } = await saveAttachmentSafe(ctx, { bytes: diskHit.bytes, mediaType: diskHit.mediaType, name })
              const sessionCwd = exec.agent?.session?.header?.cwd
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
          const hPrompt = computeGenerationHash({
            provider,
            model: cfg.model,
            prompt: promptVal,
            seed: seedVal,
            size: args.image_size || cfg.defaultSize,
            style: args.style || cfg.stylePreset,
          })
          const found = findCachedGeneration(historyEntries, hPrompt)
          if (found) return await cachedResult(found)
          if (cfg.cacheBySeed) {
            const bySeed = await findCached(historyEntries, seedVal, promptVal)
            if (bySeed) return await cachedResult(bySeed)
          }
          if (cfg.cacheByPrompt) {
            const byPrompt = await findCachedByPrompt(historyEntries, promptVal)
            if (byPrompt) return await cachedResult(byPrompt)
          }
          return undefined
        }

        const batchPrompts = Array.isArray(args.prompts) && args.prompts.length ? args.prompts : null
        if (batchPrompts) {
          const tasks = batchPrompts.map((item, i) => async () => {
            const text = typeof item === 'string' ? item : (item && item.text) || ''
            const cached = await checkCache(seedBase + i, text)
            return cached || await tryGenerate(generators, order, seedBase + i, text)
          })
          const parallelResults = await asyncPool(tasks, 3)
          images.push(...parallelResults)
        } else {
          const count = normalizeCount(args.count)
          const tasks = Array.from({ length: count }, (_, i) => async () => {
            const cached = await checkCache(seedBase + i, effectivePrompt)
            return cached || await tryGenerate(generators, order, seedBase + i)
          })
          const parallelResults = await asyncPool(tasks, 3)
          images.push(...parallelResults)
        }
        const first = images[0]
        const dualOutputSummary = buildDualOutputMarkdown({
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
        return toLosslessJson({ summary: dualOutputSummary, channel: provider, provider, model: cfg.model || cfg.customModel, ...first, images })
      },
    }),
  )
  }, 'dsh-image-gen: tool generate_image')
  registerGenerationPackTool(ctx, deps)
}
