import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { registerSettingsRoutes } from '../lib/settings-route.js'
import { registerVaultRoutes } from '../lib/vault.js'
import {
  isTrustedLocalRequest,
  getRouteRejectionStatus,
  getRouteWriteRejectionStatus,
  validateProviderBaseUrl,
  getClientIp,
  isTrustedHost,
} from '../lib/security.js'

function createMockCtx(options = {}) {
  const routes = new Map()
  return {
    routes,
    connection: options.connection,
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

function createJsonStream(payload, headers = {}, remoteAddress = '127.0.0.1') {
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const stream = Readable.from([str])
  stream.method = 'PUT'
  stream.headers = {
    host: 'localhost:3000',
    origin: 'http://localhost:3000',
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(str)),
    ...headers,
  }
  stream.socket = { remoteAddress }
  return stream
}

test('security #474: unauthenticated remote LAN client is rejected on config routes (fail-closed)', async () => {
  const ctx = createMockCtx() // No connection service
  registerSettingsRoutes(ctx, {
    live: () => ({ enabled: true, provider: 'fal' }),
    getSettingsApi: () => null,
    setLiveConfig: () => {},
  })

  const getHandler = ctx.routes.get('/dsh-image-gen/config')
  assert.ok(getHandler)

  // Unauthenticated LAN client attempting GET /dsh-image-gen/config
  const lanGetReq = {
    method: 'GET',
    headers: { host: '192.168.1.111:3000', origin: 'http://192.168.1.111:3000', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '192.168.1.50' },
  }
  const getRes = mockRes()
  await getHandler(lanGetReq, getRes)
  assert.equal(getRes.statusCode, 403, 'LAN GET config without connection session must be 403')

  // Unauthenticated LAN client attempting PUT /dsh-image-gen/config
  const putStream = createJsonStream(
    { config: { baseURL: 'http://attacker.com' } },
    { host: '192.168.1.111:3000', origin: 'http://192.168.1.111:3000', 'sec-fetch-site': 'same-origin' },
    '192.168.1.50'
  )
  const putRes = mockRes()
  await getHandler(putStream, putRes)
  assert.equal(putRes.statusCode, 403, 'LAN PUT config without connection session must be 403')
})

test('security #474: unauthenticated remote LAN client is rejected on vault routes', async () => {
  const ctx = createMockCtx()
  registerVaultRoutes(ctx)

  const vaultHandler = ctx.routes.get('/dsh-image-gen/vault')
  assert.ok(vaultHandler)

  // Unauthenticated LAN GET /vault
  const lanGetReq = {
    method: 'GET',
    url: '/dsh-image-gen/vault',
    headers: { host: '192.168.1.111:3000', origin: 'http://192.168.1.111:3000', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '192.168.1.50' },
  }
  const getRes = mockRes()
  await vaultHandler(lanGetReq, getRes)
  assert.equal(getRes.statusCode, 403, 'LAN GET vault without connection session must be 403')

  // Unauthenticated LAN DELETE /vault
  const lanDelReq = {
    method: 'DELETE',
    url: '/dsh-image-gen/vault?id=test-entry-1',
    headers: { host: '192.168.1.111:3000', origin: 'http://192.168.1.111:3000', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '192.168.1.50' },
  }
  const delRes = mockRes()
  await vaultHandler(lanDelReq, delRes)
  assert.equal(delRes.statusCode, 403, 'LAN DELETE vault without connection session must be 403')
})

test('security #474: missing or unknown remoteAddress fails closed with 403', async () => {
  const ctx = createMockCtx()
  registerSettingsRoutes(ctx, {
    live: () => ({ enabled: true }),
    getSettingsApi: () => null,
    setLiveConfig: () => {},
  })

  const handler = ctx.routes.get('/dsh-image-gen/config')

  // Socket present but remoteAddress is empty string
  const emptyAddrReq = {
    method: 'GET',
    headers: { host: 'localhost:3000' },
    socket: { remoteAddress: '' },
  }
  const res1 = mockRes()
  await handler(emptyAddrReq, res1)
  assert.equal(res1.statusCode, 403, 'Empty remoteAddress must be rejected')

  // Socket present but remoteAddress is undefined
  const undefAddrReq = {
    method: 'GET',
    headers: { host: 'localhost:3000' },
    socket: {},
  }
  const res2 = mockRes()
  await handler(undefAddrReq, res2)
  assert.equal(res2.statusCode, 403, 'Undefined remoteAddress must be rejected')
})

test('security #474: connection.requestRejection gates authenticated DSH sessions', async () => {
  // Case A: Connection service rejects with 401 Unauthorized
  const unauthCtx = createMockCtx({
    connection: { requestRejection: () => 401 },
  })
  registerSettingsRoutes(unauthCtx, {
    live: () => ({ enabled: true }),
    getSettingsApi: () => null,
    setLiveConfig: () => {},
  })
  const unauthHandler = unauthCtx.routes.get('/dsh-image-gen/config')

  const reqA = {
    method: 'GET',
    headers: { host: '192.168.1.111:3000', origin: 'http://192.168.1.111:3000', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '192.168.1.50' },
  }
  const resA = mockRes()
  await unauthHandler(reqA, resA)
  assert.equal(resA.statusCode, 401, 'Should return 401 when connection rejects with 401')

  // Case B: Connection service admits authenticated session (returns undefined)
  let savedConfig = null
  const authCtx = createMockCtx({
    connection: { requestRejection: () => undefined },
  })
  registerSettingsRoutes(authCtx, {
    live: () => ({ enabled: true, defaultSize: 'square' }),
    getSettingsApi: () => null,
    setLiveConfig: (c) => { savedConfig = c },
  })
  const authHandler = authCtx.routes.get('/dsh-image-gen/config')

  const getResB = mockRes()
  await authHandler(reqA, getResB)
  assert.equal(getResB.statusCode, 200, 'Authenticated session from LAN should return 200')

  const putStreamB = createJsonStream(
    { config: { defaultSize: 'square_hd' } },
    { host: '192.168.1.111:3000', origin: 'http://192.168.1.111:3000', 'sec-fetch-site': 'same-origin' },
    '192.168.1.50'
  )
  const putResB = mockRes()
  await authHandler(putStreamB, putResB)
  assert.equal(putResB.statusCode, 200, 'Authenticated session PUT should return 200')
  assert.equal(savedConfig?.defaultSize, 'square_hd')
})

test('security #474: cross-site requests are strictly rejected with 403', async () => {
  const ctx = createMockCtx({
    connection: { requestRejection: () => undefined },
  })
  registerSettingsRoutes(ctx, {
    live: () => ({ enabled: true }),
    getSettingsApi: () => null,
    setLiveConfig: () => {},
  })
  const handler = ctx.routes.get('/dsh-image-gen/config')

  const crossSiteReq = {
    method: 'GET',
    headers: {
      host: 'localhost:3000',
      'sec-fetch-site': 'cross-site',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  const res = mockRes()
  await handler(crossSiteReq, res)
  assert.equal(res.statusCode, 403, 'Cross-site request must be 403')
})

test('security #474: SSRF prevention in PUT /dsh-image-gen/config', async () => {
  let liveCfg = { enabled: true, allowCustomBaseUrl: false }
  const ctx = createMockCtx()
  registerSettingsRoutes(ctx, {
    live: () => liveCfg,
    getSettingsApi: () => null,
    setLiveConfig: (c) => { liveCfg = c },
  })
  const handler = ctx.routes.get('/dsh-image-gen/config')

  // Attack 1: baseURL pointed to arbitrary external attacker server
  const stream1 = createJsonStream({ config: { baseURL: 'http://attacker-controlled.com' } })
  const res1 = mockRes()
  await handler(stream1, res1)
  assert.equal(res1.statusCode, 400, 'Arbitrary baseURL must return 400 Bad Request')
  assert.ok(JSON.parse(res1.body).error.includes('official FAL domain'))

  // Attack 2: customBaseURL pointed to arbitrary external attacker server without allowCustomBaseUrl
  const stream2 = createJsonStream({ config: { customBaseURL: 'https://evil-proxy.org/v1' } })
  const res2 = mockRes()
  await handler(stream2, res2)
  assert.equal(res2.statusCode, 400, 'Unallowlisted customBaseURL must return 400 Bad Request')
  assert.ok(JSON.parse(res2.body).error.includes('not in trusted AI provider allowlist'))

  // Attack 3: Cloud metadata endpoint exfiltration attempt (169.254.169.254)
  const stream3 = createJsonStream({
    config: {
      allowCustomBaseUrl: true,
      customBaseURL: 'http://169.254.169.254/latest/meta-data',
    },
  })
  const res3 = mockRes()
  await handler(stream3, res3)
  assert.equal(res3.statusCode, 400, 'Targeting 169.254.169.254 must be blocked even if allowCustomBaseUrl is true')
  assert.ok(JSON.parse(res3.body).error.includes('cloud metadata'))

  // Attack 4: Dangerous protocol smuggling (file:, gopher:)
  const stream4 = createJsonStream({ config: { customBaseURL: 'file:///etc/shadow' } })
  const res4 = mockRes()
  await handler(stream4, res4)
  assert.equal(res4.statusCode, 400, 'file:// protocol must return 400 Bad Request')
  assert.ok(JSON.parse(res4.body).error.includes('unsafe protocol'))

  // Attack 5: Embedded credentials in URL authority
  const stream5 = createJsonStream({ config: { customBaseURL: 'https://user:password@api.openai.com/v1' } })
  const res5 = mockRes()
  await handler(stream5, res5)
  assert.equal(res5.statusCode, 400, 'Embedded credentials in URL authority must return 400 Bad Request')
  assert.ok(JSON.parse(res5.body).error.includes('embedded credentials'))

  // Legitimate Case 1: Official OpenAI endpoint passes
  const stream6 = createJsonStream({ config: { customBaseURL: 'https://api.openai.com/v1' } })
  const res6 = mockRes()
  await handler(stream6, res6)
  assert.equal(res6.statusCode, 200, 'https://api.openai.com/v1 must be accepted')

  // Legitimate Case 2: Local Ollama / vLLM on loopback passes
  const stream7 = createJsonStream({ config: { customBaseURL: 'http://127.0.0.1:11434/v1' } })
  const res7 = mockRes()
  await handler(stream7, res7)
  assert.equal(res7.statusCode, 200, 'Loopback customBaseURL must be accepted')

  // Legitimate Case 3: Custom external endpoint allowed when allowCustomBaseUrl: true
  const stream8 = createJsonStream({
    config: {
      allowCustomBaseUrl: true,
      customBaseURL: 'https://self-hosted-llm.example.org/v1',
    },
  })
  const res8 = mockRes()
  await handler(stream8, res8)
  assert.equal(res8.statusCode, 200, 'Custom endpoint with allowCustomBaseUrl: true must be accepted')
  assert.equal(liveCfg.allowCustomBaseUrl, true)
  assert.equal(liveCfg.customBaseURL, 'https://self-hosted-llm.example.org/v1')
})

test('security #474: validateProviderBaseUrl unit tests', () => {
  // baseURL validation
  assert.equal(validateProviderBaseUrl('baseURL', 'https://queue.fal.run'), 'https://queue.fal.run')
  assert.equal(validateProviderBaseUrl('baseURL', 'https://fal.ai/api'), 'https://fal.ai/api')
  assert.equal(validateProviderBaseUrl('baseURL', 'http://127.0.0.1:9999'), 'http://127.0.0.1:9999')
  assert.throws(
    () => validateProviderBaseUrl('baseURL', 'http://attacker.com'),
    /official FAL domain/
  )
  assert.equal(
    validateProviderBaseUrl('baseURL', 'http://custom-fal-mirror.internal', { allowCustomBaseUrl: true }),
    'http://custom-fal-mirror.internal'
  )

  // customBaseURL validation
  assert.equal(validateProviderBaseUrl('customBaseURL', 'https://api.openai.com/v1'), 'https://api.openai.com/v1')
  assert.equal(validateProviderBaseUrl('customBaseURL', 'https://api.groq.com/openai/v1'), 'https://api.groq.com/openai/v1')
  assert.equal(validateProviderBaseUrl('customBaseURL', 'https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1')
  assert.equal(validateProviderBaseUrl('customBaseURL', 'https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1')
  assert.equal(validateProviderBaseUrl('customBaseURL', 'http://192.168.1.100:11434/v1'), 'http://192.168.1.100:11434/v1')
  assert.throws(
    () => validateProviderBaseUrl('customBaseURL', 'https://unauthorized-ai.io/v1'),
    /not in trusted AI provider allowlist/
  )

  // localBaseURL validation
  assert.equal(validateProviderBaseUrl('localBaseURL', 'http://127.0.0.1:8188'), 'http://127.0.0.1:8188')
  assert.equal(validateProviderBaseUrl('localBaseURL', 'http://192.168.1.200:7860'), 'http://192.168.1.200:7860')
  assert.throws(
    () => validateProviderBaseUrl('localBaseURL', 'http://93.184.216.34:8188'),
    /must target loopback or private LAN/
  )

  // Metadata address blocking
  assert.throws(
    () => validateProviderBaseUrl('customBaseURL', 'http://169.254.169.254', { allowCustomBaseUrl: true }),
    /forbidden from targeting cloud metadata/
  )
  assert.throws(
    () => validateProviderBaseUrl('customBaseURL', 'http://metadata.google.internal', { allowCustomBaseUrl: true }),
    /forbidden from targeting cloud metadata/
  )
})

test('security #474: helpers getClientIp and isTrustedHost', () => {
  assert.equal(getClientIp(null), '')
  assert.equal(getClientIp({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), '127.0.0.1')
  assert.equal(getClientIp({ socket: { remoteAddress: '192.168.1.55' } }), '192.168.1.55')
  assert.equal(getClientIp({ connection: { remoteAddress: '::1' } }), '::1')

  assert.equal(isTrustedHost('localhost:3000'), true)
  assert.equal(isTrustedHost('127.0.0.1:3000'), true)
  assert.equal(isTrustedHost('192.168.1.111:3080'), true)
  assert.equal(isTrustedHost('10.0.0.5:80'), true)
  assert.equal(isTrustedHost('evil.com'), false)
  assert.equal(isTrustedHost('10.evil.com'), false)
  assert.equal(isTrustedHost('127.0.0.1.nip.io'), false)
})

test('security #478: isTrustedLocalRequest accepts dsh-app://app scheme on loopback', () => {
  // Loopback with dsh-app://app/ referer (Desktop Electron)
  const reqDesktopReferer = {
    method: 'GET',
    headers: {
      host: '127.0.0.1:3080',
      referer: 'dsh-app://app/',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(isTrustedLocalRequest(reqDesktopReferer), true)

  // Loopback with dsh-app://app origin
  const reqDesktopOrigin = {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3080',
      origin: 'dsh-app://app',
    },
    socket: { remoteAddress: '::1' },
  }
  assert.equal(isTrustedLocalRequest(reqDesktopOrigin), true)

  // Synthetic loopback mock (no socket, loopback host)
  const reqSynthetic = {
    method: 'GET',
    headers: {
      host: 'localhost:3080',
      referer: 'dsh-app://app/index.html',
    },
  }
  assert.equal(isTrustedLocalRequest(reqSynthetic), true)

  // Forged dsh-app scheme from non-loopback LAN address must be REJECTED
  const reqForgedLan = {
    method: 'GET',
    headers: {
      host: '192.168.1.111:3080',
      referer: 'dsh-app://app/',
    },
    socket: { remoteAddress: '192.168.1.50' },
  }
  assert.equal(isTrustedLocalRequest(reqForgedLan), false)

  // Spoofed host in dsh-app scheme must be REJECTED
  const reqSpoofedHost = {
    method: 'GET',
    headers: {
      host: '127.0.0.1:3080',
      referer: 'dsh-app://evil.com/',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(isTrustedLocalRequest(reqSpoofedHost), false)

  // Spoofed origin host in dsh-app scheme must be REJECTED
  const reqSpoofedOrigin = {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3080',
      origin: 'dsh-app://malicious.app',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(isTrustedLocalRequest(reqSpoofedOrigin), false)

  // Unknown custom scheme must be REJECTED
  const reqUnknownScheme = {
    method: 'GET',
    headers: {
      host: '127.0.0.1:3080',
      referer: 'custom-scheme://app/',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(isTrustedLocalRequest(reqUnknownScheme), false)
})

test('security #478: route rejection gates pass dsh-app://app on loopback and reject forged requests', () => {
  // getRouteRejectionStatus on loopback
  const reqReadDesktop = {
    method: 'GET',
    headers: {
      host: '127.0.0.1:3080',
      referer: 'dsh-app://app/',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(getRouteRejectionStatus(reqReadDesktop), undefined)

  const reqReadOrigin = {
    method: 'GET',
    headers: {
      host: 'localhost:3080',
      origin: 'dsh-app://app',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(getRouteRejectionStatus(reqReadOrigin), undefined)

  // getRouteWriteRejectionStatus on loopback
  const reqWriteDesktop = {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3080',
      origin: 'dsh-app://app',
      'sec-fetch-site': 'same-origin',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(getRouteWriteRejectionStatus(reqWriteDesktop), undefined)

  // Spoofed origin or referer gives 403
  const reqBadOrigin = {
    method: 'GET',
    headers: {
      host: '127.0.0.1:3080',
      origin: 'dsh-app://untrusted.host',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(getRouteRejectionStatus(reqBadOrigin), 403)

  const reqBadReferer = {
    method: 'GET',
    headers: {
      host: '127.0.0.1:3080',
      referer: 'dsh-app://untrusted.host/',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(getRouteRejectionStatus(reqBadReferer), 403)
})

test('security #478: vault and config routes allow loopback requests with dsh-app://app referer', async () => {
  const ctx = createMockCtx()
  registerVaultRoutes(ctx, { storageService: null })
  registerSettingsRoutes(ctx, { live: () => ({}), getSettingsApi: () => ({}), setLiveConfig: () => {} })

  const vaultHandler = ctx.routes.get('/dsh-image-gen/vault')
  assert.equal(typeof vaultHandler, 'function')

  // Request to vault with dsh-app://app/ referer
  const reqVault = {
    method: 'GET',
    url: '/dsh-image-gen/vault?limit=10',
    headers: {
      host: '127.0.0.1:3080',
      referer: 'dsh-app://app/',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  const resVault = mockRes()
  await vaultHandler(reqVault, resVault)
  // Should NOT be 403 Forbidden!
  assert.notEqual(resVault.statusCode, 403, 'Vault request with dsh-app://app/ must not be rejected with 403')
  assert.equal(resVault.statusCode, 200)

  // Request to config route with dsh-app://app/ referer
  const configHandler = ctx.routes.get('/dsh-image-gen/config')
  assert.equal(typeof configHandler, 'function')
  const reqConfig = {
    method: 'GET',
    url: '/dsh-image-gen/config',
    headers: {
      host: '127.0.0.1:3080',
      referer: 'dsh-app://app/',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  const resConfig = mockRes()
  await configHandler(reqConfig, resConfig)
  assert.notEqual(resConfig.statusCode, 403, 'Config request with dsh-app://app/ must not be rejected with 403')
  assert.equal(resConfig.statusCode, 200)
})


test('security #482: write requests without Origin or Referer are rejected with 403 (even on loopback)', async () => {
  const ctx = createMockCtx()
  registerSettingsRoutes(ctx, {
    live: () => ({ enabled: true, provider: 'fal' }),
    getSettingsApi: () => null,
    setLiveConfig: () => {},
  })
  const handler = ctx.routes.get('/dsh-image-gen/config')

  // Loopback write request without Origin or Referer (e.g. via dsh-lanmode bridge)
  const reqWithoutOrigin = Readable.from([JSON.stringify({ config: { defaultSize: 'square_1_1' } })])
  reqWithoutOrigin.method = 'PUT'
  reqWithoutOrigin.headers = {
    host: '127.0.0.1:3080',
    'content-type': 'application/json',
  }
  reqWithoutOrigin.socket = { remoteAddress: '127.0.0.1' }

  const res = mockRes()
  await handler(reqWithoutOrigin, res)
  assert.equal(res.statusCode, 403, 'Write request lacking Origin/Referer must receive 403 Forbidden')
})
