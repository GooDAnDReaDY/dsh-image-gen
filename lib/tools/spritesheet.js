// spritesheet — generate_spritesheet tool (#177)

import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { makeProviders, toLosslessJson, saveAttachmentSafe } from '../providers.js'
import { trackAndAssertLoopGuard } from '../loop-guard.js'
import { sanitizeErrorAndLogs } from '../security.js'
import {
  ANIMATION_PRESETS,
  clampFrames,
  buildSpritesheetCss,
  buildSpritesheetSvg,
  buildFramePrompts,
} from '../spritesheet-helpers.js'
import { sizeToPixels } from '../providers.js'

export function registerSpritesheetTools(ctx, deps) {
  const { live, slugify, resolveApiKey } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_spritesheet',
        description:
          'Generate a 2D animation sprite sheet (#177): N consistent frames of a character/UI element in one horizontal strip, '
          + 'plus CSS @keyframes with steps(N) for seamless playback. Supports animation types idle, walk, attack, pulse, hover.',
        parameters: {
          subject: {
            type: 'string',
            required: true,
            description: 'Character or UI element description (e.g. "pixel knight with blue armor").',
          },
          animation: {
            type: 'string',
            description: 'Animation type: idle, walk, attack, pulse, or hover (default idle).',
          },
          frames: {
            type: 'number',
            description: 'Frame count: 4, 8, or 12 (default 8; walk uses 4 or 8).',
          },
          frame_size: {
            type: 'string',
            description: 'Named size for each frame (default square = 512x512, matches sheet tiles).',
          },
          duration: {
            type: 'number',
            description: 'Full loop duration in seconds (default 0.8).',
          },
          output_name: {
            type: 'string',
            description: 'File name stem / CSS class name (default spritesheet).',
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
              frameCount: { type: 'number' },
              animation: { type: 'string' },
              format: { type: 'string' },
              attachment: { type: 'object', additionalProperties: true },
            },
          },
        },
        async execute(args, exec) {
          try {
            const cfg = live()
            trackAndAssertLoopGuard(exec?.agent?.session?.id || 'default', { limit: cfg.loopGuardLimit })
            const animation = String(args.animation || 'idle').toLowerCase()
            const animKey = ANIMATION_PRESETS[animation] ? animation : 'idle'
            const frameCount = clampFrames(args.frames, animKey)
            const provider = cfg.provider || 'fal'
            const format = cfg.defaultFormat || 'png'
            // square (512) matches tile slot; square_hd would overspend then downscale
            const size = args.frame_size || 'square'
            const seed = Math.floor(Math.random() * 100000)
            const prompts = buildFramePrompts(args.subject, animKey, frameCount)

            const frames = []
            for (let i = 0; i < prompts.length; i++) {
              const pdeps = {
                fetchImpl: fetch,
                resolveKey: (ref) => resolveApiKey(ctx, ref),
                cfg,
              }
              const job = { prompt: prompts[i], size, format, seed: seed + i, provider, signal: exec?.signal }
              const providers = makeProviders(pdeps, job)
              const fn = providers[provider] || providers.fal || providers.custom
              const gen = await fn(seed + i, prompts[i])
              frames.push(gen)
            }

            const [frameW, frameH] = sizeToPixels(size)
            const svg = buildSpritesheetSvg(frames, { frameW, frameH })
            const svgBuffer = Buffer.from(svg, 'utf8')
            const stem = slugify(args.output_name || 'spritesheet')
            const sheetName = `${stem}-sheet.svg`
            const { attachment, localUrl } = await saveAttachmentSafe(ctx, {
              bytes: svgBuffer,
              mediaType: 'image/svg+xml',
              name: sheetName,
            })

            const sessionCwd = exec?.agent?.session?.header?.cwd
            const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir || 'generated/images')
            await mkdir(outDir, { recursive: true })
            const filePath = path.join(outDir, sheetName)
            await writeFile(filePath, svgBuffer)

            const durationSec = Number(args.duration) > 0 ? Number(args.duration) : 0.8
            const css = buildSpritesheetCss({
              frameCount,
              frameW,
              frameH,
              durationSec,
              name: stem,
            })
            const cssPath = path.join(outDir, `${stem}.css`)
            await writeFile(cssPath, css, 'utf8')

            const summary = `### Sprite sheet (${animKey}, ${frameCount} frames)\n`
              + `- **Sheet**: \`${filePath}\` (${frameW * frameCount}×${frameH})\n`
              + `- **CSS**: \`${cssPath}\` — \`animation: ${stem} ${durationSec}s steps(${frameCount}) infinite\`\n\n`
              + `![${stem}](${localUrl || filePath})`

            return toLosslessJson({
              summary,
              path: filePath,
              url: localUrl,
              css,
              cssPath,
              frameCount,
              animation: animKey,
              format: 'svg',
              attachment,
            })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool generate_spritesheet')
}
