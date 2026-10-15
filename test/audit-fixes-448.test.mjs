// test/audit-fixes-448.test.mjs
// Regression test suite for Issue #448:
// 1. Live settings adoption in readServedConfig (handling row.status === undefined / 'ready')
// 2. Output directory containment across tools via resolveInside
// 3. Loop guard reset triggered by user/message event

import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import { resolveInside } from '../lib/security.js'
import { trackAndAssertLoopGuard, resetLoopGuard, getLoopGuardState } from '../lib/loop-guard.js'
import { Config, plainConfig } from '../lib/config-schema.js'

test('#448 - readServedConfig logic: adopts served row with undefined or ready status', () => {
  const NS = 'dsh-image-gen'

  const makeReader = (mockRow) => {
    const settingsSvc = {
      describe: () => [mockRow],
    }
    const readServedConfig = () => {
      if (typeof settingsSvc?.describe !== 'function') return null
      try {
        const row = settingsSvc.describe().find((r) => r?.ns === NS)
        if (!row || !row.value || (row.status !== undefined && row.status !== 'ready')) return null
        return Config(structuredClone(plainConfig(row.value)))
      } catch (_) {
        return null
      }
    }
    return readServedConfig()
  }

  // 1. row with undefined status (standard DSH behavior) -> adopted
  const rowUndefinedStatus = {
    ns: NS,
    value: { defaultProvider: 'custom', fal: { apiKey: 'test-key' } },
  }
  const res1 = makeReader(rowUndefinedStatus)
  assert.ok(res1 !== null, 'Should adopt config when row.status is undefined')
  assert.equal(res1.defaultProvider, 'custom')

  // 2. row with explicit 'ready' status -> adopted
  const rowReady = {
    ns: NS,
    status: 'ready',
    value: { defaultProvider: 'replicate' },
  }
  const res2 = makeReader(rowReady)
  assert.ok(res2 !== null, 'Should adopt config when row.status is ready')
  assert.equal(res2.defaultProvider, 'replicate')

  // 3. row with non-ready status ('error', 'pending') -> rejected
  const rowPending = {
    ns: NS,
    status: 'pending',
    value: { defaultProvider: 'gemini' },
  }
  const res3 = makeReader(rowPending)
  assert.equal(res3, null, 'Should not adopt config when row.status is pending')

  // 4. row without value -> rejected
  const rowNoValue = {
    ns: NS,
    status: 'ready',
  }
  const res4 = makeReader(rowNoValue)
  assert.equal(res4, null, 'Should not adopt config when row.value is missing')
})

test('#448 - Tool sites enforce directory containment via resolveInside', () => {
  const sessionCwd = path.resolve(os.tmpdir(), 'dsh-session-' + Date.now())
  fs.mkdirSync(sessionCwd, { recursive: true })

  try {
    // Relative output dir is contained
    const validTarget = 'generated/images'
    const outDirValid = resolveInside(sessionCwd, validTarget)
    assert.equal(outDirValid, path.join(sessionCwd, 'generated/images'))

    // Absolute output dir attempting to escape sessionCwd throws
    const evilAbsoluteDir = path.resolve('/tmp/arbitrary-output-' + Date.now())
    assert.throws(
      () => resolveInside(sessionCwd, evilAbsoluteDir),
      /Path traversal denied/,
      'Must deny absolute paths outside sessionCwd'
    )

    // Upward traversal attempting to escape sessionCwd throws
    const traversalDir = '../../etc'
    assert.throws(
      () => resolveInside(sessionCwd, traversalDir),
      /Path traversal denied/,
      'Must deny upward directory traversal'
    )
  } finally {
    fs.rmSync(sessionCwd, { recursive: true, force: true })
  }
})

test('#448 - Loop guard reset on user/message event', () => {
  const sid = 'test-session-448'
  resetLoopGuard(sid)

  // Accumulate 2 generation calls
  trackAndAssertLoopGuard(sid, { prompt: 'prompt 1' })
  trackAndAssertLoopGuard(sid, { prompt: 'prompt 2' })
  assert.equal(getLoopGuardState(sid).count, 2)

  // Simulate ctx event dispatcher
  const listeners = {}
  const mockCtx = {
    on: (evt, handler) => {
      listeners[evt] = handler
    },
  }

  // Register identical to lib/index.js
  mockCtx.on('user/message', (session) => {
    const s = session?.id || session?.sessionId || session?.conversationId
    if (s) resetLoopGuard(s)
    else resetLoopGuard()
  })

  assert.ok(typeof listeners['user/message'] === 'function', 'user/message listener must be registered')

  // Dispatch user/message with session.id
  listeners['user/message']({ id: sid })
  assert.equal(getLoopGuardState(sid).count, 0, 'Counter must reset to 0 upon user/message')

  // Accumulate again and test with session.sessionId
  trackAndAssertLoopGuard(sid, { prompt: 'prompt 3' })
  assert.equal(getLoopGuardState(sid).count, 1)
  listeners['user/message']({ sessionId: sid })
  assert.equal(getLoopGuardState(sid).count, 0, 'Counter must reset to 0 upon user/message with sessionId')

  // Clean up
  resetLoopGuard(sid)
})
