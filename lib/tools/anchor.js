// anchor.js — set_style_anchor tool (#283).
// Manages persistent visual style & character reference anchors in session context.

import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  setSessionAnchor,
  clearSessionAnchor,
  normalizeAnchorStrength,
} from '../anchor-helpers.js'
import { toLosslessJson } from '../providers.js'

export function registerAnchorTools(ctx, deps) {
  const { live, resolveSource } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'set_style_anchor',
        description:
          'Set or clear a persistent visual anchor (character identity or artstyle) for this session. '
          + 'Subsequent image generations automatically adhere to this reference to maintain visual continuity.',
        parameters: {
          image: {
            type: 'string',
            description: 'URL, local file path, or attachment id (sha256:...) to use as the visual anchor. Required unless clear is true.',
          },
          label: {
            type: 'string',
            description: 'Human-readable descriptor, e.g. "Protagonist Alex" or "Dark Synthwave 3D".',
          },
          mode: {
            type: 'string',
            enum: ['style', 'character'],
            description: 'Anchor mode: "character" preserves facial/physical identity; "style" preserves artistic rendering, lighting, and palette. Default: style.',
          },
          strength: {
            type: 'number',
            description: 'Reference influence strength between 0.1 and 1.0 (default 0.65).',
          },
          clear: {
            type: 'boolean',
            description: 'When true, clears the active anchor for this session instead of setting a new one.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              ok: { type: 'boolean' },
              action: { type: 'string' },
              anchor: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  image: { type: 'string' },
                  label: { type: 'string' },
                  mode: { type: 'string' },
                  strength: { type: 'number' },
                  updatedAt: { type: 'string' },
                },
              },
              summary: { type: 'string' },
            },
          },
          render(args, value) {
            return [{ type: 'text', text: value.summary || 'Style anchor updated.' }]
          },
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          const cfg = live ? live() : {}
          if (cfg.enabled === false) {
            throw new Error('Image generation plugin is disabled in settings.')
          }

          const sessionId = exec?.agent?.session?.id || exec?.agent?.session?.header?.id || 'session'

          if (args.clear) {
            const existed = clearSessionAnchor(sessionId)
            const summary = existed
              ? 'Active visual style anchor was cleared for this session.'
              : 'No active visual style anchor was set for this session.'
            return toLosslessJson({
              ok: true,
              action: 'cleared',
              summary,
            })
          }

          if (!args.image || typeof args.image !== 'string' || !args.image.trim()) {
            throw new Error('Parameter "image" (URL, file path, or sha256 attachment ID) is required to set an anchor.')
          }

          const imageRef = args.image.trim()
          const mode = args.mode === 'character' ? 'character' : 'style'
          const strength = normalizeAnchorStrength(args.strength)
          const label = args.label ? String(args.label).trim() : (mode === 'character' ? 'Character Anchor' : 'Style Anchor')

          // Validate source readability if it is a local path or attachment
          if (resolveSource && (imageRef.startsWith('sha256:') || !imageRef.startsWith('http'))) {
            try {
              await resolveSource(ctx, exec, imageRef)
            } catch {
              // Best effort check; non-blocking if remote URL or future attachment
            }
          }

          const anchor = setSessionAnchor(sessionId, {
            image: imageRef,
            label,
            mode,
            strength,
          })

          const summary = `Visual anchor "${label}" (${mode} mode, strength: ${strength}) is now active for this session. Subsequent generations will align with this reference.`

          return toLosslessJson({
            ok: true,
            action: 'set',
            anchor,
            summary,
          })
        },
      }),
    )
  }, 'dsh-image-gen: tool set_style_anchor')
}
