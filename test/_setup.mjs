// test/_setup.mjs
// Global test sandbox setup for @goodandready/dsh-image-gen (#338).
// Ensures all test suites run strictly inside an isolated temporary directory,
// completely protecting real production ~/.dsh from test cache files and spend mutations.

import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (!process.env.DSH_HOME || !process.env.DSH_HOME.includes('dsh-test-')) {
  const sandboxDir = mkdtempSync(join(tmpdir(), 'dsh-test-sandbox-'))
  process.env.DSH_HOME = sandboxDir

  process.on('exit', () => {
    try {
      if (existsSync(sandboxDir)) {
        rmSync(sandboxDir, { recursive: true, force: true })
      }
    } catch (_err) {
      // non-fatal cleanup of test sandbox
    }
  })
}

export function getTestSandboxDir() {
  return process.env.DSH_HOME
}
