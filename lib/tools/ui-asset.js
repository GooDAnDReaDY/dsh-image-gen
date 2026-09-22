// ui-asset.js — generate_ui_asset tool (#284).
// Specialized generator for UI icons, stickers, illustrations, and layout-aware banners with negative space.

import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  ASPECT_RATIOS,
  PROVIDER_KEYS,
  buildSidecar,
  makeProviders,
  removeBackgroundFal,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { resolveFallbackChain, executeWithFallback } from '../fallback-router.js'
import { buildDualOutputMarkdown } from '../resolve-image.js'
import {
  UI_ASSET_TYPES,
  LAYOUT_COMPOSITIONS,
  COLOR_MODES,
  buildUiAssetPrompt,
} from '../ui-asset-helpers.js'

export function registerUiAssetTools(ctx, deps) {
  const {
    live,
    slugify,
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_ui_asset',
        description:
          'Specialized generator for UI elements (icons, illustrations, stickers, badges, banners). '
          + 'Supports layout-aware composition with empty negative space for typography and automatic background removal.',
        parameters: {
          prompt: {
            type: 'string',
            required: true,
            description: 'Subject or motif to generate, e.g. "rocket taking off with smoke trail" or "shopping cart with notification dot".',
          },
          asset_type: {
            type: 'string',
            enum: UI_ASSET_TYPES,
            description: 'Type of UI element: icon, illustration, badge, sticker, or hero_banner (default: icon).',
          },
          transparent: {
            type: 'boolean',
            description: 'When true (default), automatically strips background into a clean transparent PNG.',
          },
          layout_composition: {
            type: 'string',
            enum: LAYOUT_COMPOSITIONS,
            description: 'Negative space layout: isolated (centered), left_empty (negative space on left for text), right_empty, top_empty, or center_empty.',
          },
          color_mode: {
            type: 'string',
            enum: COLOR_MODES,
            description: 'Color styling: flat (solid fills, default), monochrome, duotone, or full_color.',
          },
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
            description: 'Asset aspect ratio. Defaults to 1:1 (or 16:9 for hero_banner).',
          },
          output_name: {
            type: 'string',
            description: 'Optional file stem for saved asset.',
          },
          seed: {
            type: 'integer',
            description: 'Optional seed for reproducible generation.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              path: { type: 'string' },
              url: { type: 'string' },
              asset_type: { type: 'string' },
              layout_composition: { type: 'string' },
              transparent: { type: 'boolean' },
              width: { type: 'integer' },
              height: { type: 'integer' },
              attachment: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
          render(args, value) {
            const summary = `Generated UI ${value.asset_type || 'asset'} (${value.layout_composition || 'isolated'}, ${value.transparent ? 'transparent' : 'opaque'}): ${value.path}`
            return [{ type: 'text', text: summary }]
          },
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
          const cfg = live()
          if (cfg.enabled === false) {
            throw new Error('Image generation is disabled in settings.')
          }

          const asset_type = UI_ASSET_TYPES.includes(args.asset_type) ? args.asset_type : 'icon'
          const layout_composition = LAYOUT_COMPOSITIONS.includes(args.layout_composition) ? args.layout_composition : 'isolated'
          const color_mode = COLOR_MODES.includes(args.color_mode) ? args.color_mode : 'flat'
          const transparent = args.transparent !== false

          const defaultRatio = asset_type === 'hero_banner' ? '16:9' : '1:1'
          const aspectRatio = args.aspect_ratio || defaultRatio
          const aspectPixels = ASPECT_RATIOS[aspectRatio] || [1024, 1024]

          const synthesizedPrompt = buildUiAssetPrompt({
            prompt: args.prompt,
            asset_type,
            layout_composition,
            color_mode,
          })

          const provider = PROVIDER_KEYS.includes(cfg.provider) ? cfg.provider : 'fal'
          let subscriptionImages
          try { subscriptionImages = ctx.get && ctx.get('subscriptionImages') } catch (_) { subscriptionImages = undefined }

          const providers = makeProviders(
            { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
            {
              prompt: synthesizedPrompt,
              size: 'custom',
              format: 'png',
              seed: args.seed,
              signal: exec.signal,
              aspectPixels,
              aspectRatio,
            },
          )

          const chain = resolveFallbackChain(provider, cfg.fallbackProviders, PROVIDER_KEYS)
          const seedVal = args.seed ?? Math.floor(Math.random() * 100000)

          const gen = await executeWithFallback(providers, chain, seedVal, synthesizedPrompt, {
            logger: ctx.logger,
          })

          let finalBytes = gen.bytes
          let mediaType = gen.mediaType || 'image/png'
          let width = gen.width || aspectPixels[0]
          let height = gen.height || aspectPixels[1]

          // Automatic background removal if requested and image is generated
          if (transparent && finalBytes) {
            try {
              const bgResult = await removeBackgroundFal(
                { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg },
                { imageBytes: finalBytes, mediaType, signal: exec.signal },
              )
              if (bgResult && bgResult.bytes) {
                finalBytes = bgResult.bytes
                mediaType = 'image/png'
                if (bgResult.width) width = bgResult.width
                if (bgResult.height) height = bgResult.height
              }
            } catch (bgErr) {
              if (ctx.logger && typeof ctx.logger.warn === 'function') {
                ctx.logger.warn(`[generate_ui_asset] Transparent background removal skipped: ${bgErr.message}`)
              }
            }
          }

          const stem = `${slugify(args.output_name || `${asset_type}-${args.prompt}`)}-${Date.now().toString(36)}-${seedVal}`
          const filename = `${stem}.png`
          const { attachment, localUrl } = await saveAttachmentSafe(ctx, {
            bytes: finalBytes,
            mediaType: 'image/png',
            name: filename,
          })

          const sessionCwd = exec.agent?.session?.header?.cwd
          const targetDir = cfg.outputDir || 'generated/images'
          const outDir = path.resolve(sessionCwd || process.cwd(), targetDir)
          await mkdir(outDir, { recursive: true })
          const filePath = path.join(outDir, filename)
          await writeFile(filePath, finalBytes)

          await writeFile(
            path.join(outDir, `${stem}.json`),
            JSON.stringify(buildSidecar({
              prompt: synthesizedPrompt,
              size: `${width}x${height}`,
              format: 'png',
              seed: seedVal,
              provider: gen._fallback?.providerUsed || provider,
              deliverAs: cfg.deliverAs || 'link',
              width,
              height,
              mediaType: 'image/png',
              attachmentId: attachment.attachmentId,
              url: localUrl,
              cost: gen.cost,
            }), null, 2),
          )

          const dualOutput = buildDualOutputMarkdown({
            action: 'generated',
            filePath,
            width,
            height,
            mediaType: 'image/png',
            seed: seedVal,
            provider: gen._fallback?.providerUsed || provider,
            model: cfg.model || cfg.customModel || 'ui-asset',
            cost: gen.cost,
            attachmentId: attachment.attachmentId,
          })

          return toLosslessJson({
            summary: dualOutput,
            path: filePath,
            url: localUrl,
            asset_type,
            layout_composition,
            color_mode,
            transparent,
            width,
            height,
            seed: seedVal,
            format: 'png',
            attachment,
            _fallback: gen._fallback,
          })
        },
      }),
    )
  }, 'dsh-image-gen: tool generate_ui_asset')
}
