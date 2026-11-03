// @ts-check
// canvas.js — canvas_state and view_canvas tools (#506, #507).
// Workbench infinite canvas state inspection and screenshot materialization.

import { defineTool } from '@deepseek-ai/dsh-tools'
import { getCanvasMirror } from '../canvas-state.js'
import { saveAttachmentSafe, toLosslessJson } from '../providers.js'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolveInside } from '../security.js'

export function registerCanvasTools(ctx, _deps) {
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'canvas_state',
        description:
          'Inspect the current state of the image-gen workbench infinite canvas: what shapes are on it (generated images with provenance, hand-drawn strokes, text notes) and what is currently selected. Use whenever the user refers to "the canvas", drawings, or selections (#506).',
        parameters: {},
        output: {
          render: (_args, value) => [{ type: 'text', text: value.digest || value.summary || 'Canvas state inspected.' }],
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              digest: { type: 'string' },
              connected: { type: 'boolean' },
              nodeCount: { type: 'integer' },
              selectionCount: { type: 'integer' },
              hasSelectionImage: { type: 'boolean' },
            },
          },
        },
        async execute(_args, _exec) {
          const mirror = getCanvasMirror()
          const latest = mirror.latest()
          const digest = mirror.digest()

          return toLosslessJson({
            digest,
            summary: digest,
            connected: mirror.connected(),
            nodeCount: latest?.nodeCount || 0,
            selectionCount: latest?.selectionCount || 0,
            hasSelectionImage: Boolean(mirror.latestSelectionImage()),
            selection: latest ? {
              count: latest.selectionCount,
              kinds: latest.selectionKinds,
              items: latest.selectionItems,
            } : null,
          })
        },
      }),
    )
  }, 'dsh-image-gen: tool canvas_state')

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'view_canvas',
        description:
          'Materialize the current selection on the image-gen workbench canvas as a durable conversation image attachment (screenshot of hand-drawn sketches, annotated images, or selected shapes). Call after canvas_state confirms a selection exists. The screenshot becomes visible to multimodal models for sketch-to-image or iterative editing (#507).',
        parameters: {},
        output: {
          render: (_args, value) => {
            const blocks = [{ type: 'text', text: value.summary || value.digest || 'Canvas view.' }]
            if (value.attachment && value.attachment.attachmentId) {
              blocks.push({ type: 'image', attachment: value.attachment })
            }
            return blocks
          },
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              digest: { type: 'string' },
              summary: { type: 'string' },
              hasSelectionImage: { type: 'boolean' },
              attachment: { type: 'object', additionalProperties: true },
              path: { type: 'string' },
              url: { type: 'string' },
            },
          },
        },
        async execute(_args, exec) {
          const mirror = getCanvasMirror()
          const digest = mirror.digest()
          const image = mirror.latestSelectionImage()

          if (!image || !image.data || image.data.length === 0) {
            const noSelectionText = `${digest}\n\n> ⚠️ **No canvas screenshot available**: either nothing is currently selected on the canvas, or the canvas has not captured a screenshot yet. Ask the user to select shapes on the canvas first.`
            return toLosslessJson({
              digest,
              summary: noSelectionText,
              hasSelectionImage: false,
              attachment: null,
            })
          }

          const filename = `canvas-selection-${Date.now().toString(36)}.png`
          const mediaType = image.mediaType || 'image/png'

          const { attachment, localUrl } = await saveAttachmentSafe(ctx, {
            bytes: Buffer.isBuffer(image.data) ? image.data : Buffer.from(image.data),
            mediaType,
            name: filename,
          })

          const sessionCwd = exec?.agent?.session?.header?.cwd
          let filePath = undefined
          if (sessionCwd) {
            try {
              const outDir = resolveInside(sessionCwd, 'generated-images')
              await mkdir(outDir, { recursive: true })
              filePath = path.join(outDir, filename)
              await writeFile(filePath, image.data)
            } catch (_err) {
              // Ignore disk write errors, attachment is already saved
            }
          }

          const summaryText = `${digest}\n\nCanvas selection screenshot materialized and attached below. You can now analyze the drawing or selection directly.`

          return toLosslessJson({
            digest,
            summary: summaryText,
            hasSelectionImage: true,
            attachment,
            url: localUrl,
            path: filePath,
          })
        },
      }),
    )
  }, 'dsh-image-gen: tool view_canvas')
}
