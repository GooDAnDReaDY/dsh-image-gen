import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

test('live-progress: client source and bundle declare live progress elements (#329)', () => {
  const previewSrc = fs.readFileSync(path.join(root, 'src', 'client', '102-progressive-preview.js'), 'utf8')
  assert.match(previewSrc, /ig-progress-container/)
  assert.match(previewSrc, /ig-progress-track/)
  assert.match(previewSrc, /ig-progress-fill/)
  assert.match(previewSrc, /props\.progress/)
  assert.match(previewSrc, /props\.step/)
  assert.match(previewSrc, /props\.stage/)

  const cssSrc = fs.readFileSync(path.join(root, 'src', 'client', '10-css.js'), 'utf8')
  assert.match(cssSrc, /\.ig-progress-container/)
  assert.match(cssSrc, /\.ig-progress-track/)
  assert.match(cssSrc, /\.ig-progress-fill/)

  const clientBundle = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
  assert.match(clientBundle, /ig-progress-container/)
  assert.match(clientBundle, /ig-progress-fill/)
})

test('live-progress: card forwards progress metadata to preview', () => {
  const cardSrc = fs.readFileSync(path.join(root, 'src', 'client', '100-image-card.js'), 'utf8')
  assert.match(cardSrc, /progress:\s*typeof parsed\?\.progress/)
  assert.match(cardSrc, /step:\s*parsed\?\.step/)
  assert.match(cardSrc, /stage:\s*parsed\?\.stage/)
})

test('live-progress (#379): pre-registered subscriber receives events across session reset', async () => {
  const {
    subscribeLiveProgress,
    createLiveProgressSession,
    publishLiveProgress,
    completeLiveProgress,
  } = await import('../lib/live-progress.js')

  const callId = `test-progress-${Date.now()}`
  const stages = []

  // Subscribe before session is created
  const unsubscribe = subscribeLiveProgress(callId, (data) => {
    stages.push(data.stage)
  })

  // Start/reset session
  createLiveProgressSession(callId)

  // Publish incremental progress
  publishLiveProgress(callId, { stage: 'Generating', progress: 50 })
  completeLiveProgress(callId)

  assert.ok(stages.includes('Starting...'), 'Initial replay received')
  assert.ok(stages.includes('Generating'), 'Generating progress delivered to pre-registered listener')
  assert.ok(stages.includes('Complete'), 'Complete status delivered')

  unsubscribe()
})

