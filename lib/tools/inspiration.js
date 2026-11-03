// @ts-check
// inspiration.js — search_inspiration_prompts tool (#504).
// Bundled offline inspiration catalog of 970+ curated prompts from awesome-gpt-image-2 and handraw-style.

import { defineTool } from '@deepseek-ai/dsh-tools'
import { renderToolOutput } from '../attachment-helper.js'
import {
  searchInspiration,
  getCatalogTaxonomy,
  formatInspirationMarkdown,
  formatInspirationTaxonomyMarkdown,
} from '../inspiration-catalog.js'
import { toLosslessJson } from '../providers.js'

export function registerInspirationTools(ctx, _deps) {
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'search_inspiration_prompts',
        description:
          'Search and browse 970+ curated offline artistic and production prompts (awesome-gpt-image-2 & handraw-style). Filter by keyword, category, style, scene, or get random creative inspiration with zero network/token overhead.',
        parameters: {
          query: {
            type: 'string',
            description: 'Keywords to search in prompt titles, descriptions, categories, or styles.',
          },
          category: {
            type: 'string',
            description: 'Filter by prompt category (e.g. "Charts & Infographics", "3D", "Photography", "Portrait").',
          },
          style: {
            type: 'string',
            description: 'Filter by style tag (e.g. "Realistic", "Poster", "Cyberpunk", "Minimalist", "Editorial").',
          },
          scene: {
            type: 'string',
            description: 'Filter by scene context (e.g. "Tech", "Commerce", "Education", "Nature").',
          },
          source: {
            type: 'string',
            enum: ['all', 'awesome-gpt-image-2', 'handraw-style'],
            description: 'Collection source to search within. Defaults to "all".',
          },
          case_id: {
            type: 'string',
            description: 'Directly look up a specific prompt case by ID (e.g. "544" or "s-001").',
          },
          random: {
            type: 'boolean',
            description: 'Randomly sample from matching prompts to discover creative variations.',
          },
          count: {
            type: 'number',
            description: 'Number of prompts to return (1-20, default 5).',
          },
          list_categories: {
            type: 'boolean',
            description: 'If true, returns available categories and styles taxonomy instead of cases.',
          },
        },
        output: {
          render: (_args, value) => renderToolOutput(value),
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              summary: { type: 'string' },
              totalMatches: { type: 'number' },
              returnedCount: { type: 'number' },
              cases: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    prompt: { type: 'string' },
                    category: { type: 'string' },
                    styles: { type: 'array', items: { type: 'string' } },
                    sourceId: { type: 'string' },
                  },
                },
              },
              taxonomy: { type: 'object', additionalProperties: true },
            },
          },
        },
        async execute(args, _exec) {
          const safeArgs = args || {}

          // 1. If taxonomy requested, return categories & styles
          if (safeArgs.list_categories) {
            const taxonomy = await getCatalogTaxonomy(safeArgs.source || 'all')
            const summary = formatInspirationTaxonomyMarkdown(taxonomy)
            return toLosslessJson({
              summary,
              totalMatches: taxonomy.totalCases,
              returnedCount: 0,
              taxonomy,
              cases: [],
            })
          }

          // 2. Search catalog
          const result = await searchInspiration({
            query: safeArgs.query,
            category: safeArgs.category,
            style: safeArgs.style,
            scene: safeArgs.scene,
            source: safeArgs.source || 'all',
            caseId: safeArgs.case_id,
            random: Boolean(safeArgs.random),
            count: safeArgs.count ? Number(safeArgs.count) : 5,
          })

          const summary = formatInspirationMarkdown({
            totalMatches: result.totalMatches,
            cases: result.cases,
            query: safeArgs.query,
            category: safeArgs.category,
            style: safeArgs.style,
          })

          return toLosslessJson({
            summary,
            totalMatches: result.totalMatches,
            returnedCount: result.returnedCount,
            cases: result.cases,
            sources: result.sources,
          })
        },
      }),
    )
  }, 'dsh-image-gen: tool search_inspiration_prompts')
}
