import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DIAGRAM_3D_STYLES,
  parseMermaidStructure,
  buildDiagramIllustrationPrompt,
} from '../lib/diagram-helpers.js'
import { registerDiagramTools } from '../lib/tools/diagram.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(here, '..', 'lib')

test('diagram: DIAGRAM_3D_STYLES contains all 4 aesthetics', () => {
  assert.ok(DIAGRAM_3D_STYLES.isometric_3d)
  assert.ok(DIAGRAM_3D_STYLES.cyber_blueprint)
  assert.ok(DIAGRAM_3D_STYLES.clay_minimal)
  assert.ok(DIAGRAM_3D_STYLES.glossy_dark)
})

test('diagram: parseMermaidStructure extracts nodes, arrows, and generates topological summary', () => {
  const mermaid = `
    flowchart TD
      A[Frontend Web App] --> B(API Gateway)
      B --> C[(PostgreSQL Database)]
      B --> D[Redis Cache]
  `
  const res = parseMermaidStructure(mermaid)
  assert.ok(res.nodes.includes('Frontend Web App'))
  assert.ok(res.nodes.includes('API Gateway'))
  assert.ok(res.nodes.includes('PostgreSQL Database'))
  assert.ok(res.nodes.includes('Redis Cache'))
  assert.equal(res.nodes.length, 4)
  assert.ok(res.summary.includes('Frontend Web App'))
})

test('diagram: buildDiagramIllustrationPrompt generates complete 3D prompt', () => {
  const res = buildDiagramIllustrationPrompt({
    diagram: 'A[Client] --> B[Server]',
    style: 'cyber_blueprint',
    title: 'Microservices Flow',
    aspectRatio: '21:9',
  })

  assert.equal(res.style, 'cyber_blueprint')
  assert.equal(res.aspectRatio, '21:9')
  assert.ok(res.prompt.includes('Microservices Flow'))
  assert.ok(res.prompt.includes('holographic 3D engineering schematic'))
  assert.ok(res.prompt.includes('isometric'))
  assert.ok(res.negativePrompt.includes('messy handwriting'))
})

test('diagram: tool file declares beautify_diagram with valid schema and render (#185)', () => {
  const src = fs.readFileSync(path.join(lib, 'tools', 'diagram.js'), 'utf8')
  assert.match(src, /name:\s*'beautify_diagram'/)
  assert.match(src, /diagram:\s*\{/)
  assert.match(src, /style:\s*\{/)
  assert.match(src, /additionalProperties:\s*true/)

  const registered = []
  const mockCtx = {
    effect(fn) { fn() },
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
  }

  registerDiagramTools(mockCtx, {
    live: { value: {} },
    slugify: (s) => s.toLowerCase().replace(/\s+/g, '-'),
    resolveApiKey: () => 'fake-key',
  })

  assert.equal(registered.length, 1)
  const tool = registered[0]
  assert.equal(tool.name, 'beautify_diagram')
  assert.equal(typeof tool.output.render, 'function')
  assert.equal(tool.output.schema.type, 'object')
  assert.equal(tool.output.schema.additionalProperties, true)

  const sampleRender = tool.output.render(null, {
    summary: 'OK',
    title: 'Cloud Infrastructure',
    style: 'isometric_3d',
    detectedNodes: ['Auth', 'Gateway', 'Cluster'],
  })
  assert.ok(Array.isArray(sampleRender))
  assert.ok(sampleRender.length >= 1)
})
