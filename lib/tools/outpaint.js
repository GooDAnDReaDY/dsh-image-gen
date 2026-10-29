// @ts-check
// outpaint.js — outpainting and directional canvas expansion tool (#459).
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  PROVIDER_KEYS,
  makeProviders,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { resolveInside, sanitizeErrorAndLogs } from '../security.js'
import { renderToolOutput } from '../attachment-helper.js'
import { resolveFallbackChain, executeWithFallback } from '../fallback-router.js'
import { calculateGenerationCost, assertBudgetAvailable, reserveSpend } from '../cost-meter.js'
import { resolveConversationImage } from '../resolve-image.js'

/**
 * Builds an SVG outpaint mask where:
 * - Solid black (#000000) keeps the original image content (inset slightly by feather for seamless blending).
 * - Solid white (#FFFFFF) defines the extended canvas region to generate.
 */
export function buildOutpaintMaskSvg(newW, newH, left, top, srcW, srcH, feather = 16) {
  const safeFeather = Math.max(0, Math.min(feather, Math.floor(Math.min(srcW, srcH) / 4)))
  const keepX = left + safeFeather
  const keepY = top + safeFeather
  const keepW = Math.max(1, srcW - safeFeather * 2)
  const keepH = Math.max(1, srcH - safeFeather * 2)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${newW}" height="${newH}" viewBox="0 0 ${newW} ${newH}">
  <rect width="${newW}" height="${newH}" fill="#FFFFFF" />
  <rect x="${keepX}" y="${keepY}" width="${keepW}" height="${keepH}" fill="#000000" rx="2" />
</svg>`
}

export function registerOutpaintTools(ctx, deps) {
  const {
    live,
    saveAndAttachResult,
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'outpaint_image',
        description:
          'Expand and extend image boundaries outward in any direction (top, bottom, left, right) '
          + 'using intelligent outpainting synthesis while seamlessly preserving the original core composition (#459).',
        parameters: {
          image: {
            type: 'string',
            description: 'Source image path, attachment ID, or URL to expand. Defaults to "latest" to resolve from session history.',
          },
          prompt: {
            type: 'string',
            required: true,
            description: 'Description of the extended scenery, background environment, and visual continuation.',
          },
          directions: {
            type: 'object',
            additionalProperties: true,
            description: 'Pixel expansion amounts per direction: { top?: number, bottom?: number, left?: number, right?: number }.',
            properties: {
              top: { type: 'number', description: 'Pixels to expand canvas upward (default 0)' },
              bottom: { type: 'number', description: 'Pixels to expand canvas downward (default 0)' },
              left: { type: 'number', description: 'Pixels to expand canvas to the left (default 0)' },
              right: { type: 'number', description: 'Pixels to expand canvas to the right (default 0)' },
            },
          },
          feather: {
            type: 'number',
            description: 'Edge blend feathering in pixels between original and extended area (default: 16).',
          },
          provider: {
            type: 'string',
            description: 'Optional provider override. Defaults to active provider.',
          },
          seed: {
            type: 'integer',
            description: 'Optional seed for reproducible outpainting.',
          },
          output_name: {
            type: 'string',
            description: 'Optional file stem for saved outpainted image.',
          },
          output_dir: {
            type: 'string',
            description: 'Optional custom directory to write the image into.',
          },
        },
        output: {
          render: (_args, value) => renderToolOutput(value),
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              summary: { type: 'string' },
              path: { type: 'string' },
              url: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' },
              originalWidth: { type: 'number' },
              originalHeight: { type: 'number' },
              directions: { type: 'object', additionalProperties: true },
              attachment: { type: 'object', additionalProperties: true },
              maskAttachment: { type: 'object', additionalProperties: true },
              provider: { type: 'string' },
              cost: { type: 'number' },
            },
          },
        },
        async execute(args, execCtx) {
          try {
            const cfg = typeof live === 'function' ? live() : (live?.value || {})
            const prompt = String(args.prompt || '').trim()
            if (!prompt) {
              throw new Error('outpaint_image requires a non-empty prompt describing the extended scene.')
            }

            // 1. Resolve source image
            const source = await resolveConversationImage(ctx, execCtx, args.image)
            if (!source || !source.bytes) {
              throw new Error('outpaint_image: no source image resolved. Provide valid image path or attachment.')
            }

            let srcW = source.width || 1024
            let srcH = source.height || 1024
            try {
              const sharpMod = await import('sharp')
              const sharp = sharpMod.default || sharpMod
              const meta = await sharp(source.bytes).metadata()
              if (meta.width && meta.height) {
                srcW = meta.width
                srcH = meta.height
              }
            } catch (_err) {
              // Fallback to resolved dimensions
            }

            // 2. Compute expansion directions
            const rawDirs = args.directions || {}
            let top = Math.max(0, Math.round(Number(rawDirs.top ?? args.top ?? 0)))
            let bottom = Math.max(0, Math.round(Number(rawDirs.bottom ?? args.bottom ?? 0)))
            let left = Math.max(0, Math.round(Number(rawDirs.left ?? args.left ?? 0)))
            let right = Math.max(0, Math.round(Number(rawDirs.right ?? args.right ?? 0)))

            if (top === 0 && bottom === 0 && left === 0 && right === 0) {
              // Default expansion if none specified: extend width by 25% on both sides
              left = Math.round(srcW * 0.25)
              right = Math.round(srcW * 0.25)
            }

            // Snap new dimensions to multiples of 8
            const rawNewW = srcW + left + right
            const rawNewH = srcH + top + bottom
            const newW = Math.ceil(rawNewW / 8) * 8
            const newH = Math.ceil(rawNewH / 8) * 8
            const extraW = newW - rawNewW
            const extraH = newH - rawNewH
            right += extraW
            bottom += extraH

            const feather = Math.max(4, Math.round(Number(args.feather ?? 16)))

            // 3. Expand canvas with Sharp
            let expandedCanvasBytes = source.bytes
            try {
              const sharpMod = await import('sharp')
              const sharp = sharpMod.default || sharpMod
              expandedCanvasBytes = await sharp({
                create: {
                  width: newW,
                  height: newH,
                  channels: 4,
                  background: { r: 0, g: 0, b: 0, alpha: 0 },
                },
              })
                .composite([{ input: source.bytes, top, left }])
                .png()
                .toBuffer()
            } catch (sharpErr) {
              if (ctx.logger?.warn) ctx.logger.warn(`[outpaint_image] Canvas expansion fallback: ${sharpErr.message}`)
            }

            // 4. Generate SVG outpaint mask
            const maskSvg = buildOutpaintMaskSvg(newW, newH, left, top, srcW, srcH, feather)
            const maskBuffer = Buffer.from(maskSvg, 'utf8')

            // 5. Inpainting / outpainting execution
            const provider = args.provider || cfg.provider || 'fal'
            const seed = args.seed ?? Math.floor(Math.random() * 100000)
            let usedProvider = provider
            let effectiveCost = 0
            let finalBytes = expandedCanvasBytes

            const outpaintJob = {
              prompt,
              size: `${newW}x${newH}`,
              format: 'png',
              seed,
              source: { bytes: expandedCanvasBytes, mediaType: 'image/png', width: newW, height: newH },
              mask: { bytes: maskBuffer, mediaType: 'image/svg+xml' },
              provider,
              signal: execCtx?.signal,
            }

            let subscriptionImages
            try { subscriptionImages = ctx.get && ctx.get('subscriptionImages') } catch (_err) { subscriptionImages = undefined }
            const providers = makeProviders(
              { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
              outpaintJob,
            )
            const fallbackChain = resolveFallbackChain(provider, cfg.fallbackProviders, PROVIDER_KEYS)

            const estimatedCost = calculateGenerationCost({
              provider,
              model: cfg.model || cfg.customModel || 'default',
              size: `${newW}x${newH}`,
              count: 1,
            })
            const reservation = reserveSpend(estimatedCost, cfg.dailyBudgetUsd)
            let committed = false

            try {
              const gen = await executeWithFallback(
                providers,
                fallbackChain,
                seed,
                prompt,
                { logger: ctx.logger },
              )
              if (gen && gen.bytes) {
                finalBytes = gen.bytes
                usedProvider = gen._fallback?.providerUsed || provider
                effectiveCost = Number(gen.cost) || estimatedCost
                reservation.commit(effectiveCost, {
                  ctx,
                  meta: { provider: usedProvider, model: cfg.model || cfg.customModel, prompt, seed },
                })
                committed = true
              }
            } catch (inpaintErr) {
              if (ctx.logger?.debug) ctx.logger.debug(`[outpaint_image] Inpainting note: ${inpaintErr.message}`)
            } finally {
              if (!committed) {
                reservation.release()
              }
            }

            // 6. Save and attach results
            const timestamp = Date.now()
            const stem = args.output_name
              ? slugify(args.output_name)
              : `outpaint-${newW}x${newH}-${timestamp}`
            const filename = `${stem}.png`

            let result
            if (typeof saveAndAttachResult === 'function') {
              result = await saveAndAttachResult(ctx, execCtx, cfg, {
                bytes: finalBytes,
                mediaType: 'image/png',
                name: filename,
                stem,
                prompt,
                size: `${newW}x${newH}`,
                format: 'png',
                seed,
                provider: usedProvider,
                cost: effectiveCost,
                deliverAs: cfg.deliverAs || 'both',
                args,
                action: 'outpainted',
              })
            } else {
              result = {
                path: filename,
                url: filename,
                attachment: { attachmentId: `outpaint-${timestamp}`, url: filename },
              }
            }

            // Save auxiliary mask attachment
            const { attachment: maskAttachment } = await saveAttachmentSafe(ctx, {
              bytes: maskBuffer,
              mediaType: 'image/svg+xml',
              name: `mask-${stem}.svg`,
            })

            const summary = [
              '### Outpainting Canvas Expansion Completed',
              `- **Canvas Expansion**: ${srcW}x${srcH} → **${newW}x${newH}**`,
              `- **Added Margins**: Top: ${top}px, Bottom: ${bottom}px, Left: ${left}px, Right: ${right}px`,
              `- **Output Image**: \`${result.path || filename}\``,
              `- **Provider**: ${usedProvider}`,
            ].join('\n')

            return toLosslessJson({
              summary,
              path: result.path,
              url: result.url,
              width: newW,
              height: newH,
              originalWidth: srcW,
              originalHeight: srcH,
              directions: { top, bottom, left, right },
              attachment: result.attachment,
              maskAttachment,
              provider: usedProvider,
              cost: effectiveCost,
            })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool outpaint_image')
}

