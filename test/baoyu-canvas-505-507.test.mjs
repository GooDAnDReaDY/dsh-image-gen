import test from 'node:test'
import assert from 'node:assert/strict'
import {
  composeBaoyuPrompt,
  getBaoyuTaxonomy,
  BAOYU_DEFAULT_SELECTION,
} from '../lib/baoyu-compose.js'
import { registerBaoyuComposeTools } from '../lib/tools/baoyu-compose.js'
import { CanvasMirror, getCanvasMirror } from '../lib/canvas-state.js'
import { registerCanvasTools } from '../lib/tools/canvas.js'
import { registerCanvasRoutes } from '../lib/canvas-route.js'

test('Issue #505: getBaoyuTaxonomy returns 5 orthogonal dimensions', async () => {
  const tax = await getBaoyuTaxonomy()
  assert.equal(tax.types.length, 6, 'Must have 6 composition types')
  assert.equal(tax.palettes.length, 11, 'Must have 11 color palettes')
  assert.equal(tax.renderings.length, 7, 'Must have 7 rendering styles')
  assert.equal(tax.moods.length, 3, 'Must have 3 moods')
  assert.equal(tax.textLevels.length, 4, 'Must have 4 text levels')
  assert.ok(tax.labelsZh.hero)
})

test('Issue #505: composeBaoyuPrompt generates complete design specification', async () => {
  const res = await composeBaoyuPrompt({
    title: 'The Future of Agentic Coding',
    type: 'metaphor',
    palette: 'warm',
    rendering: 'flat-vector',
    text: 'title-subtitle',
    mood: 'balanced',
  })

  assert.ok(res.prompt)
  assert.match(res.prompt, /# Visual Design/)
  assert.match(res.prompt, /Type: metaphor/)
  assert.match(res.prompt, /Palette: warm/)
  assert.match(res.prompt, /Rendering: flat-vector/)
  assert.match(res.prompt, /# Text Elements/)
  assert.match(res.prompt, /Title: "The Future of Agentic Coding"/)
  assert.match(res.prompt, /Subtitle: derive one short supporting line/)
  assert.match(res.prompt, /# Color Scheme/)
  assert.match(res.prompt, /Primary:/)
  assert.match(res.prompt, /Color constraint: Color values \(#hex\) and color names are rendering guidance only/)

  // Text = none
  const noText = await composeBaoyuPrompt({
    title: '',
    text: 'none',
    type: 'minimal',
  })
  assert.match(noText.prompt, /No text elements; the full area stays purely visual/)
})

test('Issue #505: compose_baoyu_prompt tool registers and renders', async () => {
  const tools = []
  const ctx = {
    effect(fn) { fn() },
    tools: { register(def) { tools.push(def) } },
  }
  registerBaoyuComposeTools(ctx, {})

  assert.equal(tools.length, 1)
  const tool = tools[0]
  assert.equal(tool.name, 'compose_baoyu_prompt')
  assert.ok(tool.output.schema)
  assert.equal(typeof tool.output.render, 'function')

  // Execute list_options
  const taxOut = await tool.execute({ list_options: true }, {})
  assert.ok(taxOut.taxonomy)
  assert.match(taxOut.summary, /Baoyu 5-Dimension Design System Taxonomy/)

  // Execute assemble prompt
  const res = await tool.execute({
    title: 'Deep Learning Revolution',
    type: 'hero',
    palette: 'cool',
    rendering: 'digital',
  }, {})
  assert.ok(res.prompt)
  assert.match(res.summary, /Baoyu 5D Prompt Assembled/)

  const rendered = tool.output.render(null, res)
  assert.ok(Array.isArray(rendered))
  assert.match(rendered[0].text, /Baoyu 5D Prompt Assembled/)
})

test('Issue #506: CanvasMirror tracks workbench shapes and digest', () => {
  const mirror = new CanvasMirror()
  assert.equal(mirror.connected(), false)
  assert.match(mirror.digest(), /Image-gen workbench canvas: not connected/)

  mirror.apply({
    clientInstance: 'win-client-1',
    connected: true,
    nodeCount: 3,
    nodes: [
      { kind: 'image', width: 1024, height: 1024, provider: 'fal', model: 'flux-dev', prompt: 'neon cyber cat' },
      { kind: 'draw' },
      { kind: 'note', text: 'refine eye details' },
    ],
    selection: {
      count: 1,
      kinds: ['image'],
      items: [{ kind: 'image', width: 1024, height: 1024, name: 'neon cyber cat' }],
    },
    updatedAt: Date.now(),
  })

  assert.equal(mirror.connected(), true)
  const digest = mirror.digest()
  assert.match(digest, /Image-gen workbench canvas: 3 shapes/)
  assert.match(digest, /1 image/)
  assert.match(digest, /1 draw/)
  assert.match(digest, /1 note/)
  assert.match(digest, /Selection: 1 shape \(image\)/)
  assert.match(digest, /Selected image/)

  // Disconnect removes client instance
  mirror.apply({
    clientInstance: 'win-client-1',
    connected: false,
  })
  assert.equal(mirror.connected(), false)
})

test('Issue #506: canvas_state tool execution returns structured metrics and digest', async () => {
  const tools = []
  const ctx = {
    effect(fn) { fn() },
    tools: { register(def) { tools.push(def) } },
  }
  registerCanvasTools(ctx, {})

  const stateTool = tools.find(t => t.name === 'canvas_state')
  assert.ok(stateTool)
  assert.ok(typeof stateTool.output.render === 'function')

  const res = await stateTool.execute({}, {})
  assert.ok(res.digest)
  assert.equal(typeof res.connected, 'boolean')
  assert.equal(typeof res.nodeCount, 'number')

  const rendered = stateTool.output.render(null, res)
  assert.ok(Array.isArray(rendered))
  assert.ok(rendered[0].text)
})

test('Issue #507: CanvasMirror holds selection screenshot and view_canvas materializes attachment', async () => {
  const mirror = getCanvasMirror()
  mirror.clear()

  const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])

  mirror.apply({
    clientInstance: 'canvas-test-2',
    connected: true,
    nodeCount: 2,
    nodes: [{ kind: 'draw' }, { kind: 'geo', name: 'box' }],
    selection: { count: 1, kinds: ['draw'], items: [{ kind: 'draw' }] },
  }, {
    data: fakePng,
    mediaType: 'image/png',
  })

  assert.equal(mirror.connected(), true)
  assert.ok(mirror.latestSelectionImage())
  assert.equal(mirror.latestSelectionImage().mediaType, 'image/png')

  const savedAttachments = []
  const mockCtx = {
    effect(fn) { fn() },
    tools: { register() {} },
    attachments: {
      async saveImage({ data, mediaType, name }) {
        const att = { attachmentId: 'att-canvas-1', mediaType, bytes: data?.length || 0, name }
        savedAttachments.push(att)
        return att
      },
    },
  }

  const tools = []
  const subCtx = {
    effect(fn) { fn() },
    tools: { register(def) { tools.push(def) } },
    attachments: mockCtx.attachments,
  }

  registerCanvasTools(subCtx, { slugify: s => s })
  const viewTool = tools.find(t => t.name === 'view_canvas')
  assert.ok(viewTool)

  const res = await viewTool.execute({}, {
    agent: { session: { header: { cwd: process.cwd() } } },
  })

  assert.equal(res.hasSelectionImage, true)
  assert.ok(res.attachment)
  assert.equal(res.attachment.attachmentId, 'att-canvas-1')

  const rendered = viewTool.output.render(null, res)
  assert.equal(rendered.length, 2)
  assert.equal(rendered[0].type, 'text')
  assert.equal(rendered[1].type, 'image')
  assert.equal(rendered[1].attachment.attachmentId, 'att-canvas-1')

  // When no image is present, returns graceful warning
  mirror.clear()
  const emptyRes = await viewTool.execute({}, {})
  assert.equal(emptyRes.hasSelectionImage, false)
  assert.match(emptyRes.summary, /No canvas screenshot available/)

  const emptyRender = viewTool.output.render(null, emptyRes)
  assert.equal(emptyRender.length, 1)
  assert.equal(emptyRender[0].type, 'text')
})

test('Issue #506 & #507: registerCanvasRoutes registers HTTP endpoints and processes push', async () => {
  const routes = []
  const fakeWebServer = {
    registerRoute(r) { routes.push(r) },
  }
  const ctx = {
    get(name) {
      if (name === 'webServer') return fakeWebServer
      return null
    },
  }

  registerCanvasRoutes(ctx)
  assert.equal(routes.length, 2)

  const stateRoute = routes.find(r => r.path === '/dsh-image-gen/canvas/state')
  assert.ok(stateRoute)

  // 1. GET state
  let statusGot = null
  let bodyGot = ''
  const reqGet = {
    method: 'GET',
    headers: { host: '127.0.0.1:3000' },
    socket: { remoteAddress: '127.0.0.1' },
  }
  const resGet = {
    writeHead(status, _headers) { statusGot = status },
    end(data) { bodyGot = data },
  }

  await stateRoute.handler(reqGet, resGet)
  assert.equal(statusGot, 200)
  const getParsed = JSON.parse(bodyGot)
  assert.equal(getParsed.ok, true)

  // 2. POST state with base64 screenshot
  const fakeB64 = Buffer.from('hello-canvas-png').toString('base64')
  const payload = JSON.stringify({
    clientInstance: 'http-client-1',
    connected: true,
    nodeCount: 5,
    nodes: [{ kind: 'text', text: 'Hello Canvas' }],
    selection: { count: 1, kinds: ['text'], items: [{ kind: 'text', text: 'Hello Canvas' }] },
    selectionImage: `data:image/png;base64,${fakeB64}`,
  })

  async function* makeChunks(str) {
    yield Buffer.from(str)
  }

  const reqPost = Object.assign(makeChunks(payload), {
    method: 'POST',
    headers: { host: '127.0.0.1:3000', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
  })
  const resPost = {
    writeHead(status, _headers) { statusGot = status },
    end(data) { bodyGot = data },
  }

  await stateRoute.handler(reqPost, resPost)
  assert.equal(statusGot, 200)
  const postParsed = JSON.parse(bodyGot)
  assert.equal(postParsed.ok, true)
  assert.equal(postParsed.connected, true)

  const mirror = getCanvasMirror()
  assert.equal(mirror.latest().clientInstance, 'http-client-1')
  assert.equal(mirror.latestSelectionImage().data.toString('utf8'), 'hello-canvas-png')
})
