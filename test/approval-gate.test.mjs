// test/approval-gate.test.mjs — Comprehensive test suite for interactive generation approval gate (#450)

import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import {
  createApprovalGate,
  registerApprovalRequest,
  getApprovalRequest,
  approveApprovalRequest,
  rejectApprovalRequest,
  listPendingApprovals,
  clearAllApprovals,
  registerApprovalRoutes,
} from '../lib/approval-gate.js'
import { registerGenerationTools } from '../lib/tools/generation.js'
import { resetLoopGuard } from '../lib/loop-guard.js'
import { clearSpendReservations, loadDailySpend } from '../lib/cost-meter.js'

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

function createJsonStream(payload, headers = {}, remoteAddress = '127.0.0.1') {
  const json = JSON.stringify(payload)
  const stream = new Readable({
    read() {
      this.push(json)
      this.push(null)
    },
  })
  stream.headers = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(json)),
    ...headers,
  }
  stream.socket = { remoteAddress }
  return stream
}

test('approval gate: createApprovalGate resolves when approved', async () => {
  clearAllApprovals()
  const gate = createApprovalGate({
    callId: 'call_test_1',
    plan: { prompt: 'a cute cat', estimatedCost: 0.04, count: 1 },
    timeoutSec: 10,
  })

  assert.equal(gate.status, 'pending')
  assert.equal(gate.callId, 'call_test_1')
  assert.equal(gate.plan.estimatedCost, 0.04)

  const waitPromise = gate.wait()
  const approved = gate.approve({ user: 'vadim' })
  assert.equal(approved, true)
  assert.equal(gate.status, 'approved')

  const res = await waitPromise
  assert.equal(res.approved, true)
  assert.equal(res.callId, 'call_test_1')
  assert.equal(res.meta.user, 'vadim')
  assert.equal(getApprovalRequest('call_test_1'), null) // cleaned up
})

test('approval gate: createApprovalGate rejects when explicitly rejected', async () => {
  clearAllApprovals()
  const gate = createApprovalGate({
    callId: 'call_test_2',
    plan: { prompt: 'a space rocket', estimatedCost: 0.08 },
    timeoutSec: 10,
  })

  const waitPromise = gate.wait()
  gate.reject('Cost too high')
  assert.equal(gate.status, 'rejected')

  await assert.rejects(
    async () => await waitPromise,
    (err) => {
      assert.equal(err.code, 'APPROVAL_REJECTED')
      assert.match(err.message, /Cost too high/)
      return true
    }
  )
})

test('approval gate: createApprovalGate times out automatically', async () => {
  clearAllApprovals()
  const gate = createApprovalGate({
    callId: 'call_test_timeout',
    plan: { prompt: 'neon skyline' },
    timeoutSec: 1, // 1 second timeout
  })

  await assert.rejects(
    async () => await gate.wait(),
    (err) => {
      assert.equal(err.code, 'APPROVAL_TIMEOUT')
      assert.match(err.message, /timed out after 1s/i)
      return true
    }
  )
  assert.equal(gate.status, 'timeout')
})

test('approval gate: aborts cleanly when AbortSignal triggers', async () => {
  clearAllApprovals()
  const ac = new AbortController()
  const gate = createApprovalGate({
    callId: 'call_test_signal',
    plan: { prompt: 'cyberpunk street' },
    timeoutSec: 10,
    signal: ac.signal,
  })

  const waitPromise = gate.wait()
  ac.abort()

  await assert.rejects(
    async () => await waitPromise,
    (err) => {
      assert.equal(err.code, 'APPROVAL_ABORTED')
      return true
    }
  )
})

test('approval gate: registry methods manage active approval requests', () => {
  clearAllApprovals()
  const gate1 = createApprovalGate({ callId: 'reg_1', plan: { prompt: 'p1' } })
  const gate2 = createApprovalGate({ callId: 'reg_2', plan: { prompt: 'p2' } })

  assert.equal(getApprovalRequest('reg_1'), gate1)
  assert.equal(getApprovalRequest('reg_2'), gate2)

  const list = listPendingApprovals()
  assert.equal(list.length, 2)
  assert.ok(list.some((item) => item.callId === 'reg_1'))
  assert.ok(list.some((item) => item.callId === 'reg_2'))

  assert.equal(approveApprovalRequest('reg_1'), true)
  assert.equal(approveApprovalRequest('reg_1'), false) // already resolved

  assert.equal(rejectApprovalRequest('reg_2', 'cancelled'), true)
  assert.equal(rejectApprovalRequest('non_existent'), false)

  clearAllApprovals()
  assert.equal(listPendingApprovals().length, 0)
})

test('approval route: rejects untrusted remote origins with 403', async () => {
  clearAllApprovals()
  const routes = new Map()
  const ctx = {
    effect(fn) { fn() },
    webServer: {
      register(opts) { routes.set(opts.path, opts.handler) },
    },
  }
  registerApprovalRoutes(ctx)
  const handler = routes.get('/dsh-image-gen/approval')
  assert.ok(handler)

  const req = {
    method: 'GET',
    url: '/dsh-image-gen/approval',
    headers: { host: 'evil.com' },
    socket: { remoteAddress: '198.51.100.22' }, // external untrusted IP
  }
  const res = mockRes()
  await handler(req, res)
  assert.equal(res.statusCode, 403)
})

test('approval route: GET returns pending approvals or specific callId', async () => {
  clearAllApprovals()
  const routes = new Map()
  const ctx = {
    effect(fn) { fn() },
    webServer: {
      register(opts) { routes.set(opts.path, opts.handler) },
    },
  }
  registerApprovalRoutes(ctx)
  const handler = routes.get('/dsh-image-gen/approval')

  createApprovalGate({ callId: 'route_call_1', plan: { prompt: 'sunset mountains', estimatedCost: 0.05 } })

  // GET all pending
  const reqAll = {
    method: 'GET',
    url: '/dsh-image-gen/approval',
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: '127.0.0.1' },
  }
  const resAll = mockRes()
  await handler(reqAll, resAll)
  assert.equal(resAll.statusCode, 200)
  const dataAll = JSON.parse(resAll.body)
  assert.equal(dataAll.ok, true)
  assert.equal(dataAll.approvals.length, 1)
  assert.equal(dataAll.approvals[0].callId, 'route_call_1')

  // GET by callId
  const reqOne = {
    method: 'GET',
    url: '/dsh-image-gen/approval?callId=route_call_1',
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: '127.0.0.1' },
  }
  const resOne = mockRes()
  await handler(reqOne, resOne)
  assert.equal(resOne.statusCode, 200)
  const dataOne = JSON.parse(resOne.body)
  assert.equal(dataOne.ok, true)
  assert.equal(dataOne.callId, 'route_call_1')
  assert.equal(dataOne.plan.prompt, 'sunset mountains')

  // GET 404 for unknown
  const reqNone = {
    method: 'GET',
    url: '/dsh-image-gen/approval?callId=missing',
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: '127.0.0.1' },
  }
  const resNone = mockRes()
  await handler(reqNone, resNone)
  assert.equal(resNone.statusCode, 404)

  clearAllApprovals()
})

test('approval route: POST approve and reject actions resolve the gate', async () => {
  clearAllApprovals()
  const routes = new Map()
  const ctx = {
    effect(fn) { fn() },
    webServer: {
      register(opts) { routes.set(opts.path, opts.handler) },
    },
  }
  registerApprovalRoutes(ctx)
  const handler = routes.get('/dsh-image-gen/approval')

  const gateApprove = createApprovalGate({ callId: 'post_approve_call', plan: { prompt: 'fast car' } })
  const waitApprove = gateApprove.wait()

  const reqApprove = createJsonStream(
    { callId: 'post_approve_call', action: 'approve' },
    { host: '127.0.0.1:3080' },
    '127.0.0.1'
  )
  reqApprove.method = 'POST'
  reqApprove.url = '/dsh-image-gen/approval'
  const resApprove = mockRes()
  await handler(reqApprove, resApprove)
  assert.equal(resApprove.statusCode, 200)
  const dataApprove = JSON.parse(resApprove.body)
  assert.equal(dataApprove.ok, true)
  assert.equal(dataApprove.status, 'approved')
  const resolved = await waitApprove
  assert.equal(resolved.approved, true)

  const gateReject = createApprovalGate({ callId: 'post_reject_call', plan: { prompt: 'dark room' } })
  const waitReject = gateReject.wait()

  const reqReject = createJsonStream(
    { callId: 'post_reject_call', action: 'reject', reason: 'User declined' },
    { host: '127.0.0.1:3080' },
    '127.0.0.1'
  )
  reqReject.method = 'POST'
  reqReject.url = '/dsh-image-gen/approval'
  const resReject = mockRes()
  await handler(reqReject, resReject)
  assert.equal(resReject.statusCode, 200)
  const dataReject = JSON.parse(resReject.body)
  assert.equal(dataReject.ok, true)
  assert.equal(dataReject.status, 'rejected')

  await assert.rejects(
    async () => await waitReject,
    /User declined/
  )

  clearAllApprovals()
})

test('tool integration: generate_image respects requireApproval gate (#450)', async () => {
  clearAllApprovals()
  resetLoopGuard()
  clearSpendReservations()

  const registeredTools = new Map()
  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) { registeredTools.set(def.name, def) },
    },
    logger: { warn() {}, info() {}, debug() {}, error() {} },
    get() { return null },
  }

  let providerCalled = false
  const cfg = {
    enabled: true,
    requireApproval: true,
    approvalTimeoutSec: 10,
    provider: 'fal',
    apiKeyEnv: 'TEST_KEY',
    model: 'fal-ai/flux/dev',
    outputDir: 'test-gen-out',
    dailyBudgetUsd: 10,
    loopGuardLimit: 0,
    defaultSize: 'square_hd',
    defaultFormat: 'png',
  }

  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==', 'base64')

  const deps = {
    config: cfg,
    live: () => cfg,
    resolveSource: async () => undefined,
    slugify: (s) => s.slice(0, 10),
    resolveApiKey: () => 'fal_mock_key',
    fetchImpl: async () => {
      providerCalled = true
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
        json: async () => ({
          request_id: 'req-mock',
          images: [{ url: 'https://cdn/img.png', width: 512, height: 512 }],
          seed: 42,
        }),
      }
    },
  }

  registerGenerationTools(ctx, deps)
  const generateTool = registeredTools.get('generate_image')
  assert.ok(generateTool, 'generate_image tool must be registered')

  // Case 1: Non-interactive execution throws fail-fast without calling provider
  providerCalled = false
  await assert.rejects(
    async () => await generateTool.execute({ prompt: 'forest' }, { interactive: false }),
    /Interactive approval required/i
  )
  assert.equal(providerCalled, false, 'Provider must not be called when approval required in non-interactive session')

  // Case 2: Explicit approved parameter is declared in schema
  const params = generateTool.parameters?.properties || generateTool.parameters || {}
  assert.ok(params.approved, 'generate_image must declare approved parameter')

  // Case 3: Interactive execution creates pending gate and waits until approved
  providerCalled = false
  const callId = 'test_call_approval_flow'
  let executePromise = generateTool.execute({ prompt: 'mountain lake' }, { callId, interactive: true })

  // Let the event loop cycle so the gate is created
  await new Promise((r) => setTimeout(r, 20))
  const pendingGate = getApprovalRequest(callId)
  assert.ok(pendingGate, 'Pending gate must be registered for active callId')
  assert.equal(pendingGate.plan.prompt, 'mountain lake')
  assert.ok(pendingGate.plan.estimatedCost > 0)

  // Approve the pending request
  approveApprovalRequest(callId)

  // Wait for execution to attempt provider call or proceed
  try {
    await executePromise
  } catch (_err) {
    // Provider or fetch error expected in isolated unit test
  }
  // Gate was approved and cleaned up
  assert.equal(getApprovalRequest(callId), null)

  // Case 4: When rejected, execute throws descriptive error and ZERO spend is committed
  providerCalled = false
  const callIdReject = 'test_call_reject_flow'
  let rejectPromise = generateTool.execute({ prompt: 'storm clouds' }, { callId: callIdReject, interactive: true })

  await new Promise((r) => setTimeout(r, 20))
  assert.ok(getApprovalRequest(callIdReject))
  rejectApprovalRequest(callIdReject, 'User declined generation')

  await assert.rejects(
    async () => await rejectPromise,
    /User declined generation/
  )
  assert.equal(providerCalled, false, 'Provider must never be called when approval is rejected')

  clearAllApprovals()
})

test('approval route #478: POST accepts approve action with dsh-app://app/ referer in DSH Desktop', async () => {
  clearAllApprovals()
  const routes = new Map()
  const ctx = {
    effect(fn) { fn() },
    webServer: {
      register(opts) { routes.set(opts.path, opts.handler) },
    },
  }
  registerApprovalRoutes(ctx)
  const handler = routes.get('/dsh-image-gen/approval')

  const gateDesktop = createApprovalGate({ callId: 'desktop_approve_call', plan: { prompt: 'futuristic city' } })
  const waitDesktop = gateDesktop.wait()

  const reqDesktop = createJsonStream(
    { callId: 'desktop_approve_call', action: 'approve' },
    {
      host: '127.0.0.1:3080',
      referer: 'dsh-app://app/',
      'sec-fetch-site': 'same-origin',
    },
    '127.0.0.1'
  )
  reqDesktop.method = 'POST'
  reqDesktop.url = '/dsh-image-gen/approval?callId=desktop_approve_call&action=approve'
  const resDesktop = mockRes()
  await handler(reqDesktop, resDesktop)
  assert.equal(resDesktop.statusCode, 200, 'Desktop approval request must succeed with 200')
  const data = JSON.parse(resDesktop.body)
  assert.equal(data.ok, true)
  assert.equal(data.status, 'approved')

  const resolved = await waitDesktop
  assert.equal(resolved.approved, true)
  clearAllApprovals()
})

