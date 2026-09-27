import test from 'node:test'
import assert from 'node:assert/strict'
import { testProviderConnection, editImageDirect, varyImageDirect } from '../lib/providers.js'

test('diagnostics: testProviderConnection handles empty/null provider and config gracefully (#331)', async () => {
  const deps = {
    cfg: {},
    resolveKey: async () => null,
  }

  // 1. null providerId, empty cfg
  const r1 = await testProviderConnection(deps, null)
  assert.equal(r1.ok, false)
  assert.match(r1.message, /FAL API key not configured/)

  // 2. undefined providerId, empty cfg
  const r2 = await testProviderConnection(deps, undefined)
  assert.equal(r2.ok, false)
  assert.match(r2.message, /FAL API key not configured/)

  // 3. object provider in cfg
  const r3 = await testProviderConnection({ cfg: { provider: {} }, resolveKey: async () => null }, null)
  assert.equal(r3.ok, false)
  assert.match(r3.message, /FAL API key not configured/)

  // 4. explicit valid provider string in cfg
  const r4 = await testProviderConnection({ cfg: { provider: 'fal' }, resolveKey: async () => null }, undefined)
  assert.equal(r4.ok, false)
  assert.match(r4.message, /FAL API key not configured/)
})

test('providers: editImageDirect and varyImageDirect fall back to safe fal when provider is unconfigured (#331)', async () => {
  const fakeDeps = {
    cfg: {},
    resolveKey: async () => 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  }

  // Should resolve providerKey to 'fal' without throwing toLowerCase TypeError
  await assert.rejects(
    async () => editImageDirect(fakeDeps, { prompt: 'test' }),
    (err) => err.message !== '(providerId || cfg.defaultProvider || "fal").toLowerCase is not a function'
  )

  await assert.rejects(
    async () => varyImageDirect(fakeDeps, { prompt: 'test' }),
    (err) => err.message !== '(providerId || cfg.defaultProvider || "fal").toLowerCase is not a function'
  )
})
