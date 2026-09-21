// pattern — generate_seamless_pattern tool (#178)

import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { makeProviders, toLosslessJson, saveAttachmentSafe, sizeToPixels } from '../providers.js'
import { trackAndAssertLoopGuard } from '../loop-guard.js'
import { sanitizeErrorAndLogs } from '../security.js'
import {
  buildSeamlessPrompt,
  buildPatternCss,
  normalizeDensity,
} from '../pattern-helpers.js'

export function registerPatternTools(ctx, deps) {
  const { live, slugify, resolveApiKey } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_seamless_pattern',
        description:
          'Generate a seamless tileable repeating pattern for backgrounds (#178). '
          + 'Describe the motif and optional style; returns a square pattern image plus CSS background-repeat snippet.',
        parameters: {
          motif: {
            type: 'string',
            required: true,
            description: 'What to repeat (e.g. "terrazzo chips", "sakura blossoms", "circuit traces").',
          },
          style: {
            type: 'string',
            description: 'Visual style (e.g. "watercolor", "flat vector", "isometric").',
          },
          density: {
            type: 'string',
            description: 'Motif density: low, medium, or high (default medium).',
          },
          size: {
            type: 'string',
            description: 'Named image size (default square).',
          },
          output_name: {
            type: 'string',
            description: 'File name stem / CSS class (default seamless-pattern).',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              summary: { type: 'string' },
              path: { type: 'string' },
              url: { type: 'string' },
              css: { type: 'string' },
              cssPath: { type: 'string' },
              format: { type: 'string' },
              attachment: { type: 'object', additionalProperties: true },
            },
          },
        },
        async execute(args, exec) {
          try {
            const cfg = live()
            trackAndAssertLoopGuard(exec?.agent?.session?.id || 'default', { limit: cfg.loopGuardLimit })
            const density = normalizeDensity(args.density)
            const prompt = buildSeamlessPrompt(args.motif, args.style, density)
            const provider = cfg.provider || 'fal'
            const format = cfg.defaultFormat || 'png'
            const size = args.size || 'square'
            const seed = Math.floor(Math.random() * 100000)

            const pdeps = {
              fetchImpl: fetch,
              resolveKey: (ref) => resolveApiKey(ctx, ref),
              cfg,
            }
            const job = { prompt, size, format, seed, provider, signal: exec?.signal }
            const providers = makeProviders(pdeps, job)
            const fn = providers[provider] || providers.fal || providers.custom
            const gen = await fn(seed, prompt)

            const stem = slugify(args.output_name || 'seamless-pattern')
            const name = `${stem}.${format}`
            const { attachment, localUrl } = await saveAttachmentSafe(ctx, {
              bytes: gen.bytes,
              mediaType: gen.mediaType || 'image/png',
              name,
            })

            const sessionCwd = exec?.agent?.session?.header?.cwd
            const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir || 'generated/images')
            await mkdir(outDir, { recursive: true })
            const filePath = path.join(outDir, name)
            await writeFile(filePath, gen.bytes)

            const [tilePx] = sizeToPixels(size)
            const css = buildPatternCss({ className: stem, sizePx: tilePx, imagePath: `./${name}` })
            const cssPath = path.join(outDir, `${stem}.css`)
            await writeFile(cssPath, css, 'utf8')

            const summary = `### Seamless pattern (${density})\n`
              + `- **Motif**: ${args.motif}\n`
              + `- **File**: \`${filePath}\`\n`
              + `- **CSS**: \`${cssPath}\`\n\n`
              + `![${stem}](${localUrl || filePath})`

            return toLosslessJson({
              summary,
              path: filePath,
              url: localUrl,
              css,
              cssPath,
              format,
              attachment,
            })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool generate_seamless_pattern')
}
