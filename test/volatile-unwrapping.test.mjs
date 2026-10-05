import test from 'node:test'
import assert from 'node:assert/strict'
import { plainConfig, isVolatileRef, ensureConfig } from '../lib/config-schema.js'
import { testProviderConnection, makeProviders } from '../lib/providers.js'
import { apply } from '../lib/index.js'

test('plainConfig (#417): deeply unwraps nested volatile boxes, arrays, and functions', () => {
  // 1. Nested object with volatile boxes
  const nested = {
    provider: { get: () => 'custom' },
    toolsets: {
      design: { get: () => true },
      processing: false,
      nestedBox: { get: () => ({ deeplyNested: { get: () => 'found' } }) },
    },
    items: [
      { get: () => 'first' },
      { id: 2, name: { get: () => 'second' } },
    ],
    lazyFn: () => 'from-fn',
  }

  const unwrapped = plainConfig(nested)
  assert.deepEqual(unwrapped, {
    provider: 'custom',
    toolsets: {
      design: true,
      processing: false,
      nestedBox: { deeplyNested: 'found' },
    },
    items: [
      'first',
      { id: 2, name: 'second' },
    ],
    lazyFn: 'from-fn',
  })

  // 2. Chained/double volatile box
  const doubleBox = {
    get: () => ({
      get: () => ({ value: 123 }),
    }),
  }
  assert.deepEqual(plainConfig(doubleBox), { value: 123 })

  // 3. Preserves buffers and dates
  const buf = Buffer.from('hello')
  const date = new Date()
  const objWithSpecial = {
    buf,
    date,
    volatileBuf: { get: () => buf },
  }
  const unwrappedSpecial = plainConfig(objWithSpecial)
  assert.equal(unwrappedSpecial.buf, buf)
  assert.equal(unwrappedSpecial.date, date)
  assert.equal(unwrappedSpecial.volatileBuf, buf)
})

test('testProviderConnection (#415, #416): unwraps volatile boxes in deps.cfg without falling back to fal', async () => {
  const volatileDeps = {
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    resolveKey: async () => 'test-gemini-key',
    cfg: {
      provider: { get: () => 'gemini' },
      geminiKeyEnv: { get: () => 'GEMINI_KEY' },
      pollIntervalMs: { get: () => 1500 },
      timeoutMs: { get: () => 90000 },
    },
  }

  const res = await testProviderConnection(volatileDeps, null)
  // Should have recognized gemini, not fal
  assert.equal(res.ok, true)
  assert.match(res.message, /Gemini/i)
})

test('makeProviders (#416): ensures cfg passed to provider backends is plain unwrapped', () => {
  const volatileDeps = {
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    resolveKey: async () => 'key',
    cfg: {
      provider: { get: () => 'fal' },
      pollIntervalMs: { get: () => 1000 },
      timeoutMs: { get: () => 50000 },
    },
  }

  const providers = makeProviders(volatileDeps, { prompt: 'test' })
  assert.ok(providers.fal)
})

test('diagnostics route (#415, #416): uses configured volatile provider and passes plain cfg', async () => {
  let registeredRoute = null
  const mockCtx = {
    inject: () => {},
    effect: (fn) => fn(),
    webServer: {
      register: (entry) => {
        if (entry?.path === '/dsh-image-gen/diagnostics/test') {
          registeredRoute = entry.handler
        }
        return () => {}
      },
      get: () => {},
      post: () => {},
      delete: () => {},
    },
    tools: { register: () => {} },
    commands: { register: () => {} },
    locale: { register: () => {} },
    on: () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }

  // Raw volatile config where provider is gemini
  const rawVolatile = {
    provider: { get: () => 'gemini' },
    geminiKeyEnv: { get: () => 'MOCK_GEMINI_KEY' },
    pollIntervalMs: { get: () => 800 },
    timeoutMs: { get: () => 60000 },
  }

  apply(mockCtx, rawVolatile)
  assert.ok(registeredRoute, 'Diagnostics route should be registered')

  // Invoke the route handler
  let responseData = null
  let statusCode = null
  const mockReq = {
    method: 'GET',
    url: '/dsh-image-gen/diagnostics/test',
    headers: { host: '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
  }
  const mockRes = {
    writeHead: (status) => { statusCode = status },
    end: (str) => { responseData = JSON.parse(str) },
  }

  await registeredRoute(mockReq, mockRes)
  assert.equal(statusCode, 200)
  assert.equal(responseData.provider, 'gemini', 'Must use configured provider gemini instead of falling back to fal')
})
