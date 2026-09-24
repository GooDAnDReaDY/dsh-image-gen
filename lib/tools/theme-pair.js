// theme-pair.js — generate_theme_pair tool (#189).
// Synchronized dual generation of light and dark theme visuals with adaptive CSS snippets.

import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  ASPECT_RATIOS,
  buildSidecar,
  makeProviders,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { resolveFallbackChain, executeWithFallback } from '../fallback-router.js'
import { renderToolOutput } from '../attachment-helper.js'
import {
  THEME_STYLES,
  buildThemePairPrompts,
  buildThemePairSnippet,
} from '../theme-pair-helpers.js'

export function registerThemePairTools(ctx, deps) {
  const {
    live,
    slugify,
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_theme_pair',
        description:
          'Generate synchronized dual illustrations or UI graphics designed specifically for light and dark application themes. '
          + 'Produces both light (#FFFFFF clean backdrop) and dark (#0F172A obsidian backdrop with luminous accents) variants with matched composition, plus ready-to-use HTML/CSS responsive markup.',
        parameters: {
          prompt: {
            type: 'string',
            required: true,
            description: 'Core subject or illustration motif, e.g. "cloud server network topology" or "productivity dashboard banner".',
          },
          aspect_ratio: {
            type: 'string',
            enum: Object.keys(ASPECT_RATIOS),
            description: 'Aspect ratio for both variants: "1:1", "16:9", "4:3", etc. (default: "16:9").',
          },
          style: {
            type: 'string',
            enum: THEME_STYLES,
            description: 'Visual style aesthetic (default: "minimalist").',
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
            return renderToolOutput(value)
          },
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
          const cfg = live()
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

          const primaryProvider = cfg.provider || 'fal'
          const chain = resolveFallbackChain(primaryProvider, cfg.fallbackChain)
          const baseSeed = typeof args.seed === 'number' ? args.seed : Math.floor(Math.random() * 1000000)

          const sessionCwd = exec.agent?.session?.header?.cwd
          const targetDir = cfg.outputDir || 'generated/images'
          const outDir = path.resolve(sessionCwd || process.cwd(), targetDir)
          await mkdir(outDir, { recursive: true })

          const slug = args.output_name ? slugify(args.output_name) : slugify(prompt).slice(0, 36)
          const ts = Date.now().toString(36)

          // 1. Generate Light theme variant
          const lightJob = {
            prompt: lightPrompt,
            format: 'png',
            aspectPixels,
            aspectRatio,
            seed: baseSeed,
            signal: exec.signal,
          }
          const lightGen = await executeWithFallback({
            chain,
            liveConfig: cfg,
            makeProvidersFn: (deps, job) => makeProviders(deps, job),
            resolveApiKeyFn: resolveApiKey,
            job: lightJob,
          })

          const lightFilename = `${slug}-light-${ts}.png`
          const lightPath = path.join(outDir, lightFilename)
          await writeFile(lightPath, lightGen.bytes)

          const lightAttachment = await saveAttachmentSafe(ctx, {
            bytes: lightGen.bytes,
            mediaType: 'image/png',
            filename: lightFilename,
            width: lightGen.width || aspectPixels[0],
            height: lightGen.height || aspectPixels[1],
          })
          const lightUrl = lightAttachment.attachmentId ? `/dsh-image-gen/image?id=${encodeURIComponent(lightAttachment.attachmentId)}` : ''

          // 2. Generate Dark theme variant (using matched seed)
          const darkJob = {
            prompt: darkPrompt,
            format: 'png',
            aspectPixels,
            aspectRatio,
            seed: baseSeed,
            signal: exec.signal,
          }
          const darkGen = await executeWithFallback({
            chain,
            liveConfig: cfg,
            makeProvidersFn: (deps, job) => makeProviders(deps, job),
            resolveApiKeyFn: resolveApiKey,
            job: darkJob,
          })

          const darkFilename = `${slug}-dark-${ts}.png`
          const darkPath = path.join(outDir, darkFilename)
          await writeFile(darkPath, darkGen.bytes)

          const darkAttachment = await saveAttachmentSafe(ctx, {
            bytes: darkGen.bytes,
            mediaType: 'image/png',
            filename: darkFilename,
            width: darkGen.width || aspectPixels[0],
            height: darkGen.height || aspectPixels[1],
          })
          const darkUrl = darkAttachment.attachmentId ? `/dsh-image-gen/image?id=${encodeURIComponent(darkAttachment.attachmentId)}` : ''

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
              light: { path: lightPath, url: lightUrl, attachmentId: lightAttachment.attachmentId },
              dark: { path: darkPath, url: darkUrl, attachmentId: darkAttachment.attachmentId },
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
        },
      }),
    )
  }, 'dsh-image-gen: tool generate_theme_pair')
}