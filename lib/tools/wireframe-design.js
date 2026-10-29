// @ts-check
// wireframe-design.js — wireframe-to-design asset synthesis tool (#455).
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  makeProviders,
  toLosslessJson,
} from '../providers.js'
import { resolveConversationImage, analyzeImageWithVision } from '../resolve-image.js'
import { calculateGenerationCost, assertBudgetAvailable } from '../cost-meter.js'
import { trackAndAssertLoopGuard } from '../loop-guard.js'
import { sanitizeErrorAndLogs } from '../security.js'
import { renderToolOutput } from '../attachment-helper.js'

export const DESIGN_SYSTEM_PRESETS = {
  modern_saas: {
    name: 'Modern SaaS',
    prompt:
      'Polished modern SaaS web application UI dashboard, crisp sans-serif typography, clean visual hierarchy, subtle card drop-shadows, refined 1px neutral borders, slate and indigo primary accents, 8pt grid alignment, production Figma design asset, high-resolution vector aesthetic.',
  },
  dark_glassmorphism: {
    name: 'Dark Glassmorphism',
    prompt:
      'Futuristic dark mode UI interface, frosted glass translucent cards with backdrop blur, glowing neon cyan and purple rim lighting, deep obsidian midnight background, sleek glowing stat widgets, elegant data visualization dashboard.',
  },
  brutalist: {
    name: 'Brutalist',
    prompt:
      'Neo-brutalist digital UI layout, thick solid 2px black borders, stark high-contrast typography, bold monochrome structure with electric yellow and vibrant blue accent buttons, raw utilitarian grid, retro-modern interface.',
  },
  apple_minimal: {
    name: 'Apple Minimal',
    prompt:
      'Minimalist human interface guidelines aesthetic, pristine off-white background, SF Pro clean typography, ultra-subtle ambient shadows, generous whitespace, rounded card corners, elegant monochrome with refined accent icons.',
  },
}

export const SUPPORTED_DESIGN_SYSTEMS = Object.keys(DESIGN_SYSTEM_PRESETS)

export function registerWireframeDesignTools(ctx, deps) {
  const {
    live,
    saveAndAttachResult,
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'render_wireframe_asset',
        description:
          'Transform rough wireframes, UI sketches, or whiteboard layouts into finished high-fidelity design assets (#455). '
          + 'Applies calibrated img2img synthesis preserving layout geometry while rendering curated design systems '
          + '(Modern SaaS, Dark Glassmorphism, Brutalist, Apple Minimal).',
        parameters: {
          wireframe_image: {
            type: 'string',
            description: 'Path or attachment ID of the wireframe / sketch. Defaults to "latest" to resolve from session history.',
          },
          design_system: {
            type: 'string',
            enum: SUPPORTED_DESIGN_SYSTEMS,
            description: 'Design system aesthetic preset: "modern_saas", "dark_glassmorphism", "brutalist", or "apple_minimal" (default: "modern_saas").',
          },
          style: {
            type: 'string',
            description: 'Optional additional style direction or color palette (e.g. "fintech pastel", "cyberpunk accent", "clean medical").',
          },
          fidelity: {
            type: 'number',
            description: 'Layout preservation fidelity between 0.2 and 0.85 (default: 0.55). Higher values stick closer to the raw wireframe lines.',
          },
          prompt: {
            type: 'string',
            description: 'Optional prompt instructions describing specific UI components, branding, or content details.',
          },
          seed: {
            type: 'integer',
            description: 'Optional seed for reproducible design synthesis.',
          },
          output_name: {
            type: 'string',
            description: 'Optional file stem for saved design asset.',
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
              designSystem: { type: 'string' },
              fidelity: { type: 'number' },
              strength: { type: 'number' },
              seed: { type: 'number' },
              provider: { type: 'string' },
              cost: { type: 'number' },
              format: { type: 'string' },
              attachment: { type: 'object', additionalProperties: true },
            },
          },
        },
        async execute(args, exec) {
          try {
            const cfg = typeof live === 'function' ? live() : (deps.config || {})
            const sessionId = exec?.agent?.session?.id || exec?.agent?.session?.header?.id || 'session'
            trackAndAssertLoopGuard(sessionId, { limit: cfg.loopGuardLimit, prompt: args.prompt || 'wireframe', exec })

            const estimated = calculateGenerationCost({
              provider: cfg.provider || 'fal',
              model: cfg.model,
              size: cfg.defaultSize || 'square_hd',
              count: 1,
            })
            assertBudgetAvailable(estimated, cfg.dailyBudgetUsd)

            // 1. Resolve source wireframe image
            const source = await resolveConversationImage(ctx, exec, args.wireframe_image)
            if (!source?.bytes) {
              throw new Error('render_wireframe_asset: no wireframe image resolved. Provide image path/attachment or attach a sketch in session.')
            }

            // 2. Select design system preset and calibrate fidelity
            const designSystemKey = args.design_system && DESIGN_SYSTEM_PRESETS[args.design_system]
              ? args.design_system
              : 'modern_saas'
            const preset = DESIGN_SYSTEM_PRESETS[designSystemKey]

            const rawFidelity = typeof args.fidelity === 'number' ? args.fidelity : 0.55
            const fidelity = Math.max(0.2, Math.min(0.85, rawFidelity))
            // Fidelity 0.2 -> denoise strength 0.87 (more creative); fidelity 0.85 -> strength 0.45 (strict layout geometry preservation)
            const strength = Number((1.0 - (fidelity * 0.65)).toFixed(2))

            // 3. Vision structural analysis if available
            const vision = await analyzeImageWithVision(ctx, exec, source)

            // 4. Synthesize prompt
            const promptParts = [
              `[Design System: ${preset.name}] ${preset.prompt}`,
              'Preserve wireframe spatial layout, component placements, card boundaries, and visual hierarchy.',
            ]
            if (args.style) {
              promptParts.push(`Styling details: ${args.style}.`)
            }
            if (args.prompt) {
              promptParts.push(`UI content specification: ${args.prompt}.`)
            }
            if (vision.available && vision.summary) {
              promptParts.push(`Wireframe structural elements: ${vision.summary}`)
            }

            const effectivePrompt = promptParts.join('\n\n')
            const provider = cfg.provider || 'fal'
            const pdeps = {
              fetchImpl: fetch,
              resolveKey: (ref) => resolveApiKey(ctx, ref),
              cfg,
            }
            const seed = args.seed ?? Math.floor(Math.random() * 100000)
            const format = cfg.defaultFormat || 'png'
            const size = cfg.defaultSize || 'square_hd'

            const job = {
              prompt: effectivePrompt,
              size,
              format,
              seed,
              source,
              strength,
              provider,
              signal: exec?.signal,
            }

            const providers = makeProviders(pdeps, job)
            const fn = providers[provider] || providers.fal || providers.custom
            const gen = await fn(seed, effectivePrompt)

            const stem = args.output_name
              ? slugify(args.output_name)
              : `wireframe-${designSystemKey}-${seed}`
            const name = `${stem}.${format}`

            const result = await saveAndAttachResult(ctx, exec, cfg, {
              bytes: gen.bytes,
              mediaType: gen.mediaType || 'image/png',
              name,
              stem,
              prompt: effectivePrompt,
              size,
              format,
              seed: gen.seed ?? seed,
              provider,
              model: cfg.model,
              cost: gen.cost,
              sourceUrl: gen.sourceUrl,
              deliverAs: cfg.deliverAs || 'both',
              args,
              action: 'wireframe_to_design',
            })

            result.designSystem = designSystemKey
            result.fidelity = fidelity
            result.strength = strength
            if (vision.summary) result.visionAnalysis = vision.summary

            const summary = [
              '### Wireframe-to-Design Synthesis Completed',
              `- **Design System**: ${preset.name}`,
              `- **Fidelity**: ${fidelity} (strength: ${strength})`,
              `- **Output Asset**: \`${result.path || name}\``,
              `- **Provider**: ${provider}`,
            ].join('\n')
            result.summary = summary

            return toLosslessJson(result)
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool render_wireframe_asset')
}

