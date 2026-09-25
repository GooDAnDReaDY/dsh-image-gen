import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('build-parity: scripts/build-client.mjs --check exits with 0 when lib/client.js is in sync', () => {
  const res = spawnSync('node', ['scripts/build-client.mjs', '--check'], {
    encoding: 'utf8',
  })
  assert.equal(res.status, 0, `build-client --check failed: ${res.stderr || res.stdout}`)
  assert.ok(res.stdout.includes('is in sync'), `unexpected output: ${res.stdout}`)
})
