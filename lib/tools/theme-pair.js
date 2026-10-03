// theme-pair.js — generate_theme_pair tool (#189, #361).
// Generates complementary Light & Dark mode asset variants with synchronized compositions.

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
import { assertBudgetAvailable, calculateGenerationCost, reserveSpend, recordSpend } from '../cost-meter.js'
import { renderToolOutput } from '../attachment-helper.js'
import {
  THEME_STYLES,
  buildThemePairPrompts,
  buildThemePairSnippet,
} from '../theme-pair-helpers.js'

export function registerThemePairTools(ctx, deps) {
  const {
    live,
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_theme_pair',
        description:
          'Generate matching Light and Dark mode UI illustration variants with synchronized seeds, '
          + 'consistent composition, and inverted contrast palettes. Outputs a responsive <picture> tag with prefers-color-scheme.',
        parameters: {
          prompt: {
            type: 'string',
            description: 'Core visual concept description (e.g. "cloud database topology architecture").',
            required: true,
          },
          style: {
            type: 'string',
            enum: THEME_STYLES,
            description: 'Aesthetic visual direction: minimalist, neon_cyberpunk, editorial, gradient_glass, 3d_clay.',
          },
          aspect_ratio: {
            type: 'string',
            enum: ['16:9', '1:1', '4:3', '21:9'],
            description: 'Asset aspect ratio (default: 16:9).',
          },
          dark_contrast_boost: {
            type: 'number',
            description: 'Multiplier for glow and highlight contrast in the dark variant (default: 1.2).',
          },
          output_name: {
            type: 'string',
            description: 'Base filename prefix for the pair (default: auto-slugified from prompt).',
          },
          seed: {
            type: 'integer',
            description: 'Base random seed to synchronize composition between variants.',
          },
          provider: {
            type: 'string',
            description: 'Optional provider override. Defaults to active provider.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              summary: { type: 'string' },
              prompt: { type: 'string' },
              style: { type: 'string' },
              light: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  path: { type: 'string' },
                  url: { type: 'string' },
                  attachment: { type: 'object', additionalProperties: true },
                },
              },
              dark: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  path: { type: 'string' },
                  url: { type: 'string' },
                  attachment: { type: 'object', additionalProperties: true },
                },
              },
              html_snippet: { type: 'string' },
              css_snippet: { type: 'string' },
            },
          },
          render(_args, value) {
            const blocks = renderToolOutput(value)
            const metaTag = `<dsh-image-gen-theme-pair>${JSON.stringify({
              light: value.light,
              dark: value.dark,
              html_snippet: value.html_snippet,
              css_snippet: value.css_snippet,
            })}</dsh-image-gen-theme-pair>`
            if (blocks[0] && blocks[0].type === 'text') {
              blocks[0].text += `\n\n${metaTag}`
            }
            return blocks
          },
          presentationMeta(_args, value) {
            return {
              light: value.light,
              dark: value.dark,
              html_snippet: value.html_snippet,
              css_snippet: value.css_snippet,
            }
          },
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
          const cfg = typeof live === 'function' ? live() : (live?.value || {})
          if (cfg.enabled === false) {
            throw new Error('Image generation is disabled in settings.')
          }

          const prompt = String(args.prompt || '').trim()
          if (!prompt) {
            throw new Error('Prompt is required for generate_theme_pair')
          }

          const style = THEME_STYLES.includes(args.style) ? args.style : 'minimalist'
          const aspectRatio = args.aspect_ratio || '16:9'
          const aspectPixels = ASPECT_RATIOS[aspectRatio] || [1344, 768]
          const darkContrastBoost = typeof args.dark_contrast_boost === 'number' ? args.dark_contrast_boost : 1.2

          const { lightPrompt, darkPrompt } = buildThemePairPrompts({
            prompt,
            style,
            darkContrastBoost,
          })

          const primaryProvider = PROVIDER_KEYS.includes(args.provider || cfg.provider)
            ? (args.provider || cfg.provider)
            : (PROVIDER_KEYS.includes(cfg.provider) ? cfg.provider : 'fal')

          const estimatedCost = calculateGenerationCost({
            provider: primaryProvider,
            model: cfg.model || cfg.customModel || 'default',
            size: cfg.defaultSize || '1024x1024',
            count: 2,
          })
          const batchReservation = reserveSpend(estimatedCost, cfg.dailyBudgetUsd)
          let committed = false
          try {
          const chain = resolveFallbackChain(primaryProvider, cfg.fallbackProviders, PROVIDER_KEYS)
          const baseSeed = typeof args.seed === 'number' ? args.seed : Math.floor(Math.random() * 1000000)

          const sessionCwd = exec?.agent?.session?.header?.cwd
          const targetDir = cfg.outputDir || 'generated/images'
          const outDir = path.resolve(sessionCwd || process.cwd(), targetDir)
          await mkdir(outDir, { recursive: true })

          const slug = args.output_name ? slugify(args.output_name) : slugify(prompt).slice(0, 36)
          const ts = Date.now().toString(36)

          let subscriptionImages
          try { subscriptionImages = ctx.get && ctx.get('subscriptionImages') } catch (_err) { subscriptionImages = undefined }

          // 1. Generate Light theme variant
          const lightJob = {
            prompt: lightPrompt,
            format: 'png',
            aspectPixels,
            aspectRatio,
            seed: baseSeed,
            signal: exec?.signal,
          }
          const lightProviders = makeProviders(
            { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
            lightJob,
          )
          const lightGen = await executeWithFallback(
            lightProviders,
            chain,
            baseSeed,
            lightPrompt,
            { logger: ctx.logger },
          )

          const lightFilename = `${slug}-light-${ts}.png`
          const lightPath = path.join(outDir, lightFilename)
          await writeFile(lightPath, Buffer.from(lightGen.bytes))

          const { attachment: lightAttachment, localUrl: lightUrl } = await saveAttachmentSafe(ctx, {
            bytes: lightGen.bytes,
            mediaType: 'image/png',
            name: lightFilename,
            width: lightGen.width || aspectPixels[0],
            height: lightGen.height || aspectPixels[1],
          })
          const halfCost = +(estimatedCost / 2).toFixed(4)
          batchReservation.commit(Number(lightGen.cost) || halfCost, {
            ctx,
            meta: { provider: primaryProvider, model: cfg.model || cfg.customModel, prompt: lightPrompt },
          })

          // 2. Generate Dark theme variant (using matched seed)
          const darkJob = {
            prompt: darkPrompt,
            format: 'png',
            aspectPixels,
            aspectRatio,
            seed: baseSeed,
            signal: exec?.signal,
          }
          const darkProviders = makeProviders(
            { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
            darkJob,
          )

          let darkGen
          try {
            darkGen = await executeWithFallback(
              darkProviders,
              chain,
              baseSeed,
              darkPrompt,
              { logger: ctx.logger },
            )
          } catch (darkErr) {
            throw new Error(`Failed to generate dark theme variant: ${darkErr.message}`)
          }

          const darkFilename = `${slug}-dark-${ts}.png`
          const darkPath = path.join(outDir, darkFilename)
          await writeFile(darkPath, Buffer.from(darkGen.bytes))

          const { attachment: darkAttachment, localUrl: darkUrl } = await saveAttachmentSafe(ctx, {
            bytes: darkGen.bytes,
            mediaType: 'image/png',
            name: darkFilename,
            width: darkGen.width || aspectPixels[0],
            height: darkGen.height || aspectPixels[1],
          })
          batchReservation.commit(Number(darkGen.cost) || halfCost, {
            ctx,
            meta: { provider: primaryProvider, model: cfg.model || cfg.customModel, prompt: darkPrompt },
          })

          // Sidecars
          await writeFile(
            path.join(outDir, `${slug}-pair-${ts}.json`),
            JSON.stringify(buildSidecar({
              prompt,
              style,
              aspectRatio,
              size: `${aspectPixels[0]}x${aspectPixels[1]}`,
              format: 'png',
              seed: baseSeed,
              light: { path: lightPath, url: lightUrl, attachmentId: lightAttachment?.attachmentId },
              dark: { path: darkPath, url: darkUrl, attachmentId: darkAttachment?.attachmentId },
              cost: (lightGen.cost || 0) + (darkGen.cost || 0),
            }), null, 2),
          )

          const { html, css } = buildThemePairSnippet({
            lightSrc: lightFilename,
            darkSrc: darkFilename,
            alt: prompt,
          })

          const summary = `Generated Theme Pair (${style}, ${aspectRatio}):\n`
            + `- Light: ${lightFilename} (seed: ${baseSeed})\n`
            + `- Dark: ${darkFilename} (seed: ${baseSeed})\n\n`
            + `\`\`\`html\n${html}\n\`\`\``

          committed = true
          return toLosslessJson({
            summary,
            prompt,
            style,
            aspect_ratio: aspectRatio,
            light: {
              path: lightPath,
              url: lightUrl,
              filename: lightFilename,
              width: lightGen.width || aspectPixels[0],
              height: lightGen.height || aspectPixels[1],
              attachment: lightAttachment,
            },
            dark: {
              path: darkPath,
              url: darkUrl,
              filename: darkFilename,
              width: darkGen.width || aspectPixels[0],
              height: darkGen.height || aspectPixels[1],
              attachment: darkAttachment,
            },
            html_snippet: html,
            css_snippet: css,
            attachment: lightAttachment,
          })
          } finally {
            if (!committed) {
              batchReservation.release()
            }
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool generate_theme_pair')
}
