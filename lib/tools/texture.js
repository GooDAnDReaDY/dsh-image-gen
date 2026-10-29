// @ts-check
// texture.js — Tool generate_seamless_texture: Seamless tiling texture and repetitive pattern generator (#468).

import { defineTool } from '@deepseek-ai/dsh-tools'
import { sanitizeErrorAndLogs } from '../security.js'
import {
  PROVIDER_KEYS,
  buildSidecar,
  makeProviders,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { resolveFallbackChain, executeWithFallback } from '../fallback-router.js'
import { assertBudgetAvailable, calculateGenerationCost, reserveSpend } from '../cost-meter.js'
import { scoreImageEdgeWrap } from '../pattern-helpers.js'
import {
  buildTexturePrompt,
  blendSeamCross,
  render3x3TiledPreview,
  formatTextureMarkdown,
} from '../texture-helpers.js'

export function registerTextureTools(ctx, deps) {
  const {
    live = () => (deps.cfg && typeof deps.cfg === 'function' ? deps.cfg() : deps.cfg || {}),
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey = () => '',
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_seamless_texture',
        description:
          'Generate seamless tileable textures and repetitive surface patterns for 3D materials, game development, and web backgrounds. '
          + 'Includes toroidal seam offset blending and automatic 3×3 inspection grid preview (#468).',
        parameters: {
          prompt: {
            type: 'string',
            required: true,
            description: 'Material or surface motif description (e.g. "weathered brick wall", "sci-fi hex plating", "mossy cobblestone").',
          },
          tile_mode: {
            type: 'string',
            enum: ['xy', 'x', 'y'],
            description: 'Tiling dimensions: "xy" (both horizontal and vertical), "x" (horizontal only), or "y" (vertical only). Default: "xy".',
          },
          style: {
            type: 'string',
            description: 'Visual rendering style (e.g. "photorealistic PBR material", "stylized hand-painted", "vector").',
          },
          offset_blend: {
            type: 'boolean',
            description: 'Whether to perform 50% toroidal offset seam smoothing to guarantee seamless boundary transitions (default: true).',
          },
          preview_grid: {
            type: 'boolean',
            description: 'Whether to generate and attach a 3×3 tiled inspection grid (default: true).',
          },
          provider: {
            type: 'string',
            description: 'Optional provider override (e.g. fal, replicate, gemini, custom).',
          },
          seed: {
            type: 'number',
            description: 'Deterministic generation seed.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              texture_image: { type: 'string' },
              texture_id: { type: 'string' },
              preview_image: { type: 'string' },
              preview_id: { type: 'string' },
              tile_mode: { type: 'string' },
              prompt: { type: 'string' },
              seam_score: { type: 'number' },
            },
          },
          render(_args, value) {
            if (!value) return [{ type: 'text', text: 'Texture generation failed' }]
            const markdown = formatTextureMarkdown({
              prompt: value.prompt,
              tileMode: value.tile_mode,
              texturePath: value.texture_image,
              previewPath: value.preview_image,
              textureId: value.texture_id,
              previewId: value.preview_id,
              seamScore: value.seam_score,
            })
            const metaTag = `<dsh-image-gen-texture>${JSON.stringify({
              prompt: value.prompt,
              tile_mode: value.tile_mode,
              texture_image: value.texture_image,
              texture_id: value.texture_id,
              preview_image: value.preview_image,
              seam_score: value.seam_score,
            })}</dsh-image-gen-texture>`
            return [{ type: 'text', text: `${markdown}\n\n${metaTag}` }]
          },
          presentationMeta(_args, value) {
            return {
              prompt: value?.prompt,
              tile_mode: value?.tile_mode,
              texture_image: value?.texture_image,
              preview_image: value?.preview_image,
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
          if (!rawPrompt) {
            throw new Error('Parameter "prompt" is required.')
          }

          const tileMode = args.tile_mode || 'xy'
          const effectivePrompt = buildTexturePrompt({
            prompt: rawPrompt,
            tileMode,
            style: args.style,
          })

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
                prompt: effectivePrompt,
                negativePrompt: 'seam, visible border, edge frame, vignette, cropped, non-tileable',
                size: 'custom',
                format: 'png',
                seed,
                signal: exec?.signal,
                aspectPixels: [1024, 1024],
                aspectRatio: '1:1',
              },
            )

            const gen = await executeWithFallback(providers, chain, seed, effectivePrompt, {
              logger: ctx.logger,
            })

            let finalTileBuffer = gen.bytes

            // 1. Post-processing: 50% toroidal offset seam smoothing
            if (args.offset_blend !== false && finalTileBuffer) {
              finalTileBuffer = await blendSeamCross(finalTileBuffer, { seamWidth: 16, tileMode })
            }

            // 2. Measure seam edge wrap score
            const seamScore = await scoreImageEdgeWrap(finalTileBuffer)

            // 3. Save single seamless texture tile
            const stem = slugify(rawPrompt.slice(0, 28) || 'seamless-texture')
            const tileFilename = `${stem}-tile-${seed}.png`
            const saveTileResult = await saveAttachmentSafe(ctx, {
              bytes: finalTileBuffer,
              mediaType: 'image/png',
              name: tileFilename,
            })
            const texturePath = saveTileResult?.localUrl || (saveTileResult?.attachment && saveTileResult.attachment.path) || tileFilename
            const textureId = (saveTileResult?.attachment && saveTileResult.attachment.id) ? String(saveTileResult.attachment.id) : null

            // 4. Render 3x3 tiled inspection grid
            let previewPath = null
            let previewId = null
            if (args.preview_grid !== false && finalTileBuffer) {
              const previewBuffer = await render3x3TiledPreview(finalTileBuffer, 256)
              const previewFilename = `${stem}-tiled-3x3-${seed}.png`
              const savePreviewResult = await saveAttachmentSafe(ctx, {
                bytes: previewBuffer,
                mediaType: 'image/png',
                name: previewFilename,
              })
              previewPath = savePreviewResult?.localUrl || (savePreviewResult?.attachment && savePreviewResult.attachment.path) || previewFilename
              previewId = (savePreviewResult?.attachment && savePreviewResult.attachment.id) ? String(savePreviewResult.attachment.id) : null
            }

            const effectiveCost = Number(gen.cost) || estimatedCost
            reservation.commit(effectiveCost, {
              ctx,
              meta: { provider, model: cfg.model || cfg.customModel, prompt: effectivePrompt, seed },
            })
            committed = true

            return {
              texture_image: texturePath,
              texture_id: textureId,
              preview_image: previewPath,
              preview_id: previewId,
              tile_mode: tileMode,
              prompt: rawPrompt,
              seam_score: seamScore,
            }
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || String(err)))
          } finally {
            if (!committed && reservation && typeof reservation.release === 'function') {
              reservation.release()
            }
          }
        },
      })
    )
  }, 'dsh-image-gen: tool generate_seamless_texture')
}