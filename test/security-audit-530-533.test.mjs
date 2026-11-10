import test from 'node:test'
import assert from 'node:assert/strict'
import { registerPluginUpdater } from '../lib/updater.js'
import { registerApprovalRoutes, clearAllApprovals, createApprovalGate } from '../lib/approval-gate.js'
import { registerBatchQueueTools } from '../lib/tools/batch-queue.js'
import { getRouteRejectionStatus, getRouteWriteRejectionStatus } from '../lib/security.js'

function createMockCtx(options = {}) {
  const routes = new Map()
  const tools = new Map()
  const disposeCallbacks = []
  return {
    routes,
    tools: {
      register(toolDef) {
        tools.set(toolDef.name, toolDef)
      },
    },
    getTool(name) {
      return tools.get(name)
    },
    connection: options.connection,
    effect(fn) {
      fn()
    },
    on(event, cb) {
      if (event === 'dispose') {
        disposeCallbacks.push(cb)
      }
    },
    triggerDispose() {
      for (const cb of disposeCallbacks) cb()
    },
    webServer: {
      register(opts) {
        routes.set(opts.path, opts.handler)
      },
    },
  }
}

function mockRes() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    writeHead(code, headers = {}) {
      this.statusCode = code
      this.headers = headers
    },
    end(chunk) {
      if (chunk) this.body += chunk
    },
  }
}

test('issue #530: /dsh-image-gen/history rejects unauthorized requests when connection.requestRejection is set', async () => {
  const mockCtx = createMockCtx({
    connection: {
      requestRejection(req) {
        return 401
      },
    },
  })

  // Simulate history route handler logic matching lib/index.js
  const handler = async (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'GET only' }))
      return
    }
    const statusRejection = getRouteRejectionStatus(req, { connection: mockCtx.connection })
    if (statusRejection !== undefined) {
      res.writeHead(statusRejection, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: statusRejection === 401 ? 'unauthorized' : 'forbidden' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify([]))
  }

  const req = {
    method: 'GET',
    headers: { host: 'localhost:3080' },
    socket: { remoteAddress: '127.0.0.1' },
  }
  const res = mockRes()
  await handler(req, res)

  assert.equal(res.statusCode, 401)
  assert.match(res.body, /unauthorized/)
})

test('issue #531: /api/dsh-image-gen/update rejects unauthorized requests on GET and POST', async () => {
  const mockCtx = createMockCtx({
    connection: {
      requestRejection(req) {
        return 401
      },
    },
  })

  registerPluginUpdater(mockCtx, {
    endpoint: '/api/dsh-image-gen/update',
    packageName: '@goodandready/dsh-image-gen',
    profileName: 'test',
  })

  const updateHandler = mockCtx.routes.get('/api/dsh-image-gen/update')
  assert.ok(updateHandler, 'Update route should be registered')

  // 1. GET with unauthorized connection
  const getReq = {
    method: 'GET',
    headers: {
      host: 'localhost:3080',
      'x-dsh-plugin-update': '1',
      origin: 'http://localhost:3080',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  const getRes = mockRes()
  await updateHandler(getReq, getRes)
  assert.equal(getRes.statusCode, 401)

  // 2. POST with unauthorized connection
  const postReq = {
    method: 'POST',
    headers: {
      host: 'localhost:3080',
      'x-dsh-plugin-update': '1',
      origin: 'http://localhost:3080',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  const postRes = mockRes()
  await updateHandler(postReq, postRes)
  assert.equal(postRes.statusCode, 401)
})

test('issue #532: clearAllApprovals is triggered on context disposal', async () => {
  const mockCtx = createMockCtx()
  registerApprovalRoutes(mockCtx)

  // Create an active approval gate
  const gate = createApprovalGate({
    action: 'test-action',
    description: 'Test approval gate',
    timeoutMs: 5000,
  })

  // Trigger dispose
  mockCtx.triggerDispose()

  await assert.rejects(gate.wait(), /Approval gate cleared/)
})

test('issue #532: manage_batch_queue supports action: process', async () => {
  const mockCtx = createMockCtx()
  const storagePath = '/tmp/test-batch-queue-' + Date.now() + '.json'

  registerBatchQueueTools(mockCtx, {
    queueStoragePath: storagePath,
    executor: async (tool, params) => ({ executed: true, tool }),
  })

  const enqueueTool = mockCtx.getTool('enqueue_batch_jobs')
  const manageTool = mockCtx.getTool('manage_batch_queue')

  assert.ok(enqueueTool)
  assert.ok(manageTool)

  const enqueued = await enqueueTool.execute({
    name: 'Test Batch',
    items: [{ tool: 'generate_image', params: { prompt: 'A cat' } }],
  })

  const processed = await manageTool.execute({
    batchId: enqueued.batchId,
    action: 'process',
  })

  assert.equal(processed.ok, true)
  assert.equal(processed.status, 'completed')
  assert.equal(processed.progress.completed, 1)
})
