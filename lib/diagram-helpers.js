// diagram-helpers.js — helper functions for beautify_diagram tool (#185).

export const DIAGRAM_3D_STYLES = {
  isometric_3d: {
    name: 'isometric_3d',
    label: 'Glossy 3D Isometric Architecture',
    directive: 'ultra-detailed 3D isometric architecture visualization, floating frosted glassmorphism node panels, luminous glowing neon data pipelines, soft ambient occlusion, Octane 3D render, tech presentation hero graphic',
  },
  cyber_blueprint: {
    name: 'cyber_blueprint',
    label: 'Holographic Cyber Blueprint',
    directive: 'holographic 3D engineering schematic, isometric grid perspective, glowing cyan and amber circuit traces, semi-transparent HUD modules, high-tech enterprise infrastructure',
  },
  clay_minimal: {
    name: 'clay_minimal',
    label: 'Minimalist Tactile Clay Render',
    directive: 'minimalist 3D isometric clay render, smooth matte ceramic node blocks, soft directional studio lighting, elegant pastel palette on clean backdrop, tactile editorial illustration',
  },
  glossy_dark: {
    name: 'glossy_dark',
    label: 'Obsidian Glass Dark Mode',
    directive: 'dark obsidian glassmorphic 3D diagram, luminous neon accent borders, dark slate background, glowing fiber-optic connectors, enterprise cloud architecture showcase',
  },
}

/**
 * Extracts nodes and connections from raw Mermaid or Graphviz diagram text.
 *
 * @param {string} sourceCode
 * @returns {{ nodes: string[], connections: string[], summary: string }}
 */
export function parseMermaidStructure(sourceCode = '') {
  const text = String(sourceCode).trim()
  if (!text) {
    return { nodes: [], connections: [], summary: 'generic multi-tiered system topology' }
  }

  const nodes = new Set()
  const connections = []

  // Extract node labels inside brackets: A[Client App], B(API Gateway), C[(Database)]
  const bracketMatches = text.matchAll(/([A-Za-z0-9_]+)\s*(\[|\(|\{\[|\(\[)([\s\S]*?)(\]|\)|\}\]|\)\])/g)
  for (const m of bracketMatches) {
    const label = m[3]?.replace(/^[\(\[\{]+|[\)\]\}]+$/g, '').trim()
    if (label && label.length < 50) {
      nodes.add(label)
    }
  }

  // Extract connection arrows: -->, ==>, -.->
  const arrowLines = text.split('\n').filter((l) => l.includes('-->') || l.includes('==>') || l.includes('-.->'))
  for (const line of arrowLines.slice(0, 10)) {
    const cleaned = line.replace(/\[.*?\]|\(.*?\)/g, '').trim()
    if (cleaned) connections.push(cleaned)
  }

  const nodeList = Array.from(nodes)
  let summary = ''
  if (nodeList.length > 0) {
    summary = `nodes representing ${nodeList.slice(0, 6).join(', ')} connected in structured data flow`
  } else {
    summary = 'structured multi-node architectural graph showing sequential service pipelines'
  }

  return {
    nodes: nodeList,
    connections,
    summary,
  }
}

/**
 * Builds the prompt for beautify_diagram image synthesis.
 *
 * @param {object} options
 * @param {string} options.diagram Raw Mermaid code, SVG, or description
 * @param {string} [options.style] Style preset key from DIAGRAM_3D_STYLES
 * @param {string} [options.title] Optional main title
 * @param {string} [options.aspectRatio='16:9']
 * @returns {{ prompt: string, negativePrompt: string, style: string, parsedNodes: string[] }}
 */
export function buildDiagramIllustrationPrompt(options = {}) {
  const { diagram, style = 'isometric_3d', title, aspectRatio = '16:9' } = options
  const styleDef = DIAGRAM_3D_STYLES[style] || DIAGRAM_3D_STYLES.isometric_3d

  const parsed = parseMermaidStructure(diagram)
  const titlePart = title ? `titled "${title}", ` : ''

  const corePrompt = [
    `high-end 3D architectural illustration ${titlePart}`,
    `depicting ${parsed.summary}`,
    styleDef.directive,
    'clean isometric angle, centered composition, pristine technical depth, 8k resolution, suitable for developer documentation and hero banner',
  ].filter(Boolean).join(', ')

  const negativePrompt = 'messy handwriting, scribbles, low resolution, 2D flat wireframe, unreadable blurry text, broken geometry, chaotic distortion, watermark'

  return {
    prompt: corePrompt,
    negativePrompt,
    style: styleDef.name,
    parsedNodes: parsed.nodes,
    aspectRatio,
  }
}
