import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { registerSettingsRoutes } from '../lib/settings-route.js'

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
