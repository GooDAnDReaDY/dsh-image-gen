// @ts-check
// drawio-diagram.js — Draw.io mxfile and vector diagram generation tool (#451).
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { toLosslessJson } from '../providers.js'
import { resolveInside, sanitizeErrorAndLogs } from '../security.js'
import { renderToolOutput } from '../attachment-helper.js'
import { formatDesignExportPayload } from '../design-export.js'
import {
  DRAWIO_THEMES,
  DRAWIO_SHAPES,
  DRAWIO_EDGE_STYLES,
  normalizeNodes,
  normalizeEdges,
  computeDiagramLayout,
  generateMxfileXml,
  generateDiagramSvgPreview,
} from '../drawio-helpers.js'

export function registerDrawioDiagramTools(ctx, deps) {
  const {
    live,
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_drawio_diagram',
        description:
          'Generate fully editable Draw.io / diagrams.net (.drawio / .mxfile) XML diagrams with clean SVG vector preview '
          + 'for cloud architecture, software microservices, workflows, and UML flowcharts (#451).',
        parameters: {
          title: {
            type: 'string',
            description: 'Architecture diagram title or workflow name.',
          },
          nodes: {
            type: 'array',
            required: true,
            description:
              'List of diagram nodes or JSON string. Each node: { id, label, shape, fill, stroke, textColor, x, y, width, height }. '
              + 'Supported shapes: rectangle, rounded, ellipse, diamond, cylinder, cloud, actor, hexagon, parallelogram, step.',
          },
          edges: {
            type: 'array',
            description:
              'List of directed connections or JSON string. Each edge: { source, target, label, style, dashed, bidirectional }. '
              + 'Supported styles: orthogonal, straight, curved.',
          },
          layout: {
            type: 'string',
            enum: ['horizontal', 'vertical', 'grid', 'tree'],
            description: 'Automatic node arrangement direction (default: horizontal).',
          },
          theme: {
            type: 'string',
            enum: ['light', 'dark', 'blueprint', 'corporate', 'nord'],
            description: 'Visual palette aesthetic (default: light).',
          },
          output_name: {
            type: 'string',
            description: 'Optional stem name for exported .drawio and .svg files.',
          },
          output_format: {
            type: 'string',
            enum: ['all', 'drawio', 'svg'],
            description: 'Exported file types: "all" (.drawio and .svg), "drawio", or "svg" (default: all).',
          },
        },
        output: {
          render: (_args, value) => renderToolOutput(value),
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              title: { type: 'string' },
              format: { type: 'string' },
              theme: { type: 'string' },
              layout: { type: 'string' },
              nodeCount: { type: 'number' },
              edgeCount: { type: 'number' },
              drawioPath: { type: 'string' },
              svgPath: { type: 'string' },
              xml: { type: 'string' },
              svg: { type: 'string' },
            },
          },
        },
        async execute(args, exec) {
          try {
            const cfg = typeof live === 'function' ? live() : (deps.config || {})
            const title = String(args.title || 'Architecture Diagram').trim()
            const layout = args.layout || 'horizontal'
            const theme = args.theme || 'light'
            const outputFormat = args.output_format || 'all'

            const rawNodes = args.nodes
            const rawEdges = args.edges || []

            const nodes = normalizeNodes(rawNodes)
            if (nodes.length === 0) {
              throw new Error('At least one node is required to generate a Draw.io diagram.')
            }
            const edges = normalizeEdges(rawEdges)

            // Generate Draw.io XML and SVG preview
            const xml = generateMxfileXml({ title, nodes, edges, layout, theme })
            const svg = generateDiagramSvgPreview({ title, nodes, edges, layout, theme })

            const sessionCwd = exec?.agent?.session?.header?.cwd
            const outDir = resolveInside(sessionCwd || process.cwd(), cfg.outputDir || 'generated/images')
            await mkdir(outDir, { recursive: true })

            const stem = `${slugify(args.output_name || title || 'diagram')}-${Date.now().toString(36)}`
            let drawioPath = ''
            let svgPath = ''

            if (outputFormat === 'all' || outputFormat === 'drawio') {
              const drawioFileName = `${stem}.drawio`
              drawioPath = path.join(outDir, drawioFileName)
              await writeFile(drawioPath, Buffer.from(xml, 'utf8'))
            }

            if (outputFormat === 'all' || outputFormat === 'svg') {
              const svgFileName = `${stem}.svg`
              svgPath = path.join(outDir, svgFileName)
              await writeFile(svgPath, Buffer.from(svg, 'utf8'))
            }

            // Clipboard and design tool export integration
            const svgBuffer = Buffer.from(svg, 'utf8')
            const designExport = formatDesignExportPayload({
              buffer: svgBuffer,
              mimeType: 'image/svg+xml',
              name: stem,
              width: 1200,
              height: 800,
            })

            const shapesSummary = Array.from(new Set(nodes.map((n) => n.shape || 'rounded'))).join(', ')
            const summary = [
              '### Draw.io Editable Diagram Generated',
              `- **Title**: ${title}`,
              `- **Nodes**: ${nodes.length} (${shapesSummary})`,
              `- **Connections**: ${edges.length}`,
              `- **Layout & Theme**: ${layout} layout • ${theme} theme`,
              drawioPath ? `- **Draw.io File**: \`${drawioPath}\` (editable mxfile XML)` : '',
              svgPath ? `- **Vector Preview**: \`${svgPath}\` (scalable vector graphics)` : '',
            ].filter(Boolean).join('\n')

            return toLosslessJson({
              summary,
              title,
              theme,
              layout,
              format: 'drawio',
              nodeCount: nodes.length,
              edgeCount: edges.length,
              drawioPath,
              svgPath,
              xml,
              svg,
              figmaHtml: designExport.figmaHtml,
              penpotSnippet: designExport.penpotSnippet,
              attachment: null,
            })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool generate_drawio_diagram')
}
