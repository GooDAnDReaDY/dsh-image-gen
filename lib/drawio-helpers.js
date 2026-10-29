// @ts-check
// drawio-helpers.js — Draw.io mxfile XML and interactive diagram generation (#451).
import { escapeXml, sanitizeSvgColor } from './security.js'

/**
 * Aesthetic themes supported by the Draw.io generator.
 */
export const DRAWIO_THEMES = {
  light: {
    name: 'light',
    label: 'Clean Light Modern',
    background: '#ffffff',
    gridColor: '#e5e7eb',
    textColor: '#1f2937',
    edgeStroke: '#4b5563',
    nodeFill: '#f9fafb',
    nodeStroke: '#6b7280',
    palette: ['#dae8fc', '#d5e8d4', '#ffe6cc', '#fff2cc', '#e1d5e7', '#f8cecc', '#e6f3ff', '#f3f4f6'],
    strokePalette: ['#6c8ebf', '#82b366', '#d79b00', '#d6b656', '#9673a6', '#b85450', '#5c96c4', '#64748b'],
  },
  dark: {
    name: 'dark',
    label: 'Deep Obsidian Dark',
    background: '#181825',
    gridColor: '#313244',
    textColor: '#cdd6f4',
    edgeStroke: '#89b4fa',
    nodeFill: '#1e1e2e',
    nodeStroke: '#45475a',
    palette: ['#1e293b', '#1e3a2f', '#3b2f1e', '#3a3a1e', '#2f1e3a', '#3a1e24', '#1e2d3d', '#313244'],
    strokePalette: ['#38bdf8', '#4ade80', '#fbbf24', '#facc15', '#c084fc', '#f87171', '#60a5fa', '#9399b2'],
  },
  blueprint: {
    name: 'blueprint',
    label: 'Cyber Technical Blueprint',
    background: '#0f172a',
    gridColor: '#1e293b',
    textColor: '#f8fafc',
    edgeStroke: '#38bdf8',
    nodeFill: '#1e293b',
    nodeStroke: '#0284c7',
    palette: ['#0c4a6e', '#0369a1', '#0284c7', '#0ea5e9', '#164e63', '#155e75', '#1e293b', '#334155'],
    strokePalette: ['#38bdf8', '#7dd3fc', '#bae6fd', '#38bdf8', '#22d3ee', '#67e8f9', '#94a3b8', '#cbd5e1'],
  },
  corporate: {
    name: 'corporate',
    label: 'Enterprise Navy Corporate',
    background: '#f8fafc',
    gridColor: '#e2e8f0',
    textColor: '#0f172a',
    edgeStroke: '#0369a1',
    nodeFill: '#ffffff',
    nodeStroke: '#0284c7',
    palette: ['#eff6ff', '#f0fdf4', '#fefce8', '#faf5ff', '#fff1f2', '#f0f9ff', '#f5f3ff', '#ffffff'],
    strokePalette: ['#2563eb', '#16a34a', '#ca8a04', '#9333ea', '#e11d48', '#0284c7', '#7c3aed', '#475569'],
  },
  nord: {
    name: 'nord',
    label: 'Nordic Frost Slate',
    background: '#2e3440',
    gridColor: '#3b4252',
    textColor: '#eceff4',
    edgeStroke: '#88c0d0',
    nodeFill: '#3b4252',
    nodeStroke: '#81a1c1',
    palette: ['#434c5e', '#4c566a', '#5e81ac', '#81a1c1', '#88c0d0', '#8fbcbb', '#a3be8c', '#b48ead'],
    strokePalette: ['#88c0d0', '#81a1c1', '#8fbcbb', '#a3be8c', '#ebcb8b', '#d08770', '#bf616a', '#b48ead'],
  },
}

/**
 * Shape definitions and corresponding Draw.io mxCell style strings.
 */
export const DRAWIO_SHAPES = {
  rectangle: 'rounded=0;whiteSpace=wrap;html=1;',
  rounded: 'rounded=1;whiteSpace=wrap;html=1;arcSize=12;',
  ellipse: 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;',
  diamond: 'rhombus;whiteSpace=wrap;html=1;',
  cylinder: 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;',
  cloud: 'ellipse;shape=cloud;whiteSpace=wrap;html=1;',
  actor: 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;',
  hexagon: 'shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;',
  parallelogram: 'shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;',
  step: 'shape=step;perimeter=stepPerimeter;whiteSpace=wrap;html=1;fixedSize=1;',
}

/**
 * Edge connector style templates.
 */
export const DRAWIO_EDGE_STYLES = {
  orthogonal: 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;',
  straight: 'edgeStyle=none;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;',
  curved: 'edgeStyle=orthogonalEdgeStyle;curved=1;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;',
}

/**
 * Normalizes input node list, parsing strings if necessary and ensuring id/label/shape.
 *
 * @param {Array<object|string>|string} rawNodes
 * @returns {Array<object>}
 */
export function normalizeNodes(rawNodes) {
  if (!rawNodes) return []
  let list = rawNodes
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list)
    } catch (_) {
      // Fallback: newline or comma separated labels
      list = list.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).map((label, idx) => ({
        id: `node_${idx + 1}`,
        label,
      }))
    }
  }
  if (!Array.isArray(list)) return []

  return list.map((item, index) => {
    if (typeof item === 'string') {
      return {
        id: `node_${index + 1}`,
        label: item,
        shape: 'rounded',
      }
    }
    const id = String(item.id || item.name || `node_${index + 1}`).trim()
    const label = String(item.label || item.title || item.name || id).trim()
    const shape = DRAWIO_SHAPES[item.shape] ? item.shape : 'rounded'
    return {
      ...item,
      id,
      label,
      shape,
      width: typeof item.width === 'number' && item.width > 20 ? item.width : (shape === 'ellipse' || shape === 'diamond' ? 100 : (shape === 'actor' ? 60 : 140)),
      height: typeof item.height === 'number' && item.height > 20 ? item.height : (shape === 'actor' ? 80 : 70),
    }
  })
}

/**
 * Normalizes input edges list.
 *
 * @param {Array<object|string>|string} rawEdges
 * @returns {Array<object>}
 */
export function normalizeEdges(rawEdges) {
  if (!rawEdges) return []
  let list = rawEdges
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list)
    } catch (_) {
      // Fallback: arrow expressions like "A -> B", "node1 --> node2"
      list = []
      const lines = rawEdges.split('\n')
      for (const line of lines) {
        const m = line.match(/([a-zA-Z0-9_.-]+)\s*(-->|->|=>|==>)\s*([a-zA-Z0-9_.-]+)(?:\s*:\s*(.*))?/)
        if (m) {
          list.push({
            source: m[1].trim(),
            target: m[3].trim(),
            label: m[4]?.trim() || '',
          })
        }
      }
    }
  }
  if (!Array.isArray(list)) return []

  return list.map((item, index) => {
    const source = String(item.source || item.from || '').trim()
    const target = String(item.target || item.to || '').trim()
    const label = String(item.label || item.title || '').trim()
    const id = String(item.id || `edge_${index + 1}`).trim()
    const style = DRAWIO_EDGE_STYLES[item.style] ? item.style : 'orthogonal'
    return {
      ...item,
      id,
      source,
      target,
      label,
      style,
      dashed: Boolean(item.dashed),
      bidirectional: Boolean(item.bidirectional),
    }
  }).filter((e) => e.source && e.target)
}

/**
 * Computes diagram node positions automatically based on topological levels.
 *
 * @param {Array<object>} nodes
 * @param {Array<object>} edges
 * @param {string} [layout='horizontal'] 'horizontal' | 'vertical' | 'grid' | 'tree'
 * @returns {Array<object>} Positioned nodes with x, y, width, height
 */
export function computeDiagramLayout(nodes, edges, layout = 'horizontal') {
  if (!nodes.length) return []

  const nodeMap = new Map()
  nodes.forEach((n) => nodeMap.set(n.id, { ...n }))

  // Check if every node already has valid x and y
  const allPositioned = nodes.every((n) => typeof n.x === 'number' && typeof n.y === 'number')
  if (allPositioned) {
    return Array.from(nodeMap.values())
  }

  // Graph adjacency and in-degrees
  const inDegree = new Map()
  const adj = new Map()
  nodes.forEach((n) => {
    inDegree.set(n.id, 0)
    adj.set(n.id, [])
  })

  edges.forEach((e) => {
    if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
      adj.get(e.source)?.push(e.target)
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1)
    }
  })

  // Group nodes into levels
  const levels = new Map()
  const roots = nodes.filter((n) => (inDegree.get(n.id) || 0) === 0).map((n) => n.id)
  const queue = roots.length > 0 ? roots : [nodes[0].id]
  const visited = new Set()

  queue.forEach((r) => levels.set(r, 0))

  while (queue.length > 0) {
    const curr = queue.shift()
    if (!curr || visited.has(curr)) continue
    visited.add(curr)
    const currLevel = levels.get(curr) || 0

    const neighbors = adj.get(curr) || []
    for (const next of neighbors) {
      const nextLevel = Math.max(levels.get(next) || 0, currLevel + 1)
      levels.set(next, nextLevel)
      if (!visited.has(next) && !queue.includes(next)) {
        queue.push(next)
      }
    }
  }

  // Assign level 0 to unvisited nodes
  nodes.forEach((n) => {
    if (!levels.has(n.id)) levels.set(n.id, 0)
  })

  // Group node ids by level
  const levelGroups = new Map()
  nodes.forEach((n) => {
    const lvl = levels.get(n.id) || 0
    if (!levelGroups.has(lvl)) levelGroups.set(lvl, [])
    levelGroups.get(lvl).push(n.id)
  })

  const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b)

  if (layout === 'grid') {
    const cols = Math.ceil(Math.sqrt(nodes.length))
    nodes.forEach((n, idx) => {
      const node = nodeMap.get(n.id)
      if (typeof node.x !== 'number' || typeof node.y !== 'number') {
        const c = idx % cols
        const r = Math.floor(idx / cols)
        node.x = 80 + c * 200
        node.y = 100 + r * 140
      }
    })
    return Array.from(nodeMap.values())
  }

  if (layout === 'vertical') {
    // Flow from Top to Bottom
    let currentY = 100
    for (const lvl of sortedLevels) {
      const group = levelGroups.get(lvl) || []
      const totalWidth = group.reduce((sum, id) => sum + (nodeMap.get(id)?.width || 140) + 40, 0) - 40
      let currentX = Math.max(80, (900 - totalWidth) / 2)

      let maxHeightInLevel = 70
      for (const id of group) {
        const node = nodeMap.get(id)
        if (typeof node.x !== 'number') node.x = Math.round(currentX)
        if (typeof node.y !== 'number') node.y = Math.round(currentY)
        currentX += (node.width || 140) + 40
        maxHeightInLevel = Math.max(maxHeightInLevel, node.height || 70)
      }
      currentY += maxHeightInLevel + 90
    }
    return Array.from(nodeMap.values())
  }

  // Default: horizontal (Left to Right flow) or tree
  let currentX = 80
  for (const lvl of sortedLevels) {
    const group = levelGroups.get(lvl) || []
    const totalHeight = group.reduce((sum, id) => sum + (nodeMap.get(id)?.height || 70) + 40, 0) - 40
    let currentY = Math.max(100, (600 - totalHeight) / 2)

    let maxWidthInLevel = 140
    for (const id of group) {
      const node = nodeMap.get(id)
      if (typeof node.x !== 'number') node.x = Math.round(currentX)
      if (typeof node.y !== 'number') node.y = Math.round(currentY)
      currentY += (node.height || 70) + 40
      maxWidthInLevel = Math.max(maxWidthInLevel, node.width || 140)
    }
    currentX += maxWidthInLevel + 100
  }

  return Array.from(nodeMap.values())
}

/**
 * Builds standard Draw.io / mxfile XML string.
 *
 * @param {object} params
 * @param {string} [params.title='Architecture Diagram']
 * @param {Array<object>} params.nodes
 * @param {Array<object>} params.edges
 * @param {string} [params.layout='horizontal']
 * @param {string} [params.theme='light']
 * @returns {string} Valid mxfile XML
 */
export function generateMxfileXml({
  title = 'Architecture Diagram',
  nodes = [],
  edges = [],
  layout = 'horizontal',
  theme = 'light',
}) {
  const normNodes = normalizeNodes(nodes)
  const normEdges = normalizeEdges(edges)
  const positionedNodes = computeDiagramLayout(normNodes, normEdges, layout)
  const themeDef = DRAWIO_THEMES[theme] || DRAWIO_THEMES.light

  const diagramId = 'diag_' + Math.random().toString(36).substring(2, 10)
  const timestamp = new Date().toISOString()

  // Calculate page bounds
  let maxX = 900
  let maxY = 600
  positionedNodes.forEach((n) => {
    maxX = Math.max(maxX, (n.x || 0) + (n.width || 140) + 100)
    maxY = Math.max(maxY, (n.y || 0) + (n.height || 70) + 100)
  })

  const lines = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push(`<mxfile host="dsh" modified="${timestamp}" agent="dsh-image-gen" version="21.0.0" type="device">`)
  lines.push(`  <diagram id="${diagramId}" name="${escapeXml(title)}">`)
  lines.push(`    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${maxX}" pageHeight="${maxY}" background="${themeDef.background}" math="0" shadow="0">`)
  lines.push('      <root>')
  lines.push('        <mxCell id="0"/>')
  lines.push('        <mxCell id="1" parent="0"/>')

  // Render Nodes
  positionedNodes.forEach((node, idx) => {
    const shapeStyle = DRAWIO_SHAPES[node.shape] || DRAWIO_SHAPES.rounded
    const fillColor = node.fill || themeDef.palette[idx % themeDef.palette.length]
    const strokeColor = node.stroke || themeDef.strokePalette[idx % themeDef.strokePalette.length]
    const fontColor = node.textColor || themeDef.textColor

    let style = `${shapeStyle}fillColor=${fillColor};strokeColor=${strokeColor};fontColor=${fontColor};fontSize=13;fontStyle=1;`
    if (node.dashed) style += 'dashed=1;'

    const escapedLabel = escapeXml(node.label || node.id)
    lines.push(`        <mxCell id="${escapeXml(node.id)}" value="${escapedLabel}" style="${escapeXml(style)}" vertex="1" parent="1">`)
    lines.push(`          <mxGeometry x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" as="geometry"/>`)
    lines.push('        </mxCell>')
  })

  // Render Edges
  normEdges.forEach((edge, idx) => {
    const edgeStyleBase = DRAWIO_EDGE_STYLES[edge.style] || DRAWIO_EDGE_STYLES.orthogonal
    const strokeColor = edge.stroke || themeDef.edgeStroke
    let style = `${edgeStyleBase}strokeColor=${strokeColor};strokeWidth=2;`
    if (edge.dashed) style += 'dashed=1;'
    if (edge.bidirectional) style += 'startArrow=classic;endArrow=classic;'

    const escapedLabel = escapeXml(edge.label || '')
    lines.push(`        <mxCell id="${escapeXml(edge.id || `edge_${idx + 1}`)}" value="${escapedLabel}" style="${escapeXml(style)}" edge="1" parent="1" source="${escapeXml(edge.source)}" target="${escapeXml(edge.target)}">`)
    lines.push('          <mxGeometry relative="1" as="geometry"/>')
    lines.push('        </mxCell>')
  })

  lines.push('      </root>')
  lines.push('    </mxGraphModel>')
  lines.push('  </diagram>')
  lines.push('</mxfile>')

  return lines.join('\n')
}

/**
 * Generates a clean, standalone, high-fidelity SVG preview from diagram model.
 *
 * @param {object} params
 * @param {string} [params.title='Architecture Diagram']
 * @param {Array<object>} params.nodes
 * @param {Array<object>} params.edges
 * @param {string} [params.layout='horizontal']
 * @param {string} [params.theme='light']
 * @returns {string} Standalone SVG document
 */
export function generateDiagramSvgPreview({
  title = 'Architecture Diagram',
  nodes = [],
  edges = [],
  layout = 'horizontal',
  theme = 'light',
}) {
  const normNodes = normalizeNodes(nodes)
  const normEdges = normalizeEdges(edges)
  const positionedNodes = computeDiagramLayout(normNodes, normEdges, layout)
  const themeDef = DRAWIO_THEMES[theme] || DRAWIO_THEMES.light

  const nodeMap = new Map()
  positionedNodes.forEach((n) => nodeMap.set(n.id, n))

  // Find canvas dimensions
  let minX = 40
  let minY = 40
  let maxX = 800
  let maxY = 500

  positionedNodes.forEach((n) => {
    maxX = Math.max(maxX, (n.x || 0) + (n.width || 140) + 60)
    maxY = Math.max(maxY, (n.y || 0) + (n.height || 70) + 60)
  })

  const width = maxX
  const height = maxY

  const svgParts = []
  svgParts.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background-color:${themeDef.background};font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">`)

  // Definitions for markers and filters
  svgParts.push('  <defs>')
  svgParts.push(`    <marker id="arrow-${theme}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`)
  svgParts.push(`      <path d="M 0 1 L 10 5 L 0 9 z" fill="${sanitizeSvgColor(themeDef.edgeStroke)}" />`)
  svgParts.push('    </marker>')
  svgParts.push(`    <pattern id="grid-${theme}" width="20" height="20" patternUnits="userSpaceOnUse">`)
  svgParts.push(`      <circle cx="2" cy="2" r="1" fill="${sanitizeSvgColor(themeDef.gridColor)}" />`)
  svgParts.push('    </pattern>')
  svgParts.push('  </defs>')

  // Background Grid
  svgParts.push(`  <rect width="100%" height="100%" fill="${sanitizeSvgColor(themeDef.background)}"/>`)
  svgParts.push(`  <rect width="100%" height="100%" fill="url(#grid-${theme})"/>`)

  // Title Bar
  if (title) {
    svgParts.push(`  <g id="diagram-title" transform="translate(40, 45)">`)
    svgParts.push(`    <circle cx="10" cy="-6" r="5" fill="${sanitizeSvgColor(themeDef.edgeStroke)}" />`)
    svgParts.push(`    <text x="24" y="0" fill="${sanitizeSvgColor(themeDef.textColor)}" font-size="18" font-weight="700">${escapeXml(title)}</text>`)
    svgParts.push(`    <text x="24" y="20" fill="${sanitizeSvgColor(themeDef.edgeStroke)}" font-size="11" font-weight="500">Draw.io Interactive Vector Model (${layout.toUpperCase()} • ${theme.toUpperCase()})</text>`)
    svgParts.push('  </g>')
  }

  // Draw Edges
  svgParts.push('  <g id="edges">')
  normEdges.forEach((edge) => {
    const srcNode = nodeMap.get(edge.source)
    const tgtNode = nodeMap.get(edge.target)
    if (!srcNode || !tgtNode) return

    const srcCenterX = (srcNode.x || 0) + (srcNode.width || 140) / 2
    const srcCenterY = (srcNode.y || 0) + (srcNode.height || 70) / 2
    const tgtCenterX = (tgtNode.x || 0) + (tgtNode.width || 140) / 2
    const tgtCenterY = (tgtNode.y || 0) + (tgtNode.height || 70) / 2

    let startX = srcCenterX
    let startY = srcCenterY
    let endX = tgtCenterX
    let endY = tgtCenterY

    // Calculate boundary contact points based on relative direction
    if (Math.abs(tgtCenterX - srcCenterX) > Math.abs(tgtCenterY - srcCenterY)) {
      if (tgtCenterX > srcCenterX) {
        startX = (srcNode.x || 0) + (srcNode.width || 140)
        endX = tgtNode.x || 0
      } else {
        startX = srcNode.x || 0
        endX = (tgtNode.x || 0) + (tgtNode.width || 140)
      }
    } else {
      if (tgtCenterY > srcCenterY) {
        startY = (srcNode.y || 0) + (srcNode.height || 70)
        endY = tgtNode.y || 0
      } else {
        startY = srcNode.y || 0
        endY = (tgtNode.y || 0) + (tgtNode.height || 70)
      }
    }

    let d = ''
    if (edge.style === 'straight') {
      d = `M ${startX} ${startY} L ${endX} ${endY}`
    } else if (edge.style === 'curved') {
      const midX = (startX + endX) / 2
      const midY = (startY + endY) / 2
      d = `M ${startX} ${startY} Q ${midX} ${startY} ${midX} ${midY} T ${endX} ${endY}`
    } else {
      // Orthogonal step
      const midX = Math.round((startX + endX) / 2)
      d = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`
    }

    const stroke = sanitizeSvgColor(edge.stroke || themeDef.edgeStroke)
    const strokeDash = edge.dashed ? ' stroke-dasharray="5,5"' : ''
    svgParts.push(`    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2"${strokeDash} marker-end="url(#arrow-${theme})" />`)

    if (edge.label) {
      const labelX = Math.round((startX + endX) / 2)
      const labelY = Math.round((startY + endY) / 2) - 6
      const labelBg = sanitizeSvgColor(themeDef.background)
      const labelText = sanitizeSvgColor(themeDef.textColor)
      svgParts.push(`    <rect x="${labelX - 30}" y="${labelY - 10}" width="60" height="18" rx="4" fill="${labelBg}" stroke="${stroke}" stroke-width="1" />`)
      svgParts.push(`    <text x="${labelX}" y="${labelY + 3}" text-anchor="middle" font-size="10" font-weight="600" fill="${labelText}">${escapeXml(edge.label)}</text>`)
    }
  })
  svgParts.push('  </g>')

  // Draw Nodes
  svgParts.push('  <g id="nodes">')
  positionedNodes.forEach((node, idx) => {
    const x = node.x || 0
    const y = node.y || 0
    const w = node.width || 140
    const h = node.height || 70
    const fill = sanitizeSvgColor(node.fill || themeDef.palette[idx % themeDef.palette.length])
    const stroke = sanitizeSvgColor(node.stroke || themeDef.strokePalette[idx % themeDef.strokePalette.length])
    const textFill = sanitizeSvgColor(node.textColor || themeDef.textColor)

    svgParts.push(`    <g id="${escapeXml(node.id)}" transform="translate(${x}, ${y})">`)

    if (node.shape === 'ellipse') {
      svgParts.push(`      <ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`)
    } else if (node.shape === 'diamond') {
      const pts = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`
      svgParts.push(`      <polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`)
    } else if (node.shape === 'cylinder') {
      const r = 10
      svgParts.push(`      <path d="M 0 ${r} A ${w / 2} ${r} 0 0 1 ${w} ${r} L ${w} ${h - r} A ${w / 2} ${r} 0 0 1 0 ${h - r} Z" fill="${fill}" stroke="${stroke}" stroke-width="2" />`)
      svgParts.push(`      <ellipse cx="${w / 2}" cy="${r}" rx="${w / 2}" ry="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`)
    } else if (node.shape === 'actor') {
      const headR = 14
      svgParts.push(`      <circle cx="${w / 2}" cy="18" r="${headR}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`)
      svgParts.push(`      <path d="M ${w / 2} 32 L ${w / 2} 55 M ${w / 2 - 18} 40 L ${w / 2 + 18} 40 M ${w / 2} 55 L ${w / 2 - 14} 75 M ${w / 2} 55 L ${w / 2 + 14} 75" fill="none" stroke="${stroke}" stroke-width="2"/>`)
    } else {
      // Rounded or rectangle
      const rx = node.shape === 'rectangle' ? 0 : 8
      svgParts.push(`      <rect x="0" y="0" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`)
    }

    // Node text
    const textY = node.shape === 'actor' ? h + 14 : Math.round(h / 2) + 5
    svgParts.push(`      <text x="${w / 2}" y="${textY}" text-anchor="middle" font-size="12" font-weight="600" fill="${textFill}">${escapeXml(node.label || node.id)}</text>`)
    svgParts.push('    </g>')
  })
  svgParts.push('  </g>')

  svgParts.push('</svg>')
  return svgParts.join('\n')
}
