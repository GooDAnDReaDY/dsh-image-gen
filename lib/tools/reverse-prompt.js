// @ts-check
// reverse-prompt.js — Tool reverse_prompt_and_recreate: Vision-driven reverse prompt engineering (#465).

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
} from '../reverse-prompt-helpers.js'

export function registerReversePromptTools(ctx, deps) {
  const {
    live = () => (deps.cfg && typeof deps.cfg === 'function' ? deps.cfg() : deps.cfg || {}),
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey = () => '',
    resolveSource = deps.resolveSource,
  } = deps

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
            // 1. Resolve source image
            const source = await resolveSource(ctx, exec, args.image)
            if (!source || !source.bytes) {
              throw new Error(`Image not found or unreadable: ${args.image}`)
            }

            // 2. Deconstruct aesthetics
            const aesthetics = await deconstructImageAesthetics(source.bytes)

            // 3. Synthesize prompt
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

                recreatedPath = localUrl || (attachment && attachment.path)
                recreatedAttachmentId = attachment ? attachment.id : null
              } catch (recErr) {
                reservation.cancel()
                throw recErr
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
}