// test/session-artifacts.test.mjs — Unit and integration tests for #453

import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import {
  buildSemanticSlug,
  resolveSessionSlug,
  resolveAssetOutputDir,
  STOP_WORDS,
} from '../lib/session-artifacts.js'
import { saveAndAttachResult } from '../lib/attachment-helper.js'
import { deleteVaultEntry } from '../lib/vault.js'
import { writeHistory, readHistory } from '../lib/history.js'

test('buildSemanticSlug: extracts key entities and filters stop words', () => {
  const slug1 = buildSemanticSlug('A futuristic hero banner in cyberpunk neon style', 'image', 0)
  assert.equal(slug1, 'futuristic-hero-banner-cyberpunk-v1')

  const slug2 = buildSemanticSlug('Generate 4k ultra realistic photo of a cute flying cat', 'image', 2)
  assert.equal(slug2, 'cute-flying-cat-v3')

  const slug3 = buildSemanticSlug('сгенерируй реалистичное фото космического корабля на орбите', 'image', 0)
  assert.equal(slug3, 'космического-корабля-орбите-v1')

  // Fallback when only stop words are present
  const slugFallback = buildSemanticSlug('the a in on for', 'ui_icon', 0)
  assert.equal(slugFallback, 'ui-icon-v1')

  // Empty prompt
  const slugEmpty = buildSemanticSlug('', 'sketch', 1)
  assert.equal(slugEmpty, 'sketch-v2')
})

test('buildSemanticSlug: handles custom index and version strings', () => {
  const s1 = buildSemanticSlug('retro robot warrior', 'image', 'v5')
  assert.equal(s1, 'retro-robot-warrior-v5')

  const s2 = buildSemanticSlug('retro robot warrior', 'image', 4)
  assert.equal(s2, 'retro-robot-warrior-v5')

  const s3 = buildSemanticSlug('minimal logo design')
  assert.equal(s3, 'minimal-logo-design')
})

test('resolveSessionSlug: handles various session structures and fallbacks', () => {
  assert.equal(resolveSessionSlug(null), 'default-session')
  assert.equal(resolveSessionSlug({}), 'default-session')

  assert.equal(
    resolveSessionSlug({ header: { title: 'Auth Service Redesign 2026' } }),
    'auth-service-redesign-2026'
  )
  assert.equal(
    resolveSessionSlug({ header: { slug: 'project-dashboard' } }),
    'project-dashboard'
  )
  assert.equal(
    resolveSessionSlug({ id: 'session-xyz-12345' }),
    'session-xyz-12345'
  )
  assert.equal(
    resolveSessionSlug({ sessionId: 'chat_session_88' }),
    'chat-session-88'
  )
})

test('resolveAssetOutputDir: computes session-scoped or flat paths', () => {
  const tmpRoot = path.join(os.tmpdir(), 'dsh-test-session-root')

  // 1. organizeBySession: true (default)
  const dirSession = resolveAssetOutputDir({
    sessionCwd: tmpRoot,
    session: { header: { title: 'Landing Page' } },
    cfg: { organizeBySession: true },
  })
  assert.equal(dirSession, path.join(tmpRoot, 'assets', 'images', 'landing-page'))

  // 2. organizeBySession: false
  const dirFlat = resolveAssetOutputDir({
    sessionCwd: tmpRoot,
    session: { header: { title: 'Landing Page' } },
    cfg: { organizeBySession: false, outputDir: 'custom/generated' },
  })
  assert.equal(dirFlat, path.join(tmpRoot, 'custom', 'generated'))

  // 3. Explicit args.output_dir overrides organizeBySession
  const dirOverride = resolveAssetOutputDir({
    sessionCwd: tmpRoot,
    session: { header: { title: 'Landing Page' } },
    cfg: { organizeBySession: true },
    args: { output_dir: 'special-output' },
  })
  assert.equal(dirOverride, path.join(tmpRoot, 'special-output'))
})

test('saveAndAttachResult: saves image and sidecar in session directory (#453)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sess-test-'))
  const sessionCwd = path.join(tmpDir, 'workspace')
  fs.mkdirSync(sessionCwd, { recursive: true })

  const mockCtx = {
    attachments: {
      saveImage: async () => ({
        attachment: { attachmentId: 'sha256:' + 'a'.repeat(64), width: 512, height: 512 },
        localUrl: '/dsh-image-gen/image?id=sha256:test',
      }),
    },
  }

  const mockExec = {
    agent: {
      session: {
        header: {
          cwd: sessionCwd,
          title: 'Hero Banner Task',
        },
      },
    },
  }

  // 1x1 transparent PNG buffer
  const samplePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

  const res = await saveAndAttachResult(mockCtx, mockExec, { organizeBySession: true }, {
    bytes: samplePng,
    mediaType: 'image/png',
    name: 'hero-banner-cyberpunk-v1.png',
    stem: 'hero-banner-cyberpunk-v1',
    prompt: 'futuristic cyberpunk hero banner',
    seed: 12345,
    provider: 'fal',
    format: 'png',
  })

  assert.ok(res)
  assert.ok(res.path)
  const expectedDir = path.join(sessionCwd, 'assets', 'images', 'hero-banner-task')
  assert.equal(path.dirname(res.path), expectedDir)
  assert.ok(fs.existsSync(res.path), 'Image file must exist on disk in session subfolder')
  assert.ok(fs.existsSync(path.join(expectedDir, 'hero-banner-cyberpunk-v1.json')), 'Sidecar JSON must exist')

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('vault: deletes session-scoped asset and protects outside roots', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-vault-test-'))
  const assetDir = path.join(tmpDir, 'assets', 'images', 'test-session')
  fs.mkdirSync(assetDir, { recursive: true })

  const imgPath = path.join(assetDir, 'sample-v1.png')
  const jsonPath = path.join(assetDir, 'sample-v1.json')
  fs.writeFileSync(imgPath, 'fake-png')
  fs.writeFileSync(jsonPath, '{}')

  const entryId = 'vault-session-entry-1'
  const history = [
    {
      id: entryId,
      path: imgPath,
      prompt: 'sample prompt',
      createdAt: new Date().toISOString(),
    },
  ]
  await writeHistory(history)

  // 1. Deletion succeeds when path is in allowed roots
  const delRes = await deleteVaultEntry(entryId, {
    allowedRoots: [tmpDir],
  })
  assert.equal(delRes.success, true)
  assert.equal(fs.existsSync(imgPath), false)
  assert.equal(fs.existsSync(jsonPath), false)

  // 2. Deletion refuses outside allowed roots
  const forbiddenImg = path.join(os.tmpdir(), 'forbidden-file.png')
  fs.writeFileSync(forbiddenImg, 'secret')
  const entryId2 = 'vault-forbidden-entry'
  await writeHistory([
    {
      id: entryId2,
      path: forbiddenImg,
      prompt: 'forbidden',
    },
  ])

  const delRefused = await deleteVaultEntry(entryId2, {
    allowedRoots: ['/nonexistent/root'],
  })
  assert.equal(delRefused.success, false)
  assert.ok(delRefused.error.includes('Refusing to delete'))
  assert.equal(fs.existsSync(forbiddenImg), true)

  fs.unlinkSync(forbiddenImg)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

