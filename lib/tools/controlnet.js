// @ts-check
// controlnet.js — generate_with_control tool (#463).
// ControlNet structural guidance for edge, depth, and pose controlled image generation.

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
import { assertBudgetAvailable, calculateGenerationCost, reserveSpend } from '../cost-meter.js'
import { resolveInside } from '../security.js'
import { resolveConversationImage } from '../resolve-image.js'
import {
  SUPPORTED_CONTROL_MODES,
  preprocessControlImage,
  buildControlPrompt,
  formatControlNetMarkdown,
} from '../controlnet-helpers.js'

export function registerControlNetTools(ctx, deps) {
  const {
    live,
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_with_control',
        description:
          'Generate images with strict structural geometry, edge contours, depth layering, or pose guidance '
          + 'derived from an input reference image using ControlNet synthesis (#463).',
        parameters: {
          control_image: {
            type: 'string',
            required: true,
            description: 'Reference image path, attachment ID, or URL to extract structural control map from (or "latest").',
          },
          prompt: {
            type: 'string',
            required: true,
            description: 'Target prompt describing the desired scene or subject.',
          },
          mode: {
            type: 'string',
            enum: ['canny', 'depth', 'pose', 'sketch'],
            description: 'ControlNet conditioning mode: "canny" (edge detection), "depth" (spatial 3D depth), "pose" (anatomical posture), or "sketch" (line art). Default: "canny".',
          },
          control_strength: {
            type: 'number',
            description: 'Strength of structural adherence to the control map (0.1 - 1.0, default: 0.8).',
          },
          seed: {
            type: 'integer',
            description: 'Optional random seed for reproducible synthesis.',
          },
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '16:9', '4:3', '3:4'],
            description: 'Optional target aspect ratio (default: 1:1 or matches source image).',
          },
          style: {
            type: 'string',
            description: 'Optional style preset or aesthetic modifier.',
          },
          output_dir: {
            type: 'string',
            description: 'Optional custom directory path to save outputs into.',
          },
          output_name: {
            type: 'string',
            description: 'Optional custom filename stem for the generated images.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              prompt: { type: 'string' },
              mode: { type: 'string' },
              control_strength: { type: 'number' },
              seed: { type: 'integer' },
              control_map: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  path: { type: 'string' },
                  url: { type: 'string' },
                  width: { type: 'integer' },
                  height: { type: 'integer' },
                  attachment: { type: 'object', additionalProperties: true },
                },
              },
              image: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  path: { type: 'string' },
                  url: { type: 'string' },
                  width: { type: 'integer' },
                  height: { type: 'integer' },
                  format: { type: 'string' },
                  seed: { type: 'integer' },
                  attachment: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
          render(args, value) {
            const summary = formatControlNetMarkdown({
              prompt: value.prompt,
              mode: value.mode,
              controlStrength: value.control_strength,
              controlMapUrl: value.control_map?.url,
              finalImageUrl: value.image?.url,
              path: value.image?.path,
              seed: value.seed,
            })
            return [{ type: 'text', text: summary }]
          },
          presentationMeta(args, value) {
            return {
              prompt: value.prompt,
              mode: value.mode,
              control_strength: value.control_strength,
              control_map: value.control_map,
              image: value.image,
            }
          },
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
          const cfg = live()
          if (cfg.enabled === false) {
            throw new Error('Image generation is disabled in settings (dsh-image-gen.enabled is false); enable it in Settings → Image generation.')
          }

          const rawPrompt = String(args.prompt || '').trim()
          if (!rawPrompt) throw new Error('Parameter "prompt" is required.')

          const controlInput = args.control_image || 'latest'
          const resolvedControl = await resolveConversationImage(ctx, exec, controlInput)
          if (!resolvedControl?.bytes) {
            throw new Error(`Failed to resolve control_image "${controlInput}". Please provide a valid local path, attachment ID, or URL.`)
          }

          const mode = SUPPORTED_CONTROL_MODES.includes(args.mode) ? args.mode : 'canny'
          const controlStrength = typeof args.control_strength === 'number'
            ? Math.max(0.1, Math.min(1.0, args.control_strength))
            : 0.8

          // 1. Preprocess control image locally into conditioning map
          const preprocessed = await preprocessControlImage(resolvedControl.bytes, mode)

          const effectivePrompt = buildControlPrompt(
            args.style ? `${rawPrompt}, ${args.style} style` : rawPrompt,
            mode,
            controlStrength,
          )

          const aspectRatio = args.aspect_ratio || '1:1'
          const aspectPixels = ASPECT_RATIOS[aspectRatio] || [preprocessed.width, preprocessed.height]
          const seed = args.seed ?? Math.floor(Math.random() * 100000)

          const provider = PROVIDER_KEYS.includes(cfg.provider) ? cfg.provider : 'fal'
          let subscriptionImages
          try {
            subscriptionImages = ctx.get && ctx.get('subscriptionImages')
          } catch (_err) {
            subscriptionImages = undefined
          }

          const estimatedCost = calculateGenerationCost({
            provider,
            model: cfg.model || cfg.customModel || 'default',
            size: `${aspectPixels[0]}x${aspectPixels[1]}`,
            count: 1,
          })
          const reservation = reserveSpend(estimatedCost, cfg.dailyBudgetUsd)
          let committed = false

          try {
            const chain = resolveFallbackChain(provider, cfg.fallbackProviders, PROVIDER_KEYS)
            const sessionCwd = exec?.agent?.session?.header?.cwd
            const targetDir = args.output_dir || cfg.outputDir || 'generated/images'
            const outDir = resolveInside(sessionCwd || process.cwd(), targetDir)
            await mkdir(outDir, { recursive: true })

            const nameStem = args.output_name
              ? slugify(args.output_name)
              : slugify(`control-${mode}-${rawPrompt.slice(0, 32)}`)

            // 2. Save preprocessed control map artifact
            const controlMapFilename = `${nameStem}-control-map.png`
            const { attachment: mapAttachment, localUrl: mapUrl } = await saveAttachmentSafe(ctx, {
              bytes: preprocessed.controlMapBuffer,
              mediaType: 'image/png',
              name: controlMapFilename,
            })
            const mapFilePath = path.join(outDir, controlMapFilename)
            await writeFile(mapFilePath, preprocessed.controlMapBuffer)

            // 3. Dispatch generation with control conditioning
            const providers = makeProviders(
              { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
              {
                prompt: effectivePrompt,
                size: 'custom',
                format: 'png',
                seed,
                signal: exec?.signal,
                aspectPixels,
                aspectRatio,
                referenceImage: mapUrl || mapFilePath,
                referenceStrength: controlStrength,
                strength: 1.0 - controlStrength * 0.5,
              },
            )

            const gen = await executeWithFallback(providers, chain, seed, effectivePrompt, {
              logger: ctx.logger,
            })

            const finalFilename = `${nameStem}-${seed}.png`
            const { attachment: finalAttachment, localUrl: finalUrl } = await saveAttachmentSafe(ctx, {
              bytes: gen.bytes,
              mediaType: 'image/png',
              name: finalFilename,
            })

            const effectiveCost = Number(gen.cost) || estimatedCost
            reservation.commit(effectiveCost, {
              ctx,
              meta: { provider, model: cfg.model || cfg.customModel, prompt: effectivePrompt, seed },
            })

            const finalFilePath = path.join(outDir, finalFilename)
            await writeFile(finalFilePath, gen.bytes)

            // 4. Save sidecar metadata
            await writeFile(
              path.join(outDir, `${nameStem}-${seed}.json`),
              JSON.stringify(
                buildSidecar({
                  prompt: effectivePrompt,
                  size: `${gen.width || aspectPixels[0]}x${gen.height || aspectPixels[1]}`,
                  format: 'png',
                  seed,
                  provider: gen._fallback?.providerUsed || provider,
                  deliverAs: cfg.deliverAs || 'link',
                  width: gen.width || aspectPixels[0],
                  height: gen.height || aspectPixels[1],
                  mediaType: 'image/png',
                  attachmentId: finalAttachment?.attachmentId,
                  url: finalUrl,
                  cost: gen.cost,
                  control_mode: mode,
                  control_strength: controlStrength,
                  control_map_path: mapFilePath,
                }),
                null,
                2,
              ),
            )

            committed = true
            return toLosslessJson({
              prompt: rawPrompt,
              mode,
              control_strength: controlStrength,
              seed,
              control_map: {
                path: mapFilePath,
                url: mapUrl,
                width: preprocessed.width,
                height: preprocessed.height,
                attachment: mapAttachment,
              },
              image: {
                path: finalFilePath,
                url: finalUrl,
                width: gen.width || aspectPixels[0],
                height: gen.height || aspectPixels[1],
                format: 'png',
                seed,
                attachment: finalAttachment,
              },
            })
          } finally {
            if (!committed) {
              reservation.release()
            }
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool generate_with_control')
}

