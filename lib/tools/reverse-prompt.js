// @ts-check
// reverse-prompt.js — Tools reverse_prompt_and_recreate (#465) & deep_reverse_prompt (#526).

import { defineTool } from '@deepseek-ai/dsh-tools'
import { sanitizeErrorAndLogs, resolveInside } from '../security.js'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  PROVIDER_KEYS,
  buildSidecar,
  makeProviders,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { resolveFallbackChain, executeWithFallback } from '../fallback-router.js'
import { assertBudgetAvailable, calculateGenerationCost, reserveSpend } from '../cost-meter.js'
import {
  deconstructImageAesthetics,
  synthesizeReversePrompt,
  formatReversePromptMarkdown,
  deconstructDeepOptics,
  synthesizeDeepReversePrompt,
  formatDeepReversePromptMarkdown,
} from '../reverse-prompt-helpers.js'

export function registerReversePromptTools(ctx, deps) {
  const {
    live = () => (deps.cfg && typeof deps.cfg === 'function' ? deps.cfg() : deps.cfg || {}),
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey = () => '',
    resolveSource = deps.resolveSource,
  } = deps

  // 1. Tool: reverse_prompt_and_recreate (#465)
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'reverse_prompt_and_recreate',
        description:
          'Analyze an existing image to deconstruct its lighting, camera optics, color palette, medium, and composition into a structured reverse-engineered prompt, and optionally synthesize a stylistic recreation (#465).',
        parameters: {
          image: {
            type: 'string',
            required: true,
            description: 'Path or attachment ID of the reference image to analyze and deconstruct.',
          },
          style_modifications: {
            type: 'string',
            description: 'Optional modifications or concept adjustments to inject into the recovered prompt (e.g. "make it cyberpunk", "add neon highlights").',
          },
          subject: {
            type: 'string',
            description: 'Optional subject override to swap the main subject while preserving reconstructed style & aesthetic properties.',
          },
          recreate: {
            type: 'boolean',
            description: 'Whether to immediately synthesize a recreated image using the recovered prompt (default: true).',
          },
          provider: {
            type: 'string',
            description: 'Optional provider override for image recreation (e.g. fal, replicate, gemini, custom).',
          },
          seed: {
            type: 'number',
            description: 'Deterministic seed for the recreation.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              extracted_prompt: { type: 'string' },
              negative_prompt: { type: 'string' },
              aesthetics: { type: 'object', additionalProperties: true },
              recreated: { type: 'boolean' },
              recreated_image: { type: 'string' },
              recreated_attachment_id: { type: 'string' },
            },
          },
          render(_args, value) {
            if (!value) return [{ type: 'text', text: 'Reverse prompt deconstruction failed' }]
            const markdown = formatReversePromptMarkdown({
              extractedPrompt: value.extracted_prompt,
              negativePrompt: value.negative_prompt,
              aesthetics: value.aesthetics,
              recreatedPath: value.recreated_image,
              recreatedId: value.recreated_attachment_id,
              recreated: value.recreated,
            })
            const metaTag = `<dsh-image-gen-reverse-prompt>${JSON.stringify({
              extracted_prompt: value.extracted_prompt,
              recreated: value.recreated,
              recreated_image: value.recreated_image,
              recreated_attachment_id: value.recreated_attachment_id,
            })}</dsh-image-gen-reverse-prompt>`
            return [{ type: 'text', text: `${markdown}\n\n${metaTag}` }]
          },
          presentationMeta(_args, value) {
            return {
              extracted_prompt: value?.extracted_prompt,
              negative_prompt: value?.negative_prompt,
              recreated: value?.recreated,
              recreated_image: value?.recreated_image,
            }
          },
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
          const cfg = live()
          if (cfg.enabled === false) {
            throw new Error('Image generation is disabled in settings (dsh-image-gen.enabled is false); enable it in Settings → Image generation.')
          }

          if (!args.image) {
            throw new Error('Parameter "image" is required.')
          }

          try {
            const source = await resolveSource(ctx, exec, args.image)
            if (!source || !source.bytes) {
              throw new Error(`Image not found or unreadable: ${args.image}`)
            }

            const aesthetics = await deconstructImageAesthetics(source.bytes)

            const { extractedPrompt, negativePrompt } = synthesizeReversePrompt({
              aesthetics,
              baseSubject: args.subject,
              styleModifications: args.style_modifications,
            })

            const doRecreate = args.recreate !== false
            let recreatedPath = null
            let recreatedAttachmentId = null

            if (doRecreate) {
              const provider = args.provider || (PROVIDER_KEYS.includes(cfg.provider) ? cfg.provider : 'fal')
              const seed = args.seed ?? Math.floor(Math.random() * 100000)

              let subscriptionImages
              try {
                subscriptionImages = ctx.get && ctx.get('subscriptionImages')
              } catch (_err) {
                subscriptionImages = undefined
              }

              const estimatedCost = calculateGenerationCost({
                provider,
                model: cfg.model || cfg.customModel || 'default',
                size: '1024x1024',
                count: 1,
              })
              const reservation = reserveSpend(estimatedCost, cfg.dailyBudgetUsd)
              let committed = false

              try {
                const chain = resolveFallbackChain(provider, cfg.fallbackProviders, PROVIDER_KEYS)
                const providers = makeProviders(
                  { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
                  {
                    prompt: extractedPrompt,
                    negativePrompt,
                    size: 'custom',
                    format: 'png',
                    seed,
                    signal: exec?.signal,
                    aspectPixels: [1024, 1024],
                    aspectRatio: '1:1',
                  },
                )

                const gen = await executeWithFallback(providers, chain, seed, extractedPrompt, {
                  logger: ctx.logger,
                })

                const filename = `recreated-${Date.now()}-${seed}.png`
                const { attachment, localUrl } = await saveAttachmentSafe(ctx, {
                  bytes: gen.bytes,
                  mediaType: 'image/png',
                  name: filename,
                })

                const effectiveCost = Number(gen.cost) || estimatedCost
                reservation.commit(effectiveCost, {
                  ctx,
                  meta: { provider, model: cfg.model || cfg.customModel, prompt: extractedPrompt, seed },
                })
                committed = true

                recreatedPath = localUrl || (attachment && attachment.path)
                recreatedAttachmentId = attachment ? attachment.id : null
              } finally {
                if (!committed && reservation && typeof reservation.release === 'function') {
                  reservation.release()
                }
              }
            }

            return {
              extracted_prompt: extractedPrompt,
              negative_prompt: negativePrompt,
              aesthetics,
              recreated: doRecreate,
              recreated_image: recreatedPath,
              recreated_attachment_id: recreatedAttachmentId,
            }
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || String(err)))
          }
        },
      })
    )
  }, 'dsh-image-gen: tool reverse_prompt_and_recreate')

  // 2. Tool: deep_reverse_prompt (#526)
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'deep_reverse_prompt',
        description:
          'Deconstruct an image into camera optics (focal length, aperture, angle), lighting setup, physical material textures, color grade, and typography directives with tier precision (concise, standard, cinematic) (#526).',
        parameters: {
          image: {
            type: 'string',
            required: true,
            description: 'Path or attachment ID of the reference image to analyze.',
          },
          tier: {
            type: 'string',
            enum: ['concise', 'standard', 'cinematic'],
            description: 'Level of analytical depth and prompt elaboration (default: standard).',
          },
          subject: {
            type: 'string',
            description: 'Optional subject override to swap the main subject while preserving deep photographic optics.',
          },
          style_modifications: {
            type: 'string',
            description: 'Optional additional style modifications.',
          },
          recreate: {
            type: 'boolean',
            description: 'Whether to synthesize a recreated image using the deep technical prompt (default: false).',
          },
          provider: {
            type: 'string',
            description: 'Optional provider override for recreation.',
          },
          seed: {
            type: 'number',
            description: 'Deterministic seed for the recreation.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              prompt: { type: 'string' },
              negative_prompt: { type: 'string' },
              tier: { type: 'string' },
              optics: { type: 'object', additionalProperties: true },
              lighting: { type: 'object', additionalProperties: true },
              materials: { type: 'array', items: { type: 'string' } },
              detected_text: { type: 'array', items: { type: 'string' } },
              color_palette: { type: 'array', items: { type: 'string' } },
              summary: { type: 'string' },
              recreated: { type: 'boolean' },
              recreated_image: { type: 'string' },
              recreated_attachment_id: { type: 'string' },
            },
          },
          render(_args, value) {
            if (!value) return [{ type: 'text', text: 'Deep reverse prompt analysis failed' }]
            const markdown = formatDeepReversePromptMarkdown({
              analysis: {
                optics: value.optics,
                lighting: value.lighting,
                materials: value.materials,
                detected_text: value.detected_text,
                color_palette: value.color_palette,
              },
              prompt: value.prompt,
              negativePrompt: value.negative_prompt,
              tier: value.tier || 'standard',
              recreatedPath: value.recreated_image,
              recreatedId: value.recreated_attachment_id,
              recreated: value.recreated,
            })
            return [{ type: 'text', text: markdown }]
          },
        },
        async execute(args, exec) {
          const cfg = live()
          if (cfg.enabled === false) {
            throw new Error(
              'Image generation is disabled in settings (dsh-image-gen.enabled is false); enable it in Settings → Image generation.',
            )
          }

          if (!args.image) {
            throw new Error('Parameter "image" is required.')
          }

          try {
            const source = await resolveSource(ctx, exec, args.image)
            if (!source || !source.bytes) {
              throw new Error(`Image not found or unreadable: ${args.image}`)
            }

            const tier = args.tier || 'standard'
            const deepAnalysis = await deconstructDeepOptics(source.bytes)
            const { prompt, negativePrompt, summary } = synthesizeDeepReversePrompt({
              analysis: deepAnalysis,
              tier,
              baseSubject: args.subject,
              styleModifications: args.style_modifications,
            })

            const doRecreate = Boolean(args.recreate)
            let recreatedPath = null
            let recreatedAttachmentId = null

            if (doRecreate) {
              const provider = args.provider || (PROVIDER_KEYS.includes(cfg.provider) ? cfg.provider : 'fal')
              const seed = args.seed ?? Math.floor(Math.random() * 100000)

              let subscriptionImages
              try {
                subscriptionImages = ctx.get && ctx.get('subscriptionImages')
              } catch (_err) {
                subscriptionImages = undefined
              }

              const estimatedCost = calculateGenerationCost({
                provider,
                model: cfg.model || cfg.customModel || 'default',
                size: '1024x1024',
                count: 1,
              })
              const reservation = reserveSpend(estimatedCost, cfg.dailyBudgetUsd)
              let committed = false

              try {
                const chain = resolveFallbackChain(provider, cfg.fallbackProviders, PROVIDER_KEYS)
                const providers = makeProviders(
                  { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
                  {
                    prompt,
                    negativePrompt,
                    size: 'custom',
                    format: 'png',
                    seed,
                    signal: exec?.signal,
                    aspectPixels: [1024, 1024],
                    aspectRatio: '1:1',
                  },
                )

                const gen = await executeWithFallback(providers, chain, seed, prompt, {
                  logger: ctx.logger,
                })

                const filename = `deep-recreated-${Date.now()}-${seed}.png`
                const { attachment, localUrl } = await saveAttachmentSafe(ctx, {
                  bytes: gen.bytes,
                  mediaType: 'image/png',
                  name: filename,
                })

                const effectiveCost = Number(gen.cost) || estimatedCost
                reservation.commit(effectiveCost, {
                  ctx,
                  meta: { provider, model: cfg.model || cfg.customModel, prompt, seed },
                })
                committed = true

                recreatedPath = localUrl || (attachment && attachment.path)
                recreatedAttachmentId = attachment ? attachment.id : null
              } finally {
                if (!committed && reservation && typeof reservation.release === 'function') {
                  reservation.release()
                }
              }
            }

            return {
              prompt,
              negative_prompt: negativePrompt,
              tier,
              optics: deepAnalysis.optics,
              lighting: deepAnalysis.lighting,
              materials: deepAnalysis.materials,
              detected_text: deepAnalysis.detected_text,
              color_palette: deepAnalysis.color_palette,
              summary,
              recreated: doRecreate,
              recreated_image: recreatedPath,
              recreated_attachment_id: recreatedAttachmentId,
            }
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || String(err)))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool deep_reverse_prompt')
}
