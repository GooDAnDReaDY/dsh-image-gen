// @ts-check
// tools/workspace-save.js — save_image_to_workspace tool (#510).
// Content-addressed disk persistence with path containment and atomic write.

import { defineTool } from '@deepseek-ai/dsh-tools'
import { saveImageToWorkspace } from '../workspace-save.js'
import { toLosslessJson } from '../providers.js'

export function registerWorkspaceSaveTools(ctx, deps) {
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'save_image_to_workspace',
        description:
          'Persist an image attachment directly to the session workspace disk using deterministic content-addressed naming (image-<digest-prefix>.<ext>). Ensures containment inside the workspace and atomic staged writes (#510).',
        parameters: {
          attachment_id: {
            type: 'string',
            description: 'The attachment ID (sha256:...) or local identifier of the generated image to persist.',
          },
          folder: {
            type: 'string',
            description: 'Optional subfolder within the workspace (e.g. "generated-images" or "assets/images"). Must stay inside the workspace.',
          },
        },
        output: {
          render: (_args, value) => [
            {
              type: 'text',
              text: value.summary || `Image saved to workspace: ${value.path || value.filename}`,
            },
          ],
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              path: { type: 'string' },
              filename: { type: 'string' },
              bytes: { type: 'integer' },
              digest: { type: 'string' },
              summary: { type: 'string' },
            },
          },
        },
        async execute(args, exec) {
          const attachmentId = String(args.attachment_id || '').trim()
          if (!attachmentId) throw new Error('Missing required argument "attachment_id"')

          const sessionCwd = exec?.agent?.session?.header?.cwd || process.cwd()
          let imgBytes = null
          let mediaType = 'image/png'

          // 1. Try ctx.attachments
          if (ctx?.attachments) {
            try {
              if (typeof ctx.attachments.get === 'function') {
                const att = await ctx.attachments.get(attachmentId)
                if (att && att.data) {
                  imgBytes = att.data
                  mediaType = att.mediaType || mediaType
                }
              }
              if (!imgBytes && typeof ctx.attachments.read === 'function') {
                const att = await ctx.attachments.read(attachmentId)
                if (att && att.data) {
                  imgBytes = att.data
                  mediaType = att.mediaType || mediaType
                }
              }
            } catch (_err) {
              // fall through to image resolve
            }
          }

          // 2. Fallback: try resolveImageSafe if available
          if (!imgBytes && deps?.resolveImageSafe) {
            try {
              const res = await deps.resolveImageSafe(ctx, attachmentId, { cwd: sessionCwd })
              if (res && res.bytes) {
                imgBytes = res.bytes
                mediaType = res.mediaType || mediaType
              }
            } catch (_err) {
              // fallback
            }
          }

          if (!imgBytes) {
            throw new Error(`Could not retrieve image bytes for attachment ID: ${attachmentId}`)
          }

          const saved = await saveImageToWorkspace({
            workspaceRoot: sessionCwd,
            folder: args.folder,
            attachmentId,
            mediaType,
            bytes: Buffer.isBuffer(imgBytes) ? imgBytes : Buffer.from(imgBytes),
          })

          const summary = `Image successfully exported to workspace: \`${saved.path}\` (${saved.filename}, ${saved.bytes} bytes).`

          return toLosslessJson({
            path: saved.path,
            filename: saved.filename,
            bytes: saved.bytes,
            digest: saved.digest,
            summary,
          })
        },
      }),
    )
  }, 'dsh-image-gen: tool save_image_to_workspace')
}
