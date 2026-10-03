// lib/generation-helpers.js
// Extracted execution and prompt/caching helpers for generate_image tool (#349).

import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  computeGenerationHash,
  IMAGE_SIZES,
  OUTPUT_FORMATS,
  PROVIDER_KEYS,
  buildSidecar,
  ASPECT_RATIOS,
  embedPngMetadata,
  resolveStylePreset,
  saveAttachmentSafe,
  ensureImageFormat,
} from './providers.js'
import { enhancePrompt } from './prompt-enhancer.js'
import { buildFaceConsistencyPrompt, getSessionAnchor, applyAnchorPromptHints } from './anchor-helpers.js'
import { sanitizeNegativePrompt, supportsNegativePrompt } from './negative-sanitizer.js'
import { recordSpend } from './cost-meter.js'
import { setCachedGeneration } from './generation-cache.js'
import {
  readHistory,
  writeHistory,
  pruneHistory,
  appendHistoryEntry,
} from './history.js'

/** Run an array of async task functions with a concurrency cap */
export async function asyncPool(tasks, concurrency = 3) {
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

/** Validates generation configuration and arguments */
export function validateGenerationParams(cfg, args) {
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
  return { provider, deliverAs, size, aspectPixels, format }
}

/** Prepares enhanced prompt, style hints, facial identity, anchors, and sanitized negative prompt */
export async function prepareGenerationPrompt({ ctx, cfg, args, exec, sessionId, provider, resolveSource }) {
  const enhanced = await enhancePrompt(ctx, cfg, args.prompt, exec.signal, provider)
  const candidatePreset = (args.style_preset !== undefined && args.style_preset !== null && args.style_preset !== '')
    ? args.style_preset
    : (cfg.stylePreset || cfg.defaultStylePreset)
  const styleInfo = resolveStylePreset(candidatePreset, args.negative_prompt, args.guidance_scale)
  let effectivePrompt = styleInfo.promptSuffix ? `${enhanced.prompt}, ${styleInfo.promptSuffix}` : enhanced.prompt
  let effectiveNegative = styleInfo.negativePrompt
  const activeAnchor = getSessionAnchor(sessionId)
  let resolvedFaceRef
  let resolvedRefImage

  const faceRefInput = args.face_reference || (activeAnchor && (activeAnchor.mode === 'face' || activeAnchor.mode === 'character') ? activeAnchor.image : undefined)
  const refImageInput = args.reference_image || (activeAnchor && activeAnchor.mode === 'style' ? activeAnchor.image : undefined)

  if (faceRefInput) {
    try {
      resolvedFaceRef = await resolveSource(ctx, exec, faceRefInput)
    } catch (_err) {
      /* non-fatal: face_reference resolve fallback */
      resolvedFaceRef = { url: faceRefInput }
    }
    const facePlan = buildFaceConsistencyPrompt({
      prompt: effectivePrompt,
      faceStrength: args.face_strength || activeAnchor?.strength,
      characterName: activeAnchor?.label,
    })
    effectivePrompt = facePlan.prompt
    if (facePlan.negativePrompt) {
      effectiveNegative = effectiveNegative ? `${effectiveNegative}, ${facePlan.negativePrompt}` : facePlan.negativePrompt
    }
  }

  if (refImageInput) {
    try {
      resolvedRefImage = await resolveSource(ctx, exec, refImageInput)
    } catch (_err) {
      resolvedRefImage = { url: refImageInput }
    }
    if (!faceRefInput) {
      if (activeAnchor) {
        effectivePrompt = applyAnchorPromptHints(activeAnchor, effectivePrompt)
      } else {
        effectivePrompt = `${effectivePrompt}, visual reference anchor`
      }
    }
  } else if (!faceRefInput && activeAnchor) {
    effectivePrompt = applyAnchorPromptHints(activeAnchor, effectivePrompt)
  }

  // #165: Negative prompt sanitizer for diffusion models
  if (supportsNegativePrompt(provider, cfg.model || cfg.customModel)) {
    effectiveNegative = sanitizeNegativePrompt({
      positivePrompt: effectivePrompt,
      userNegative: effectiveNegative,
      autoInjectDefects: true,
    })
  }

  return {
    enhanced,
    effectivePrompt,
    effectiveNegative,
    effectiveGuidance: styleInfo.guidanceScale,
    styleInfo,
    activeAnchor,
    resolvedFaceRef,
    resolvedRefImage,
  }
}

/** Saves generated image to disk, sidecar, history, records spend, and builds return structure */
export async function saveGeneratedImageArtifact({
  ctx,
  exec,
  cfg,
  args,
  gen,
  promptArg,
  jobSeed,
  provider,
  deliverAs,
  size,
  format,
  effectiveNegative,
  effectiveGuidance,
  enhanced,
  slugify,
  estimatedCost,
  totalCount,
  recordSpend: shouldRecordSpend = true,
}) {
  const targetFormat = format || (args.output_format || cfg.defaultFormat)
  const formatted = await ensureImageFormat(gen.bytes, targetFormat, { fallbackMime: gen.mediaType })
  let bytes = formatted.bytes
  const mediaType = formatted.mediaType || 'image/png'
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

  const sessionCwd = exec?.agent?.session?.header?.cwd
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

  const effectiveModel = provider === 'custom'
    ? (cfg.customModel || cfg.model || 'dall-e-3')
    : (cfg.model || cfg.customModel)

  const cacheHash = computeGenerationHash({
    provider,
    model: effectiveModel,
    prompt: promptArg,
    seed: gen.seed,
    size: args.aspect_ratio ? 'custom' : (args.image_size || cfg.defaultSize),
    style: args.style,
    stylePreset: (args.style_preset !== undefined && args.style_preset !== null && args.style_preset !== '')
      ? args.style_preset
      : (cfg.stylePreset || cfg.defaultStylePreset),
    format: format || args.output_format || cfg.defaultFormat || 'png',
    aspectRatio: args.aspect_ratio || cfg.defaultAspectRatio,
    negativePrompt: args.negative_prompt || cfg.negativePrompt,
    quality: args.quality,
    strength: args.strength,
    sourceImage: args.image || args.source_image,
    maskImage: args.mask_image || args.mask,
    reference: args.reference_images || args.reference_image,
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
    aspectRatio: args.aspect_ratio || cfg.defaultAspectRatio,
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
  // Save to history (#385: historyLimit=0 skips history retention; bounds guard against negative values)
  // #365: Atomic transaction with file lock prevents read-modify-write race during concurrent batches
  const historyLimit = typeof cfg.historyLimit === 'number' ? Math.max(0, Math.floor(cfg.historyLimit)) : 50
  if (historyLimit > 0) {
    await appendHistoryEntry(entry, { pruneDays: cfg.pruneDays, historyLimit })
  }

  // #167: Record spend in cost meter (unless caller already committed attempt spend)
  if (shouldRecordSpend !== false) {
    recordSpend(gen.cost || (estimatedCost / totalCount), {
      ctx,
      meta: { provider, model: cfg.model || cfg.customModel, prompt: promptArg, seed: gen.seed },
    })
  }

  return {
    path: filePath,
    url: deliverAs === 'image' && gen.sourceUrl ? gen.sourceUrl : localUrl,
    width: gen.width || attachment.width,
    height: gen.height || attachment.height,
    seed: gen.seed,
    prompt: promptArg,
    ...(enhanced?.enhanced ? { originalPrompt: args.prompt } : {}),
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
