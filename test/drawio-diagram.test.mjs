// @ts-check
// drawio-diagram.test.mjs — tests for Draw.io mxfile and vector diagram generation (#451).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DRAWIO_THEMES,
  DRAWIO_SHAPES,
  DRAWIO_EDGE_STYLES,
  normalizeNodes,
  normalizeEdges,
  computeDiagramLayout,
  generateMxfileXml,
  generateDiagramSvgPreview,
} from '../lib/drawio-helpers.js'
import { registerDrawioDiagramTools } from '../lib/tools/drawio-diagram.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(here, '..', 'lib')

test('drawio: themes and shapes dictionaries declare all supported aesthetics', () => {
  const expectedThemes = ['light', 'dark', 'blueprint', 'corporate', 'nord']
  for (const t of expectedThemes) {
    assert.ok(DRAWIO_THEMES[t], `Theme ${t} must be defined`)
    assert.ok(DRAWIO_THEMES[t].background)
    assert.ok(DRAWIO_THEMES[t].textColor)
    assert.ok(DRAWIO_THEMES[t].palette.length >= 4)
  }

  const expectedShapes = ['rectangle', 'rounded', 'ellipse', 'diamond', 'cylinder', 'cloud', 'actor']
  for (const s of expectedShapes) {
    assert.ok(DRAWIO_SHAPES[s], `Shape ${s} must be defined`)
  }

  assert.ok(DRAWIO_EDGE_STYLES.orthogonal)
  assert.ok(DRAWIO_EDGE_STYLES.straight)
  assert.ok(DRAWIO_EDGE_STYLES.curved)
})

test('drawio: normalizeNodes and normalizeEdges parse objects and JSON strings', () => {
  const rawNodes = [
    { id: 'web', label: 'Web App', shape: 'rounded' },
    { id: 'api', label: 'REST API', shape: 'cylinder' },
  ]
  const nodes = normalizeNodes(rawNodes)
  assert.equal(nodes.length, 2)
  assert.equal(nodes[0].id, 'web')
  assert.equal(nodes[0].shape, 'rounded')
  assert.equal(nodes[1].id, 'api')
  assert.equal(nodes[1].shape, 'cylinder')

  // JSON string parsing
  const jsonNodes = JSON.stringify([{ id: 'worker', label: 'Worker Queue' }])
  const parsedJson = normalizeNodes(jsonNodes)
  assert.equal(parsedJson.length, 1)
  assert.equal(parsedJson[0].id, 'worker')

  // Edges parsing
  const rawEdges = [
    { source: 'web', target: 'api', label: 'HTTP /api', style: 'orthogonal' },
  ]
  const edges = normalizeEdges(rawEdges)
  assert.equal(edges.length, 1)
  assert.equal(edges[0].source, 'web')
  assert.equal(edges[0].target, 'api')
  assert.equal(edges[0].label, 'HTTP /api')
})

test('drawio: computeDiagramLayout calculates valid coordinates across layouts', () => {
  const nodes = normalizeNodes([
    { id: 'client', label: 'Client' },
    { id: 'gateway', label: 'Gateway' },
    { id: 'auth', label: 'Auth Service' },
    { id: 'db', label: 'Database', shape: 'cylinder' },
  ])
  const edges = normalizeEdges([
    { source: 'client', target: 'gateway' },
    { source: 'gateway', target: 'auth' },
    { source: 'gateway', target: 'db' },
  ])

  // 1. Horizontal layout (LR)
  const hNodes = computeDiagramLayout(nodes, edges, 'horizontal')
  assert.equal(hNodes.length, 4)
  const clientNode = hNodes.find((n) => n.id === 'client')
  const gatewayNode = hNodes.find((n) => n.id === 'gateway')
  assert.ok(clientNode.x < gatewayNode.x, 'Client node must be to the left of Gateway in horizontal layout')

  // 2. Vertical layout (TB)
  const vNodes = computeDiagramLayout(nodes, edges, 'vertical')
  const clientNodeV = vNodes.find((n) => n.id === 'client')
  const gatewayNodeV = vNodes.find((n) => n.id === 'gateway')
  assert.ok(clientNodeV.y < gatewayNodeV.y, 'Client node must be above Gateway in vertical layout')

  // 3. Grid layout
  const gridNodes = computeDiagramLayout(nodes, edges, 'grid')
  assert.equal(gridNodes.length, 4)
  gridNodes.forEach((n) => {
    assert.ok(typeof n.x === 'number')
    assert.ok(typeof n.y === 'number')
  })
})

test('drawio: generateMxfileXml produces standard editable mxGraphModel XML', () => {
  const xml = generateMxfileXml({
    title: 'Cloud Architecture',
    nodes: [
      { id: 'fe', label: 'Frontend UI', shape: 'rounded' },
      { id: 'be', label: 'Backend API', shape: 'rectangle' },
      { id: 'sql', label: 'PostgreSQL', shape: 'cylinder' },
    ],
    edges: [
      { source: 'fe', target: 'be', label: 'Fetch' },
      { source: 'be', target: 'sql', label: 'Query' },
    ],
    layout: 'horizontal',
    theme: 'blueprint',
  })

  assert.ok(xml.includes('<?xml version="1.0" encoding="UTF-8"?>'))
  assert.ok(xml.includes('<mxfile host="dsh"'))
  assert.ok(xml.includes('<diagram id='))
  assert.ok(xml.includes('name="Cloud Architecture"'))
  assert.ok(xml.includes('<mxGraphModel'))
  assert.ok(xml.includes('<mxCell id="0"/>'))
  assert.ok(xml.includes('<mxCell id="1" parent="0"/>'))
  assert.ok(xml.includes('id="fe" value="Frontend UI"'))
  assert.ok(xml.includes('id="sql" value="PostgreSQL"'))
  assert.ok(xml.includes('source="fe" target="be"'))
  assert.ok(xml.includes('shape=cylinder3'))
})

test('drawio: generateDiagramSvgPreview produces standalone vector SVG preview', () => {
  const svg = generateDiagramSvgPreview({
    title: 'Payment Workflow',
    nodes: [
      { id: 'user', label: 'Customer', shape: 'actor' },
      { id: 'checkout', label: 'Checkout Service', shape: 'rounded' },
      { id: 'stripe', label: 'Stripe API', shape: 'cloud' },
    ],
    edges: [
      { source: 'user', target: 'checkout', label: 'Submits card' },
      { source: 'checkout', target: 'stripe', label: 'Charge token' },
    ],
    layout: 'horizontal',
    theme: 'corporate',
  })

  assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'))
  assert.ok(svg.includes('id="diagram-title"'))
  assert.ok(svg.includes('Payment Workflow'))
  assert.ok(svg.includes('id="user"'))
  assert.ok(svg.includes('id="checkout"'))
  assert.ok(svg.includes('id="stripe"'))
  assert.ok(svg.includes('Submits card'))
  assert.ok(svg.includes('marker id="arrow-corporate"'))
  assert.ok(svg.includes('</svg>'))
})

test('drawio: tool declaration has valid schema, description, and output.render (#451)', () => {
  const src = fs.readFileSync(path.join(lib, 'tools', 'drawio-diagram.js'), 'utf8')
  assert.match(src, /name:\s*'generate_drawio_diagram'/)
  assert.match(src, /nodes:\s*\{/)
  assert.match(src, /edges:\s*\{/)
  assert.match(src, /layout:\s*\{/)
  assert.match(src, /theme:\s*\{/)

  const registered = []
  const mockCtx = {
    effect(fn) { fn() },
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
  }

  registerDrawioDiagramTools(mockCtx, {
    live: () => ({ outputDir: 'tmp-drawio-test' }),
    slugify: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  })

  assert.equal(registered.length, 1)
  const tool = registered[0]
  assert.equal(tool.name, 'generate_drawio_diagram')
  assert.equal(typeof tool.output.render, 'function')
  assert.equal(tool.output.schema.type, 'object')
  assert.equal(tool.output.schema.additionalProperties, true)

  const rendered = tool.output.render(null, {
    summary: 'OK',
    title: 'Test Diagram',
    drawioPath: '/tmp/test.drawio',
    svgPath: '/tmp/test.svg',
  })
  assert.ok(Array.isArray(rendered))
  assert.equal(rendered[0]?.text, 'OK')
})

test('drawio: tool execution writes .drawio and .svg files and returns metadata', async () => {
  const registered = []
  const mockCtx = {
    effect(fn) { fn() },
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
  }

  const tmpOutDir = path.join(here, 'tmp-drawio-exec')
  registerDrawioDiagramTools(mockCtx, {
    live: () => ({ outputDir: tmpOutDir }),
    slugify: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  })

  const tool = registered[0]
  assert.ok(tool)

  try {
    const result = await tool.execute({
      title: 'Smoke Microservices',
      nodes: [
        { id: 'gw', label: 'API Gateway', shape: 'rounded' },
        { id: 'svc1', label: 'Auth Service', shape: 'rounded' },
        { id: 'db1', label: 'Users DB', shape: 'cylinder' },
      ],
      edges: [
        { source: 'gw', target: 'svc1', label: 'JWT' },
        { source: 'svc1', target: 'db1', label: 'SQL' },
      ],
      layout: 'horizontal',
      theme: 'nord',
      output_name: 'smoke-test-diagram',
      output_format: 'all',
    }, {
      signal: new AbortController().signal,
      agent: { session: { header: { cwd: process.cwd() } } },
    })

    assert.ok(result)
    assert.equal(result.title, 'Smoke Microservices')
    assert.equal(result.theme, 'nord')
    assert.equal(result.layout, 'horizontal')
    assert.equal(result.format, 'drawio')
    assert.equal(result.nodeCount, 3)
    assert.equal(result.edgeCount, 2)
    assert.ok(result.drawioPath)
    assert.ok(result.svgPath)
    assert.ok(fs.existsSync(result.drawioPath))
    assert.ok(fs.existsSync(result.svgPath))

    // Verify .drawio file content
    const drawioContent = fs.readFileSync(result.drawioPath, 'utf8')
    assert.ok(drawioContent.includes('<mxfile host="dsh"'))
    assert.ok(drawioContent.includes('Smoke Microservices'))

    // Verify .svg file content
    const svgContent = fs.readFileSync(result.svgPath, 'utf8')
    assert.ok(svgContent.includes('<svg xmlns="http://www.w3.org/2000/svg"'))
    assert.ok(svgContent.includes('Smoke Microservices'))
  } finally {
    try {
      fs.rmSync(tmpOutDir, { recursive: true, force: true })
    } catch (_) { /* cleanup */ }
  }
})

test('drawio: tool execution rejects empty nodes parameter with clean error', async () => {
  const registered = []
  const mockCtx = {
    effect(fn) { fn() },
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
  }

  registerDrawioDiagramTools(mockCtx, {
    live: () => ({ outputDir: 'tmp-drawio-test' }),
    slugify: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  })

  const tool = registered[0]
  await assert.rejects(
    async () => { await tool.execute({ nodes: [] }, {}) },
    /At least one node is required to generate a Draw.io diagram/i,
  )
})
