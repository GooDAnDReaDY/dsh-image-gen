import { renderToolOutput } from "../attachment-helper.js"
// design-export tool (#446) — export_design_asset for Figma / Penpot / OpenDesign

import { defineTool } from '@deepseek-ai/dsh-tools'
import { toLosslessJson } from '../providers.js'
import { formatDesignExportPayload, pushAssetToOpenDesignProject } from '../design-export.js'

export function registerDesignExportTools(ctx, deps) {
  const { resolveSource } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'export_design_asset',
        description:
          'Export a generated image, SVG stencil, or asset into design-friendly clipboard snippets '
          + '(Figma HTML img/SVG markup, Penpot SVG snippet, CSS background Data-URL) '
          + 'or push it directly into a local OpenDesign project folder (#446).',
        parameters: {
          image: {
            type: 'string',
            required: true,
            description: 'Path or attachment ID of the image to export.',
          },
          target: {
            type: 'string',
            enum: ['all', 'opendesign', 'clipboard_svg', 'clipboard_dataurl', 'penpot_snippet', 'figma_html'],
            description: 'Target export format or destination (default: all).',
          },
          project_id: {
            type: 'string',
            description: 'Optional OpenDesign project ID to directly save the file into the project artifacts directory.',
          },
          name: {
            type: 'string',
            description: 'Optional stem or filename for the exported design asset.',
          },
        },
        output: {
          render: (_args, value) => renderToolOutput(value),
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              name: { type: 'string' },
              mimeType: { type: 'string' },
              isSvg: { type: 'boolean' },
              width: { type: 'number' },
              height: { type: 'number' },
              dataUrl: { type: 'string' },
              svgMarkup: { type: 'string' },
              figmaHtml: { type: 'string' },
              penpotSnippet: { type: 'string' },
              cssBackground: { type: 'string' },
              openDesign: { type: 'object', additionalProperties: true },
            },
          },
        },
        async execute(args, exec) {
          const source = await resolveSource(ctx, exec, args.image)
          if (!source || !source.bytes) {
            throw new Error(`Image not found or unreadable: ${args.image}`)
          }

          const payload = formatDesignExportPayload({
            buffer: source.bytes,
            mimeType: source.mediaType || 'image/png',
            name: args.name || 'exported-asset',
            width: source.width || 1024,
            height: source.height || 1024,
            target: args.target || 'all',
          })

          let openDesign = null
          if (args.project_id) {
            const ext = payload.isSvg ? '.svg' : '.png'
            const filename = (args.name || 'asset').endsWith(ext) ? args.name : `${args.name || 'asset'}${ext}`
            openDesign = await pushAssetToOpenDesignProject({
              buffer: source.bytes,
              filename,
              projectId: args.project_id,
            })
          }

          return toLosslessJson({
            ...payload,
            ...(openDesign ? { openDesign } : {}),
          })
        },
      }),
    )
  })
}
