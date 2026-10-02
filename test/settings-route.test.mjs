import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { registerSettingsRoutes } from '../lib/settings-route.js'
import { createSettingsAdapter } from '../lib/index.js'

function createMockCtx() {
  const routes = new Map()
  return {
    routes,
    effect(fn) {
      fn()
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

test('settings-route: GET /dsh-image-gen/status returns 200 with status info', async () => {
  const ctx = createMockCtx()
  registerSettingsRoutes(ctx, {
    live: () => ({ enabled: true, provider: 'fal' }),
    getSettingsApi: () => null,
    setLiveConfig: () => {},
  })

  const handler = ctx.routes.get('/dsh-image-gen/status')
  assert.ok(handler, 'status handler registered')

  const req = {
    method: 'GET',
    headers: { host: '127.0.0.1:3000' },
    socket: { remoteAddress: '127.0.0.1' },
  }
  const res = mockRes()
  await handler(req, res)

  assert.equal(res.statusCode, 200)
  const data = JSON.parse(res.body)
  assert.equal(data.ok, true)
  assert.equal(data.provider, 'fal')
})

test('settings-route: PUT /dsh-image-gen/config rejects oversized body with 413', async () => {
  const ctx = createMockCtx()
  registerSettingsRoutes(ctx, {
    live: () => ({ enabled: true }),
    getSettingsApi: () => null,
    setLiveConfig: () => {},
  })

  const handler = ctx.routes.get('/dsh-image-gen/config')
  assert.ok(handler, 'config handler registered')

  // Create stream > 64 KB
  const bigChunk = 'x'.repeat(70 * 1024)
  const stream = Readable.from([bigChunk])
  stream.method = 'PUT'
  stream.headers = { host: '127.0.0.1:3000', 'content-length': String(bigChunk.length) }
  stream.socket = { remoteAddress: '127.0.0.1' }

  const res = mockRes()
  await handler(stream, res)

  assert.equal(res.statusCode, 413)
  const data = JSON.parse(res.body)
  assert.equal(data.ok, false)
  assert.ok(data.error.includes('Payload Too Large'))
})

test('settings-route: PUT /dsh-image-gen/config updates valid settings', async () => {
  let updatedConfig = null
  const ctx = createMockCtx()
  registerSettingsRoutes(ctx, {
    live: () => ({ enabled: true, provider: 'fal' }),
    getSettingsApi: () => null,
    setLiveConfig: (c) => { updatedConfig = c },
  })

  const handler = ctx.routes.get('/dsh-image-gen/config')
  const payload = JSON.stringify({ config: { defaultSize: 'square_1_1' } })
  const stream = Readable.from([payload])
  stream.method = 'PUT'
  stream.headers = { host: '127.0.0.1:3000', 'content-length': String(payload.length) }
  stream.socket = { remoteAddress: '127.0.0.1' }

  const res = mockRes()
  await handler(stream, res)

  assert.equal(res.statusCode, 200)
  const data = JSON.parse(res.body)
  assert.equal(data.ok, true)
  assert.equal(data.config.defaultSize, 'square_1_1')
  assert.equal(updatedConfig?.defaultSize, 'square_1_1')
})

test('createSettingsAdapter: failed persist does not mutate live config (#368)', async () => {
  let liveCfg = { provider: 'custom', enabled: true }
  const mockSvc = {
    replace: async () => {
      throw new Error('audit persistence failure')
    },
  }
  const adapter = createSettingsAdapter(mockSvc, {
    ns: 'dsh-image-gen',
    getLive: () => liveCfg,
    setLive: (c) => { liveCfg = c },
  })

  await assert.rejects(
    async () => {
      await adapter.replace({ provider: 'local' })
    },
    /audit persistence failure/
  )
  assert.equal(liveCfg.provider, 'custom', 'live config must not change on replace failure')

  mockSvc.update = async () => {
    throw new Error('update failure')
  }
  await assert.rejects(
    async () => {
      await adapter.update({ provider: 'local' })
    },
    /update failure/
  )
  assert.equal(liveCfg.provider, 'custom', 'live config must not change on update failure')
})

test('createSettingsAdapter: successful persist mutates live config (#368)', async () => {
  let liveCfg = { provider: 'custom', enabled: true }
  let persistedPayload = null
  const mockSvc = {
    replace: async (ns, payload) => {
      persistedPayload = payload
    },
  }
  const adapter = createSettingsAdapter(mockSvc, {
    ns: 'dsh-image-gen',
    getLive: () => liveCfg,
    setLive: (c) => { liveCfg = c },
  })

  const res = await adapter.replace({ provider: 'local' })
  assert.equal(res.provider, 'local')
  assert.equal(liveCfg.provider, 'local', 'live config updated after successful persist')
  assert.equal(persistedPayload.provider, 'local')
})

test('settings-route: PUT failure does not mutate live config or trigger setLiveConfig (#368)', async () => {
  let liveCfg = { enabled: true, provider: 'custom' }
  let setLiveCalled = false
  const mockSettingsApi = {
    replace: async () => {
      throw new Error('audit persistence failure')
    },
  }
  const ctx = createMockCtx()
  registerSettingsRoutes(ctx, {
    live: () => liveCfg,
    getSettingsApi: () => mockSettingsApi,
    setLiveConfig: (c) => {
      setLiveCalled = true
      liveCfg = c
    },
  })

  const handler = ctx.routes.get('/dsh-image-gen/config')
  const payload = JSON.stringify({ config: { provider: 'local' } })
  const stream = Readable.from([payload])
  stream.method = 'PUT'
  stream.headers = { host: '127.0.0.1:3000', 'content-length': String(payload.length) }
  stream.socket = { remoteAddress: '127.0.0.1' }

  const res = mockRes()
  await handler(stream, res)

  assert.equal(res.statusCode, 400)
  const data = JSON.parse(res.body)
  assert.equal(data.ok, false)
  assert.ok(data.error.includes('audit persistence failure'))
  assert.equal(setLiveCalled, false, 'setLiveConfig must not be called')
  assert.equal(liveCfg.provider, 'custom', 'liveCfg must remain intact')
})

test('settings-route: PUT with resetFields removes override and restores schema default (#367)', async () => {
  let liveCfg = { enabled: true, stylePreset: 'cinematic', provider: 'fal' }
  const ctx = createMockCtx()
  registerSettingsRoutes(ctx, {
    live: () => liveCfg,
    getSettingsApi: () => null,
    setLiveConfig: (c) => { liveCfg = c },
  })

  const handler = ctx.routes.get('/dsh-image-gen/config')
  const payload = JSON.stringify({ resetFields: ['stylePreset'] })
  const stream = Readable.from([payload])
  stream.method = 'PUT'
  stream.headers = { host: '127.0.0.1:3000', 'content-length': String(payload.length) }
  stream.socket = { remoteAddress: '127.0.0.1' }

  const res = mockRes()
  await handler(stream, res)

  assert.equal(res.statusCode, 200)
  const data = JSON.parse(res.body)
  assert.equal(data.ok, true)
  assert.equal(data.config.stylePreset, 'none', 'schema default is restored in response')
  assert.equal(liveCfg.stylePreset, 'none', 'schema default is restored in liveCfg')
})

test('settings-route: PUT with null field resets it to schema default (#367)', async () => {
  let liveCfg = { enabled: true, stylePreset: 'anime', provider: 'fal' }
  const ctx = createMockCtx()
  registerSettingsRoutes(ctx, {
    live: () => liveCfg,
    getSettingsApi: () => null,
    setLiveConfig: (c) => { liveCfg = c },
  })

  const handler = ctx.routes.get('/dsh-image-gen/config')
  const payload = JSON.stringify({ stylePreset: null })
  const stream = Readable.from([payload])
  stream.method = 'PUT'
  stream.headers = { host: '127.0.0.1:3000', 'content-length': String(payload.length) }
  stream.socket = { remoteAddress: '127.0.0.1' }

  const res = mockRes()
  await handler(stream, res)

  assert.equal(res.statusCode, 200)
  const data = JSON.parse(res.body)
  assert.equal(data.ok, true)
  assert.equal(data.config.stylePreset, 'none', 'null resets to default')
  assert.equal(liveCfg.stylePreset, 'none')
})

test('createSettingsAdapter: delete removes override and restores schema default (#367)', async () => {
  let liveCfg = { provider: 'fal', stylePreset: 'cinematic', enabled: true }
  let persisted = null
  const mockSvc = {
    replace: async (ns, payload) => {
      persisted = payload
    },
  }
  const adapter = createSettingsAdapter(mockSvc, {
    ns: 'dsh-image-gen',
    getLive: () => liveCfg,
    setLive: (c) => { liveCfg = c },
  })

  const res = await adapter.delete('stylePreset')
  assert.equal(res.stylePreset, 'none', 'deleted field reset to default')
  assert.equal(liveCfg.stylePreset, 'none', 'live config updated')
  assert.equal(persisted.stylePreset, 'none', 'persisted with default')
})
