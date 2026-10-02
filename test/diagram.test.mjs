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
  assert.equal(sampleRender[0]?.text, 'OK')
  assert.ok(sampleRender.length >= 1)
})

test('diagram: registered execute runs through full provider and storage pipeline (#359)', async () => {
  const registered = []
  const mockCtx = {
    effect(fn) { fn() },
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
    logger: {
      warn() {},
      info() {},
    },
  }

  const liveConfig = {
    enabled: true,
    provider: 'fal',
    outputDir: 'tmp-diagram-test',
    dailyBudgetUsd: 10,
    model: 'fal-ai/flux-2/klein/9b',
  }

  registerDiagramTools(mockCtx, {
    live: () => liveConfig,
    slugify: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey: () => 'fake-key',
  })

  const tool = registered[0]
  assert.ok(tool)

  const originalFetch = globalThis.fetch
  const mockPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.includes('fal-ai/flux-2')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ request_id: 'r1', status_url: 'https://q/status', response_url: 'https://q/result' }),
      }
    }
    if (s === 'https://q/status') {
      return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED', response_url: 'https://q/result' }) }
    }
    if (s === 'https://q/result') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ images: [{ url: 'https://example.com/mock-diagram.png', width: 1024, height: 576 }], seed: 42 }),
      }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => mockPng.buffer.slice(mockPng.byteOffset, mockPng.byteOffset + mockPng.byteLength),
    }
  }

  try {
    const result = await tool.execute({
      diagram: 'graph TD; A-->B;',
      style: 'isometric_3d',
      title: 'Data Pipeline',
      seed: 42,
    }, {
      signal: new AbortController().signal,
      agent: { session: { header: { cwd: process.cwd() } } },
    })

    assert.ok(result)
    assert.equal(result.seed, 42)
    assert.equal(result.style, 'isometric_3d')
    assert.equal(result.provider, 'fal')
    assert.ok(result.prompt.includes('Data Pipeline'))
    assert.ok(result.path || result.url)
  } finally {
    globalThis.fetch = originalFetch
  }
})
