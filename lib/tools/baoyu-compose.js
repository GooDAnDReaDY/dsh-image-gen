// @ts-check
// baoyu-compose.js — compose_baoyu_prompt tool (#505).
// 5-dimension style & composition prompt assembler.

import { defineTool } from '@deepseek-ai/dsh-tools'
import { renderToolOutput } from '../attachment-helper.js'
import {
  composeBaoyuPrompt,
  getBaoyuTaxonomy,
} from '../baoyu-compose.js'
import { toLosslessJson } from '../providers.js'

export function registerBaoyuComposeTools(ctx, deps) {
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'compose_baoyu_prompt',
        description:
          'Assemble a precision artistic or editorial cover prompt using the 5-dimensional Baoyu design system '
          + '(Composition Type, Color Palette, Rendering Style, Mood, and Text Hierarchy) with calibrated color palettes, hex codes, and layout constraints (#505).',
        parameters: {
          title: {
            type: 'string',
            description: 'The title, headline, or core topic to depict on the cover or illustration.',
          },
          type: {
            type: 'string',
            enum: ['hero', 'conceptual', 'typography', 'metaphor', 'scene', 'minimal'],
            description: 'Composition layout formula (default: "metaphor").',
          },
          palette: {
            type: 'string',
            enum: ['warm', 'cool', 'dark', 'earth', 'elegant', 'macaron', 'mono', 'pastel', 'retro', 'duotone', 'vivid'],
            description: 'Curated color harmony palette with hex codes (default: "warm").',
          },
          rendering: {
            type: 'string',
            enum: ['flat-vector', 'pixel', 'digital', 'hand-drawn', 'painterly', 'chalk', 'screen-print'],
            description: 'Artistic medium and surface texture rendering (default: "flat-vector").',
          },
          text: {
            type: 'string',
            enum: ['none', 'title-only', 'title-subtitle', 'text-rich'],
            description: 'Text elements hierarchy level (default: "title-only").',
          },
          mood: {
            type: 'string',
            enum: ['subtle', 'balanced', 'bold'],
            description: 'Emotional tone and color contrast intensity (default: "balanced").',
          },
          list_options: {
            type: 'boolean',
            description: 'If true, returns full taxonomy of available dimensions instead of assembling a prompt.',
          },
        },
        output: {
          render: (_args, value) => renderToolOutput(value),
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              prompt: { type: 'string' },
              summary: { type: 'string' },
              selection: { type: 'object', additionalProperties: true },
              taxonomy: { type: 'object', additionalProperties: true },
            },
          },
        },
        async execute(args, _exec) {
          const safeArgs = args || {}

          if (safeArgs.list_options) {
            const taxonomy = await getBaoyuTaxonomy()
            const summary = [
              '### 🎨 Baoyu 5-Dimension Design System Taxonomy',
              '',
              '**1. Composition Types:**',
              ...taxonomy.types.map(t => `- \`${t.id}\`: ${t.description} (*${t.composition}*)`),
              '',
              '**2. Color Palettes:**',
              ...taxonomy.palettes.map(p => `- \`${p.id}\`: ${p.tagline} (${p.colors.map(c => `${c.name} ${c.hex}`).join(', ')})`),
              '',
              '**3. Rendering Styles:**',
              ...taxonomy.renderings.map(r => `- \`${r.id}\`: ${r.tagline}`),
              '',
              '**4. Moods:**',
              ...taxonomy.moods.map(m => `- \`${m.id}\`: ${m.application}`),
              '',
              '**5. Text Levels:**',
              ...taxonomy.textLevels.map(tl => `- \`${tl.id}\`: ${tl.area}`),
            ].join('\n')

            return toLosslessJson({
              summary,
              taxonomy,
            })
          }

          const result = await composeBaoyuPrompt({
            title: safeArgs.title || '',
            type: safeArgs.type || 'metaphor',
            palette: safeArgs.palette || 'warm',
            rendering: safeArgs.rendering || 'flat-vector',
            text: safeArgs.text || 'title-only',
            mood: safeArgs.mood || 'balanced',
          })

          return toLosslessJson(result)
        },
      }),
    )
  }, 'dsh-image-gen: tool compose_baoyu_prompt')
}
