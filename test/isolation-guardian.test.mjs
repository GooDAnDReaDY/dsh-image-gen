import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import './_setup.mjs'
import { recordSpend, loadDailySpend } from '../lib/cost-meter.js'
import { setCachedGeneration, getCachedGeneration } from '../lib/generation-cache.js'

test('isolation guardian: tests run inside isolated sandbox and never touch real ~/.dsh (#338)', () => {
  const realHome = homedir()
  const realDsh = join(realHome, '.dsh')

  // 1. DSH_HOME must be set to a temporary test directory
  assert.ok(process.env.DSH_HOME, 'process.env.DSH_HOME must be defined')
  assert.notEqual(process.env.DSH_HOME, realDsh, 'process.env.DSH_HOME must not point to real ~/.dsh')
  assert.ok(process.env.DSH_HOME.includes('dsh-test-'), 'process.env.DSH_HOME must be a temporary sandbox directory')

  // 2. Snapshot real ~/.dsh cache and spend file state before operation
  const realSpendFile = join(realDsh, 'storages', 'dsh-image-gen-spend.json')
  const realCacheDir = join(realDsh, 'cache', 'image-gen')

  const realSpendMtimeBefore = existsSync(realSpendFile) ? statSync(realSpendFile).mtimeMs : null
  const realCacheCountBefore = existsSync(realCacheDir) ? readdirSync(realCacheDir).length : 0

  // 3. Perform spend recording and caching inside test
  const testHash = `guardian_test_hash_${Date.now()}`
  setCachedGeneration(testHash, {
    bytes: Buffer.from('guardian test bytes'),
    mediaType: 'image/png',
    width: 512,
    height: 512,
    seed: 42,
    meta: { prompt: 'guardian test' },
  })

  const cached = getCachedGeneration(testHash)
  assert.ok(cached, 'Cached item should be retrievable from sandbox')
  assert.equal(cached.bytes.toString('utf8'), 'guardian test bytes')

  recordSpend(0.01)

  // 4. Verify that real ~/.dsh state was completely unchanged
  const realSpendMtimeAfter = existsSync(realSpendFile) ? statSync(realSpendFile).mtimeMs : null
  const realCacheCountAfter = existsSync(realCacheDir) ? readdirSync(realCacheDir).length : 0

  assert.equal(realSpendMtimeAfter, realSpendMtimeBefore, 'Real spend file in ~/.dsh must not be modified by tests')
  assert.equal(realCacheCountAfter, realCacheCountBefore, 'Real cache directory in ~/.dsh must not receive files from tests')

  // 5. Verify that sandbox actually received the files
  const sandboxCacheDir = join(process.env.DSH_HOME, 'cache', 'image-gen')
  assert.ok(existsSync(sandboxCacheDir), 'Sandbox cache directory must exist')
  assert.ok(existsSync(join(sandboxCacheDir, `${testHash}.json`)), 'Sandbox must contain cached json file')
  assert.ok(existsSync(join(sandboxCacheDir, `${testHash}.bin`)), 'Sandbox must contain cached bin file')
})
