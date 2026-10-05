// test/path-containment.test.mjs
// Regression test suite for Block 1 (Issues #409, #410, #411, #412, #418, #420)
// Verifies path containment and workspace escape prevention across all write tools and vault delete.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import { resolveInside } from '../lib/security.js'
import { saveAndAttachResult } from '../lib/attachment-helper.js'
import { generatePwaIconSuite } from '../lib/frontend-assets.js'
import { deleteVaultEntry, isPathContainedInRoots } from '../lib/vault.js'
import { withHistoryLock, writeHistory, readHistory } from '../lib/history.js'

test('resolveInside (#420): permits valid relative paths and subdirectories', () => {
  const base = path.resolve(os.tmpdir(), 'dsh-test-base-' + Date.now())
  fs.mkdirSync(base, { recursive: true })
  try {
    const res1 = resolveInside(base, 'sub/dir')
    assert.equal(res1, path.join(base, 'sub/dir'))

    const res2 = resolveInside(base, './images/output.png')
    assert.equal(res2, path.join(base, 'images/output.png'))

    const res3 = resolveInside(base, '.')
    assert.equal(res3, base)

    const res4 = resolveInside(base, '')
    assert.equal(res4, base)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('resolveInside (#420, #409): throws error on upward traversal escaping base', () => {
  const base = path.resolve(os.tmpdir(), 'dsh-test-base-' + Date.now())
  fs.mkdirSync(base, { recursive: true })
  try {
    assert.throws(
      () => resolveInside(base, '../outside'),
      /Path traversal denied/
    )
    assert.throws(
      () => resolveInside(base, '../../../../etc/passwd'),
      /Path traversal denied/
    )
    assert.throws(
      () => resolveInside(base, 'sub/../../outside'),
      /Path traversal denied/
    )
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('resolveInside (#420, #409): throws error on absolute paths outside base', () => {
  const base = path.resolve(os.tmpdir(), 'dsh-test-base-' + Date.now())
  fs.mkdirSync(base, { recursive: true })
  try {
    assert.throws(
      () => resolveInside(base, '/etc/passwd'),
      /Path traversal denied/
    )
    assert.throws(
      () => resolveInside(base, '/tmp/malicious-output'),
      /Path traversal denied/
    )
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('resolveInside (#420): throws error when symlink resolves outside base', () => {
  const tmpRoot = path.resolve(os.tmpdir(), 'dsh-test-symlink-root-' + Date.now())
  const base = path.join(tmpRoot, 'base')
  const outside = path.join(tmpRoot, 'outside')
  fs.mkdirSync(base, { recursive: true })
  fs.mkdirSync(outside, { recursive: true })

  try {
    const symlinkTarget = path.join(base, 'symlink-out')
    try {
      fs.symlinkSync(outside, symlinkTarget, 'dir')
    } catch (_err) {
      // Symlink creation might fail without admin on Windows, skip if unsupported
      return
    }

    assert.throws(
      () => resolveInside(base, 'symlink-out/subfile.png'),
      /Path traversal denied/
    )
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})

test('saveAndAttachResult (#412): rejects output_dir that escapes workspace', async () => {
  const tmpBase = path.resolve(os.tmpdir(), 'dsh-test-attach-base-' + Date.now())
  fs.mkdirSync(tmpBase, { recursive: true })

  const mockCtx = {
    attachments: {
      writeImage: async () => ({ attachmentId: 'att-mock', width: 64, height: 64 }),
    },
  }
  const mockExec = {
    agent: { session: { header: { cwd: tmpBase } } },
  }
  const mockCfg = { outputDir: 'generated/images' }
  const mockBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

  try {
    // 1. Upward traversal
    await assert.rejects(
      async () => {
        await saveAndAttachResult(mockCtx, mockExec, mockCfg, {
          bytes: mockBytes,
          mediaType: 'image/png',
          name: 'test.png',
          stem: 'test',
          args: { output_dir: '../../escaped-dir' },
        })
      },
      /Path traversal denied/,
      'Must reject output_dir escaping sessionCwd via ../'
    )

    // 2. Absolute path traversal
    await assert.rejects(
      async () => {
        await saveAndAttachResult(mockCtx, mockExec, mockCfg, {
          bytes: mockBytes,
          mediaType: 'image/png',
          name: 'test.png',
          stem: 'test',
          args: { output_dir: '/etc' },
        })
      },
      /Path traversal denied/,
      'Must reject absolute output_dir'
    )
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  }
})

test('generatePwaIconSuite (#409, #411): rejects outDir and iconsDir escaping base', async () => {
  const tmpBase = path.resolve(os.tmpdir(), 'dsh-test-pwa-base-' + Date.now())
  fs.mkdirSync(tmpBase, { recursive: true })

  try {
    // 1. iconsDir escaping outDir
    await assert.rejects(
      async () => {
        await generatePwaIconSuite({
          name: 'Test App',
          iconsDir: '../../escaped-icons',
          outDir: tmpBase,
        })
      },
      /Path traversal denied/,
      'Must reject iconsDir escaping outDir'
    )

    // 2. iconsDir absolute path
    await assert.rejects(
      async () => {
        await generatePwaIconSuite({
          name: 'Test App',
          iconsDir: '/tmp/escaped-icons',
          outDir: tmpBase,
        })
      },
      /Path traversal denied/,
      'Must reject absolute iconsDir'
    )
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  }
})

test('deleteVaultEntry (#418): refuses to unlink files outside allowed roots', async () => {
  const allowedBase = path.resolve(os.tmpdir(), 'dsh-test-vault-base-' + Date.now())
  const outsideDir = path.resolve(os.tmpdir(), 'dsh-test-vault-outside-' + Date.now())
  fs.mkdirSync(allowedBase, { recursive: true })
  fs.mkdirSync(outsideDir, { recursive: true })

  const outsideFile = path.join(outsideDir, 'sensitive-file.txt')
  fs.writeFileSync(outsideFile, 'secret-data', 'utf8')

  try {
    // Inject poisoned entry pointing to outsideFile into history
    await withHistoryLock(async () => {
      await writeHistory([
        {
          id: 'poisoned-entry-1',
          path: outsideFile,
          prompt: 'Poisoned test entry',
          createdAt: new Date().toISOString(),
        },
      ])
    })

    // Try deleting with allowedRoots set to allowedBase
    const res = await deleteVaultEntry('poisoned-entry-1', { allowedRoots: [allowedBase] })
    assert.equal(res.success, false)
    assert.ok(res.error.includes('Refusing to delete file outside allowed roots'))
    assert.equal(fs.existsSync(outsideFile), true, 'File outside allowed root must NOT be deleted')
  } finally {
    fs.rmSync(allowedBase, { recursive: true, force: true })
    fs.rmSync(outsideDir, { recursive: true, force: true })
  }
})

test('deleteVaultEntry (#418): safely unlinks file within allowed root', async () => {
  const allowedBase = path.resolve(os.tmpdir(), 'dsh-test-vault-allowed-' + Date.now())
  fs.mkdirSync(allowedBase, { recursive: true })

  const safeFile = path.join(allowedBase, 'safe-image.png')
  const safeSidecar = path.join(allowedBase, 'safe-image.json')
  fs.writeFileSync(safeFile, 'fake-image', 'utf8')
  fs.writeFileSync(safeSidecar, '{}', 'utf8')

  try {
    await withHistoryLock(async () => {
      await writeHistory([
        {
          id: 'safe-entry-1',
          path: safeFile,
          prompt: 'Safe test entry',
          createdAt: new Date().toISOString(),
        },
      ])
    })

    const res = await deleteVaultEntry('safe-entry-1', { allowedRoots: [allowedBase] })
    assert.equal(res.success, true)
    assert.equal(fs.existsSync(safeFile), false, 'Safe file must be unlinked')
    assert.equal(fs.existsSync(safeSidecar), false, 'Safe sidecar must be unlinked')
  } finally {
    fs.rmSync(allowedBase, { recursive: true, force: true })
  }
})
