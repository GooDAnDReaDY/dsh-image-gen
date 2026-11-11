// @ts-check
// ecommerce-pack.js — Tool generate_ecommerce_pack: Commercial multi-shot product suite (#527).

import { defineTool } from '@deepseek-ai/dsh-tools'
import { sanitizeErrorAndLogs } from '../security.js'
import {
  PROVIDER_KEYS,
  makeProviders,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { resolveFallbackChain, executeWithFallback } from '../fallback-router.js'
import { assertBudgetAvailable, calculateGenerationCost, reserveSpend } from '../cost-meter.js'
import { renderToolOutput } from '../attachment-helper.js'
import { deconstructImageAesthetics } from '../reverse-prompt-helpers.js'
import {
  buildEcommerceShotPrompts,
  formatEcommercePackMarkdown,
} from '../ecommerce-pack-helpers.js'

export function registerEcommercePackTools(ctx, deps) {
  const {
    live = () => (deps.cfg && typeof deps.cfg === 'function' ? deps.cfg() : deps.cfg || {}),
    resolveApiKey = () => '',
    resolveSource = deps.resolveSource,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_ecommerce_pack',
        description:
          'Generate a cohesive 4-shot commercial product photography suite (Hero, Lifestyle, Macro texture, and 16:9 Banner) from a product reference image (#527).',
        parameters: {
          product_image: {
            type: 'string',
            required: true,
            description: 'Path or attachment ID of the product image to contextualize and photograph.',
          },
          category: {
            type: 'string',
            description: 'Product category: electronics, fashion, cosmetics, furniture, food, beverage, general (default: general).',
          },
          brand_name: {
            type: 'string',
            description: 'Optional brand name to reflect in packaging or presentation.',
          },
          lifestyle_setting: {
            type: 'string',
            description: 'Optional custom environmental interior/setting for the in-situ lifestyle shot.',
          },
          product_name: {
            type: 'string',
            description: 'Optional explicit product name or title override.',
          },
          provider: {
            type: 'string',
            description: 'Optional provider override (fal, replicate, gemini, custom).',
          },
          seed: {
            type: 'number',
            description: 'Deterministic seed for the suite generations.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              category: { type: 'string' },
              brand_name: { type: 'string' },
              count: { type: 'number' },
              shots: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    type: { type: 'string' },
                    label: { type: 'string' },
                    path: { type: 'string' },
                    attachment_id: { type: 'string' },
                    aspect_ratio: { type: 'string' },
                    prompt: { type: 'string' },
                  },
                },
              },
              summary: { type: 'string' },
            },
          },
          render(_args, value) {
            if (!value) return [{ type: 'text', text: 'E-commerce pack generation failed' }]
            const markdown = formatEcommercePackMarkdown({
              category: value.category || 'general',
              brandName: value.brand_name,
              shots: (value.shots || []).map((s) => ({
                type: s.type,
                label: s.label,
                path: s.path,
                attachmentId: s.attachment_id,
                ratio: s.aspect_ratio,
                prompt: s.prompt,
              })),
              summary: value.summary,
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

          if (!args.product_image) {
            throw new Error('Parameter "product_image" is required.')
          }

          try {
            // 1. Resolve source product image
            const source = await resolveSource(ctx, exec, args.product_image)
            if (!source || !source.bytes) {
              throw new Error(`Product image not found or unreadable: ${args.product_image}`)
            }

            // 2. Extract surface and material hints
            const aesthetics = await deconstructImageAesthetics(source.bytes)
            const materialHints = aesthetics.sharpnessLevel.includes('micro-contrast')
              ? 'high-end matte finish and precision machined metallic edges'
              : 'soft organic tactile surface textures'

            const productName = (args.product_name || args.brand_name || 'commercial product').trim()
            const category = (args.category || 'general').trim().toLowerCase()
            const shotConfigs = buildEcommerceShotPrompts({
              productDescription: productName,
              category,
              brandName: args.brand_name,
              lifestyleSetting: args.lifestyle_setting,
              materialHints,
            })

            const provider = args.provider || (PROVIDER_KEYS.includes(cfg.provider) ? cfg.provider : 'fal')
            const baseSeed = args.seed ?? Math.floor(Math.random() * 100000)

            let subscriptionImages
            try {
              subscriptionImages = ctx.get && ctx.get('subscriptionImages')
            } catch (_err) {
              subscriptionImages = undefined
            }

            // Estimate total cost for 4 shots
            const singleCost = calculateGenerationCost({
              provider,
              model: cfg.model || cfg.customModel || 'default',
              size: '1024x1024',
              count: 1,
            })
            const reservation = reserveSpend(singleCost * shotConfigs.length, cfg.dailyBudgetUsd)
            let committedSpend = 0

            const shots = []
            try {
              const chain = resolveFallbackChain(provider, cfg.fallbackProviders, PROVIDER_KEYS)

              for (let i = 0; i < shotConfigs.length; i++) {
                const shot = shotConfigs[i]
                const shotSeed = baseSeed + i * 17
                const aspectPixels =
                  shot.aspectRatio === '16:9'
                    ? [1344, 768]
                    : shot.aspectRatio === '4:3'
                      ? [1152, 864]
                      : [1024, 1024]

                const providers = makeProviders(
                  { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
                  {
                    prompt: shot.prompt,
                    negativePrompt: shot.negativePrompt,
                    size: shot.size,
                    format: 'png',
                    seed: shotSeed,
                    signal: exec?.signal,
                    aspectPixels,
                    aspectRatio: shot.aspectRatio,
                    referenceImage: source.bytes ? `data:image/png;base64,${source.bytes.toString('base64')}` : undefined,
                    referenceStrength: 0.65,
                  },
                )

                const gen = await executeWithFallback(providers, chain, shotSeed, shot.prompt, {
                  logger: ctx.logger,
                })

                const filename = `ecommerce-${shot.type}-${Date.now()}-${shotSeed}.png`
                const { attachment, localUrl } = await saveAttachmentSafe(ctx, {
                  bytes: gen.bytes,
                  mediaType: 'image/png',
                  name: filename,
                })

                committedSpend += Number(gen.cost) || singleCost
                shots.push({
                  type: shot.type,
                  label: shot.label,
                  path: localUrl || (attachment && attachment.path) || '',
                  attachment_id: attachment ? attachment.id : '',
                  aspect_ratio: shot.aspectRatio,
                  prompt: shot.prompt,
                })
              }

              reservation.commit(committedSpend, {
                ctx,
                meta: { provider, model: cfg.model || cfg.customModel, count: shots.length, category },
              })
            } finally {
              if (committedSpend === 0 && reservation && typeof reservation.release === 'function') {
                reservation.release()
              }
            }

            const summary = `Successfully synthesized 4-shot commercial ${category} photography suite for ${productName}.`
            return toLosslessJson({
              category,
              brand_name: args.brand_name || '',
              count: shots.length,
              shots,
              summary,
            })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || String(err)))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool generate_ecommerce_pack')
}
