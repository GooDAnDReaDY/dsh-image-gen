// responsive — generate_responsive_mockups tool (#173)

import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  makeProviders,
  toLosslessJson,
  saveAttachmentSafe,
  tryGenerate,
  fallbackOrder,
  PROVIDER_KEYS,
} from '../providers.js'
import { trackAndAssertLoopGuard } from '../loop-guard.js'
import { sanitizeErrorAndLogs } from '../security.js'
import { buildDualOutputMarkdown } from '../resolve-image.js'
import {
  buildResponsivePrompt,
  deviceMeta,
  mockupFileName,
  normalizeDevices,
  resolveDevicePreset,
} from '../responsive-helpers.js'

async function asyncPool(tasks, concurrency = 3) {
  const results = new Array(tasks.length)
  let nextIdx = 0
  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++
      results[idx] = await tasks[idx]()
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  )
  return results
}

export function registerResponsiveTools(ctx, deps) {
  const { live, resolveApiKey } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_responsive_mockups',
        description:
          'Generate one product UI mockup across Mobile (9:16), Tablet (3:4) and Desktop (16:9) viewports in one call (#173). '
          + 'Keeps prompt, style and brand palette synchronized so the three screens look like the same product family. '
          + 'Saves mockup-mobile.png, mockup-tablet.png and mockup-desktop.png and shows a tabbed preview in chat.',
        parameters: {
          prompt: {
            type: 'string',
            required: true,
            description: 'Shared product/screen description used for all viewports (e.g. "settings dashboard for a smart home app").',
          },
          devices: {
            type: 'array',
            items: { type: 'string' },
            description: 'Subset of viewports: mobile, tablet, desktop. Default: all three.',
          },
          style_preset: {
            type: 'string',
            description: 'Optional style preset shared by all viewports (same catalog as generate_image).',
          },
          palette_colors: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional brand color hex list enforced across every viewport for visual consistency.',
          },
          seed: {
            type: 'integer',
            description: 'Optional base seed for reproducible responsive sets (each device uses seed, seed+1, seed+2…).',
          },
          output_name: {
            type: 'string',
            description: 'Optional file stem. Default produces mockup-mobile.png, mockup-tablet.png, mockup-desktop.png.',
          },
          output_dir: {
            type: 'string',
            description: 'Optional directory relative to session cwd (defaults to settings outputDir).',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              summary: { type: 'string' },
              images: { type: 'array', items: { type: 'object', additionalProperties: true } },
              devices: { type: 'array', items: { type: 'string' } },
              count: { type: 'number' },
              seedBase: { type: 'number' },
              provider: { type: 'string' },
              warnings: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        async execute(args, exec) {
          try {
            const cfg = live()
            trackAndAssertLoopGuard(exec?.agent?.session?.id || 'default', { limit: cfg.loopGuardLimit })
            if (!args.prompt || !String(args.prompt).trim()) {
              throw new Error('prompt is required for generate_responsive_mockups')
            }

            const devices = normalizeDevices(args.devices)
            if (!devices.length) {
              throw new Error('devices must include at least one of: mobile, tablet, desktop')
            }

            const provider = cfg.provider || 'fal'
            const format = cfg.defaultFormat || 'png'
            const seedBase = Number.isInteger(args.seed) ? args.seed : Math.floor(Math.random() * 100000)
            const stylePreset = args.style_preset || cfg.stylePreset
            const paletteColors = Array.isArray(args.palette_colors) ? args.palette_colors : undefined
            const sessionCwd = exec?.agent?.session?.header?.cwd
            const targetDir = (args.output_dir && String(args.output_dir).trim()) || cfg.outputDir || 'generated/images'
            const outDir = path.resolve(sessionCwd || process.cwd(), targetDir)
            await mkdir(outDir, { recursive: true })

            const pdeps = {
              fetchImpl: fetch,
              resolveKey: (ref) => resolveApiKey(ctx, ref),
              cfg,
            }
            const order = fallbackOrder(provider)
            const warnings = []

            const tasks = devices.map((device, index) => async () => {
              const preset = resolveDevicePreset(device)
              const devicePrompt = buildResponsivePrompt(args.prompt, {
                device,
                stylePreset,
                paletteColors,
              })
              const seed = seedBase + index
              const job = {
                prompt: devicePrompt,
                size: preset.size,
                format,
                seed,
                provider,
                ...(stylePreset ? { style: stylePreset, style_preset: stylePreset } : {}),
                ...(paletteColors ? { palette_colors: paletteColors } : {}),
                signal: exec?.signal,
              }
              const providers = makeProviders(pdeps, job)
              const generators = Object.fromEntries(PROVIDER_KEYS.map((k) => [
                k,
                async (s, p) => {
                  const fn = providers[k]
                  if (typeof fn !== 'function') throw new Error(`provider ${k} unavailable`)
                  return fn(s, p)
                },
              ]))

              try {
                const gen = await tryGenerate(generators, order, seed, devicePrompt)
                let bytes = gen.bytes || gen.image || gen.buffer
                if (bytes && !Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes)
                if (!bytes || !bytes.length) throw new Error('provider returned empty image bytes')

                const name = mockupFileName(device, {
                  outputName: String(args.output_name || '').trim() || undefined,
                })
                const mediaType = gen.mediaType
                  || `image/${String(gen.format || format).replace('jpg', 'jpeg')}`
                const { attachment, localUrl } = await saveAttachmentSafe(ctx, {
                  bytes,
                  mediaType,
                  name,
                })
                const filePath = path.join(outDir, name)
                await writeFile(filePath, bytes)
                const meta = deviceMeta(device)
                return {
                  success: true,
                  ...meta,
                  seed,
                  path: filePath,
                  url: localUrl,
                  width: gen.width || attachment.width,
                  height: gen.height || attachment.height,
                  cost: gen.cost || 0,
                  prompt: devicePrompt,
                  format: String(gen.format || format).replace('jpg', 'jpeg'),
                  attachment: {
                    attachmentId: attachment.attachmentId,
                    mediaType: attachment.mediaType,
                    bytes: attachment.bytes,
                    width: attachment.width,
                    height: attachment.height,
                    name: attachment.name,
                  },
                }
              } catch (err) {
                warnings.push(`${preset.id}: ${err?.message || err}`)
                return { device: preset.id, success: false, error: err?.message || String(err) }
              }
            })

            const settled = await asyncPool(tasks, 3)
            const images = settled.filter((r) => r && r.success === true)
            if (!images.length) {
              throw new Error(`All responsive mockup generations failed: ${warnings.join('; ') || 'unknown error'}`)
            }

            const first = images[0]
            const totalCost = images.reduce((s, i) => s + (i.cost || 0), 0)
            const summaryBody = buildDualOutputMarkdown({
              action: 'generated',
              filePath: first.path,
              width: first.width,
              height: first.height,
              mediaType: first.mediaType || `image/${format}`,
              seed: seedBase,
              provider,
              model: cfg.model || cfg.customModel || 'default',
              cost: totalCost,
              attachmentId: first.attachment?.attachmentId || 'N/A',
            })
            const extraLines = images
              .map((i) => `- **${i.device}** \`${i.path}\` (${i.width}×${i.height})`)
              .join('\n')
            // Machine-readable payload for the toolview tab strip (#173).
            const tabPayload = JSON.stringify({
              kind: 'generate_responsive_mockups',
              images: images.map((i) => ({
                device: i.device,
                label: i.label,
                aspect: i.aspect,
                width: i.width,
                height: i.height,
                path: i.path,
                seed: i.seed,
                url: i.url,
                attachment: i.attachment,
              })),
            })
            const summary = `${summaryBody}\n\n**Responsive set (${images.length} viewports)**\n${extraLines}\n\n<dsh-image-gen-responsive>${tabPayload}</dsh-image-gen-responsive>`

            return toLosslessJson({
              summary,
              images,
              devices: images.map((i) => i.device),
              count: images.length,
              seedBase,
              provider,
              path: first.path,
              url: first.url,
              attachment: first.attachment,
              width: first.width,
              height: first.height,
              seed: seedBase,
              prompt: args.prompt,
              cost: totalCost,
              format,
              ...(warnings.length ? { warnings } : {}),
            })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool generate_responsive_mockups')
}
