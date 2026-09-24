import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchAspectRatio, filterVaultEntries, deleteVaultEntry, registerVaultRoutes } from '../lib/vault.js'

test('vault: matchAspectRatio identifies common aspect ratios', () => {
  assert.equal(matchAspectRatio(1024, 1024, '1:1'), true)
  assert.equal(matchAspectRatio(1024, 1024, 'square'), true)
  assert.equal(matchAspectRatio(1024, 576, '16:9'), true)
  assert.equal(matchAspectRatio(1920, 1080, 'landscape'), true)
  assert.equal(matchAspectRatio(576, 1024, '9:16'), true)
  assert.equal(matchAspectRatio(1080, 1920, 'portrait'), true)
  assert.equal(matchAspectRatio(1024, 768, '4:3'), true)
  assert.equal(matchAspectRatio(768, 1024, '3:4'), true)
  assert.equal(matchAspectRatio(2560, 1080, '21:9'), true)
  assert.equal(matchAspectRatio(1024, 1024, '16:9'), false)
  assert.equal(matchAspectRatio(1024, 1024, 'all'), true)
  assert.equal(matchAspectRatio(1024, 1024, ''), true)
})

test('vault: filterVaultEntries filters, sorts, paginates and sanitizes path', () => {
  const entries = [
    {
      id: 'img-1',
      attachmentId: 'att-1',
      prompt: 'A cyberpunk samurai in neon rain',
      provider: 'fal',
      width: 1024,
      height: 1024,
      createdAt: '2026-09-20T10:00:00.000Z',
      path: '/mock/images/img-1.png',
    },
    {
      id: 'img-2',
      attachmentId: 'att-2',
      prompt: 'Watercolor landscape with mountains',
      provider: 'openai',
      width: 1792,
      height: 1024,
      createdAt: '2026-09-21T12:00:00.000Z',
      path: '/mock/images/img-2.png',
    },
    {
      id: 'img-3',
      attachmentId: 'att-3',
      prompt: 'Retro pixel art arcade hero',
      provider: 'fal',
      width: 576,
      height: 1024,
      createdAt: '2026-09-22T14:00:00.000Z',
      path: '/mock/images/img-3.png',
    },
    {
      id: 'img-4',
      attachmentId: 'att-4',
      prompt: 'Cyberpunk flying car over cityscape',
      provider: 'local',
      width: 1024,
      height: 1024,
      createdAt: '2026-09-23T16:00:00.000Z',
      path: '/mock/images/img-4.png',
    },
  ]

  const mockExists = () => true

  // 1. Text search by prompt
  const qRes = filterVaultEntries(entries, { q: 'cyberpunk' }, mockExists)
  assert.equal(qRes.total, 2)
  assert.equal(qRes.items.length, 2)
  assert.equal(qRes.items[0].id, 'img-4') // newest first
  assert.equal(qRes.items[1].id, 'img-1')

  // 2. Provider filter
  const provRes = filterVaultEntries(entries, { provider: 'fal' }, mockExists)
  assert.equal(provRes.total, 2)
  assert.equal(provRes.items[0].id, 'img-3')
  assert.equal(provRes.items[1].id, 'img-1')

  // 3. Aspect ratio filter
  const aspectRes = filterVaultEntries(entries, { aspect: '16:9' }, mockExists)
  assert.equal(aspectRes.total, 1)
  assert.equal(aspectRes.items[0].id, 'img-2')

  // 4. Sorting oldest first
  const sortRes = filterVaultEntries(entries, { sort: 'oldest' }, mockExists)
  assert.equal(sortRes.items[0].id, 'img-1')
  assert.equal(sortRes.items[3].id, 'img-4')

  // 5. Pagination
  const pageRes = filterVaultEntries(entries, { offset: 1, limit: 2 }, mockExists)
  assert.equal(pageRes.offset, 1)
  assert.equal(pageRes.limit, 2)
  assert.equal(pageRes.total, 4)
  assert.equal(pageRes.hasMore, true)
  assert.equal(pageRes.items.length, 2)

  // 6. Security sanitization: path stripped
  for (const item of pageRes.items) {
    assert.equal(item.path, undefined, 'Filesystem path must be omitted')
    assert.ok(item.thumbnailUrl.includes('/dsh-image-gen/image?id='))
  }
})

test('vault: registerVaultRoutes binds /dsh-image-gen/vault with isTrustedLocalRequest', () => {
  const registered = []
  const mockCtx = {
    effect(fn) {
      fn()
    },
    webServer: {
      register(opts) {
        registered.push(opts)
      },
    },
  }

  registerVaultRoutes(mockCtx)
  const vaultRoute = registered.find((r) => r.path === '/dsh-image-gen/vault')
  assert.ok(vaultRoute, 'Must register /dsh-image-gen/vault')
  assert.equal(vaultRoute.kind, 'exact')
  assert.equal(typeof vaultRoute.handler, 'function')
})
