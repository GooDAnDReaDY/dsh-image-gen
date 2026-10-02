// test/diagnostics-audit-377.test.mjs — Comprehensive regression test suite for Provider Diagnostics (#377)

import test from 'node:test'
import assert from 'node:assert/strict'
import { testProviderConnection } from '../lib/providers.js'

test('diagnostics (#377): offline providers return state: offline without throwing or false ok', async () => {
  const offlineFetch = async () => {
    const err = new Error('ECONNREFUSED 127.0.0.1:8188')
    err.code = 'ECONNREFUSED'
    throw err
  }

  // 1. local (defaults to comfyui)
  const localRes = await testProviderConnection({
    fetchImpl: offlineFetch,
    resolveKey: async () => 'key',
    cfg: { localBaseURL: 'http://127.0.0.1:8188' },
  }, 'local')
  assert.equal(localRes.ok, false)
  assert.equal(localRes.state, 'offline')
  assert.match(localRes.message, /ComfyUI offline/)

  // 2. a1111
  const a1111Res = await testProviderConnection({
    fetchImpl: offlineFetch,
    resolveKey: async () => 'key',
    cfg: { a1111Url: 'http://127.0.0.1:7860' },
  }, 'a1111')
  assert.equal(a1111Res.ok, false)
  assert.equal(a1111Res.state, 'offline')
  assert.match(a1111Res.message, /Automatic1111 offline/)

  // 3. seedream offline
  const seedreamRes = await testProviderConnection({
    fetchImpl: offlineFetch,
    resolveKey: async () => 'sd-key',
    cfg: { seedreamBaseURL: 'https://api.seedream.fake' },
  }, 'seedream')
  assert.equal(seedreamRes.ok, false)
  assert.equal(seedreamRes.state, 'offline')
  assert.match(seedreamRes.message, /Seedream endpoint offline/)

  // 4. fal offline
  const falRes = await testProviderConnection({
    fetchImpl: offlineFetch,
    resolveKey: async () => 'fal-key',
    cfg: {},
  }, 'fal')
  assert.equal(falRes.ok, false)
  assert.equal(falRes.state, 'offline')
  assert.match(falRes.message, /Fal queue unreachable/)

  // 5. custom offline
  const customRes = await testProviderConnection({
    fetchImpl: offlineFetch,
    resolveKey: async () => 'custom-key',
    cfg: { customBaseURL: 'https://api.custom.fake' },
  }, 'custom')
  assert.equal(customRes.ok, false)
  assert.equal(customRes.state, 'offline')
  assert.match(customRes.message, /Custom endpoint offline/)
})

test('diagnostics (#377): HTTP 401/403 fixtures return state: unauthorized', async () => {
  const authErrFetch = async () => ({
    status: 401,
    ok: false,
    json: async () => ({ error: 'Unauthorized' }),
  })

  // Fal 401
  const fal = await testProviderConnection({
    fetchImpl: authErrFetch,
    resolveKey: async () => 'secret_key_12345',
    cfg: {},
  }, 'fal')
  assert.equal(fal.ok, false)
  assert.equal(fal.state, 'unauthorized')
  assert.doesNotMatch(fal.message, /secret_key_12345/, 'API keys must never leak in diagnostic messages')

  // Seedream 403
  const seedream = await testProviderConnection({
    fetchImpl: async () => ({ status: 403, ok: false }),
    resolveKey: async () => 'sd_secret_9999',
    cfg: {},
  }, 'seedream')
  assert.equal(seedream.ok, false)
  assert.equal(seedream.state, 'unauthorized')
  assert.doesNotMatch(seedream.message, /sd_secret_9999/)
})

test('diagnostics (#377): HTTP 500 fixture returns state: server_error', async () => {
  const serverErrFetch = async () => ({
    status: 503,
    ok: false,
    json: async () => ({ error: 'Service Unavailable' }),
  })

  const res = await testProviderConnection({
    fetchImpl: serverErrFetch,
    resolveKey: async () => 'custom-key',
    cfg: { customBaseURL: 'https://api.openai.com/v1' },
  }, 'custom')
  assert.equal(res.ok, false)
  assert.equal(res.state, 'server_error')
  assert.match(res.message, /Custom endpoint server error \(HTTP 503\)/)
})

test('diagnostics (#377): subscription provider checks subscriptionImages service contract', async () => {
  // 1. Without subscription service
  const resNoSub = await testProviderConnection({
    fetchImpl: async () => ({ status: 200, ok: true }),
    resolveKey: async () => null,
    cfg: {},
    ctx: {},
  }, 'subscription')
  assert.equal(resNoSub.ok, false)
  assert.equal(resNoSub.state, 'not_configured')
  assert.match(resNoSub.message, /subscriptionImages service not available/)

  // 2. With ctx.get('subscriptionImages')
  const mockSub = { generate: async () => ({}) }
  const resWithCtxGet = await testProviderConnection({
    fetchImpl: async () => ({ status: 200, ok: true }),
    resolveKey: async () => null,
    cfg: {},
    ctx: {
      get: (name) => (name === 'subscriptionImages' ? mockSub : undefined),
    },
  }, 'subscription')
  assert.equal(resWithCtxGet.ok, true)
  assert.equal(resWithCtxGet.state, 'authenticated')
  assert.match(resWithCtxGet.message, /Subscription bridge available/)

  // 3. With deps.subscriptionImages
  const resWithDeps = await testProviderConnection({
    fetchImpl: async () => ({ status: 200, ok: true }),
    resolveKey: async () => null,
    cfg: {},
    subscriptionImages: mockSub,
  }, 'chatgpt')
  assert.equal(resWithDeps.ok, true)
  assert.equal(resWithDeps.state, 'authenticated')
})

test('diagnostics (#377): unknown provider returns state: unsupported and ok: false', async () => {
  const res = await testProviderConnection({
    fetchImpl: async () => ({ status: 200, ok: true }),
    resolveKey: async () => null,
    cfg: {},
  }, 'unknown_random_backend')
  assert.equal(res.ok, false)
  assert.equal(res.state, 'unsupported')
  assert.match(res.message, /Unknown or unsupported provider: "unknown_random_backend"/)
})
