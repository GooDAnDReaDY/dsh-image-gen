import {
  getImageLineage,
  getReplayPayload,
} from '../lineage.js'
import { readHistory } from '../history.js'

/**
 * Registers lineage inspection and replay tools (#439).
 */
export function registerLineageTools(ctx, deps = {}) {
  ctx.tools.register({
    name: 'inspect_image_lineage',
    description: 'Inspects generation and edit history ancestry DAG for an image revision, showing parents, branches, and prompts.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        revisionId: {
          type: 'string',
          description: 'Revision ID, attachment ID, or image file path to inspect.',
        },
      },
      required: ['revisionId'],
    },
    output: {
      render(args, value) {
        if (!value?.target) return [{ type: 'text', text: `No lineage found for "${args.revisionId}".` }]
        const t = value.target
        const ancestryLines = (value.ancestry || []).map((a, i) => `  [Parent ${i + 1}] (${a.operation}) ${a.prompt || a.revisionId}`).join('\n')
        const childrenLines = (value.children || []).map((c) => `  [Child] (${c.operation}) ${c.prompt || c.revisionId}`).join('\n')

        return [
          {
            type: 'text',
            text: `Lineage for Revision: [${t.revisionId}]\n` +
              `Branch: ${t.branchId} | Operation: ${t.operation}\n` +
              `Prompt: "${t.prompt}"\n` +
              (ancestryLines ? `Ancestry (${value.depth}):\n${ancestryLines}\n` : 'Root generation (no parents)\n') +
              (childrenLines ? `Children:\n${childrenLines}` : 'Leaf revision (no children yet)'),
          },
        ]
      },
    },
    async execute(args) {
      const entries = typeof deps.readHistory === 'function' ? await deps.readHistory() : await readHistory()
      return getImageLineage(args.revisionId, entries)
    },
  })

  ctx.tools.register({
    name: 'get_image_replay_payload',
    description: 'Extracts sanitized parameter payload from a past image revision to replay or branch generation without credential leaks.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        revisionId: {
          type: 'string',
          description: 'Revision ID to extract replay configuration from.',
        },
      },
      required: ['revisionId'],
    },
    output: {
      render(args, value) {
        if (!value?.ok) return [{ type: 'text', text: `Replay extraction failed: ${value?.error}` }]
        return [
          {
            type: 'text',
            text: `Replay Payload for [${value.revisionId}]:\n` +
              `Tool: ${value.tool} (${value.provider}/${value.model})\n` +
              `Parameters: ${JSON.stringify(value.params, null, 2)}\n` +
              `Notes: ${value.reproducibilityNotes}`,
          },
        ]
      },
    },
    async execute(args) {
      const entries = typeof deps.readHistory === 'function' ? await deps.readHistory() : await readHistory()
      return getReplayPayload(args.revisionId, entries)
    },
  })
}
