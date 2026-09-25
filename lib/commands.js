// commands.js — Top-level slash command /image for direct generation without LLM reasoning (#152)

import { makeProviders, resolveStylePreset } from './providers.js'
import { ASPECT_RATIOS } from './providers/shared-helpers.js'
import { calculateGenerationCost } from './cost-meter.js'

/**
 * Parse raw slash command arguments: /image <prompt> [--flags]
 *
 * @param {string} rawInput
 * @returns {{ prompt: string, flags: Record<string, string>, error?: string }}
 */
export function parseImageCommandArgs(rawInput) {
  const str = String(rawInput || '').trim()
  if (!str) return { prompt: '', flags: {}, error: 'Missing prompt' }

  const tokens = []
  const re = /[^\s"']+|"([^"]*)"|'([^']*)'/g
  let match
  while ((match = re.exec(str)) !== null) {
    tokens.push(match[1] || match[2] || match[0])
  }

  const flags = {}
  const promptWords = []

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.startsWith('--')) {
      const eqIdx = t.indexOf('=')
      if (eqIdx !== -1) {
        const key = t.slice(2, eqIdx).toLowerCase()
        const val = t.slice(eqIdx + 1)
        flags[key] = val
      } else {
        const key = t.slice(2).toLowerCase()
        if (i + 1 < tokens.length && !tokens[i + 1].startsWith('--')) {
          flags[key] = tokens[i + 1]
          i++
        } else {
          flags[key] = 'true'
        }
      }
    } else {
      promptWords.push(t)
    }
  }

  const prompt = promptWords.join(' ').trim()
  return { prompt, flags }
}

/**
 * Registers the /image slash command via @deepseek-ai/dsh-commands service.
 *
 * @param {object} ctx - Cordis context
 * @param {object} deps - Shared plugin runtime dependencies
 */
export function registerImageCommand(ctx, deps) {
  const { live, saveAndAttachResult, resolveApiKey, slugify } = deps

  ctx.inject(['commands'], (cmdCtx) => {
    const commands = cmdCtx.commands
    if (typeof commands?.register !== 'function') return

    const executeCommand = async (rawInput, invocation = {}) => {
      const { prompt, flags } = parseImageCommandArgs(rawInput)
      if (!prompt) {
        return {
          kind: 'error',
          text: 'Usage: /image <prompt> [--size=...] [--aspect=...] [--provider=...] [--style=...] [--seed=...]',
          toString() { return this.text },
        }
      }

      const cfg = typeof live === 'function' ? live() : (deps.config || {})
      const provider = flags.provider || cfg.provider || 'fal'
      const size = flags.size || cfg.defaultSize || 'square'
      const format = flags.format || cfg.defaultFormat || 'png'
      const aspectRatio = flags.aspect || flags.aspect_ratio || cfg.defaultAspectRatio
      const effectiveStyle = flags.style || cfg.stylePreset
      const seed = flags.seed ? Number(flags.seed) : Math.floor(Math.random() * 2147483647)

      const styleInfo = resolveStylePreset(effectiveStyle, flags.negative_prompt, flags.guidance_scale)
      const effectivePrompt = styleInfo.promptSuffix ? `${prompt}, ${styleInfo.promptSuffix}` : prompt

      const job = {
        prompt: effectivePrompt,
        size,
        format,
        aspectRatio,
        aspectPixels: aspectRatio ? ASPECT_RATIOS[aspectRatio] : undefined,
        seed,
        signal: invocation?.signal,
      }

      const pdeps = {
        fetchImpl: fetch,
        resolveKey: (ref) => resolveApiKey(ctx, ref),
        cfg,
        ctx,
      }

      const providerFactory = deps.makeProviders || makeProviders
      const providers = providerFactory(pdeps, job)
      const generateFn = providers[provider] || providers.fal || providers.custom
      if (typeof generateFn !== 'function') {
        throw new Error(`Unsupported provider: "${provider}". One of: fal, openai, grok, gemini, replicate, local, seedream`)
      }

      const result = await generateFn(seed, effectivePrompt)
      const safeSlug = typeof slugify === 'function' ? slugify(prompt.slice(0, 32)) : 'image'
      const stem = `${safeSlug}-${Date.now().toString(36)}`
      const name = `${stem}.${format}`

      const cost = calculateGenerationCost({
        provider,
        model: cfg.model || cfg.customModel || 'default',
        size,
        count: 1,
      })

      const attached = await saveAndAttachResult(ctx, invocation, cfg, {
        bytes: result.bytes,
        mediaType: result.mediaType || 'image/png',
        name,
        stem,
        prompt,
        size,
        format,
        seed,
        provider,
        model: cfg.model || cfg.customModel || 'default',
        cost,
        sourceUrl: result.sourceUrl,
        deliverAs: cfg.deliverAs || 'link',
        args: { prompt, ...flags },
        action: 'generated via /image command',
      })

      return {
        kind: 'success',
        text: attached.summary,
        attachment: attached.attachment,
        toString() { return attached.summary },
      }
    }

    const unregister = commands.register({
      definitionId: '@goodandready/dsh-image-gen',
      name: 'image',
      description: 'Generate an image directly without chat model reasoning (/image <prompt> [--size=...] [--aspect=...] [--provider=...] [--style=...])',
      input: { hint: '<prompt> [--size=...] [--aspect=...] [--provider=...] [--style=...]' },
      handler: async (invocation) => {
        try {
          const raw = invocation?.rawInput || invocation?.text || (typeof invocation === 'string' ? invocation : '')
          return await executeCommand(raw, invocation)
        } catch (err) {
          return {
            kind: 'error',
            text: `Image generation failed: ${err?.message || err}`,
            toString() { return `Image generation failed: ${err?.message || err}` },
          }
        }
      },
      execute: async (rawArgs, invocation) => {
        const res = await executeCommand(rawArgs, invocation)
        return res.text
      },
    })

    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => unregister?.(), 'dsh-image-gen: /image slash command')
    }
  })
}
