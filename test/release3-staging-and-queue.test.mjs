import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'

import {
  createStagingSession,
  reviewStagedEdit,
  getStagingSession,
  compositeInpaintPatch,
} from '../lib/inpaint-staging.js'

import {
  enqueueBatch,
  getBatchQueue,
  getBatchProgress,
  cancelBatch,
  retryFailedBatchItems,
  processBatchItems,
  reconcileQueueOnStartup,
} from '../lib/batch-queue.js'

import { registerInpaintStagingTools } from '../lib/tools/inpaint-staging.js'
import { registerBatchQueueTools } from '../lib/tools/batch-queue.js'

test('inpaint-staging (#436): complete lifecycle accept, reject, retry and cancel state transitions', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-staging-test-'))
  const tempFile = path.join(tempDir, 'staging.json')

  try {
    // 1. Create staging session
    const session = createStagingSession(
      {
        originalImage: '/tmp/orig.png',
        prompt: 'change hat color to red',
        bbox: [100, 100, 400, 400],
        previewImage: '/tmp/preview1.png',
        estimatedCost: 0.02,
      },
      tempFile
    )

    assert.ok(session.stageId)
    assert.equal(session.status, 'staged')
    assert.equal(session.originalImage, '/tmp/orig.png')

    // 2. Retry with modified instruction
    const retryRes = reviewStagedEdit(session.stageId, 'retry', { prompt: 'change hat to crimson beret' }, tempFile)
    assert.equal(retryRes.ok, true)
    assert.equal(retryRes.status, 'staged')
    assert.equal(retryRes.prompt, 'change hat to crimson beret')

    // 3. Reject
    const rejectSession = createStagingSession(
      { originalImage: '/tmp/orig2.png', previewImage: '/tmp/bad.png' },
      tempFile
    )
    const rejectRes = reviewStagedEdit(rejectSession.stageId, 'reject', { reason: 'Poor quality' }, tempFile)
    assert.equal(rejectRes.ok, true)
    assert.equal(rejectRes.status, 'rejected')
    assert.equal(rejectRes.originalImage, '/tmp/orig2.png')

    // 4. Accept
    const acceptRes = reviewStagedEdit(session.stageId, 'accept', {}, tempFile)
    assert.equal(acceptRes.ok, true)
    assert.equal(acceptRes.status, 'accepted')
    assert.equal(acceptRes.parentImageId, '/tmp/orig.png')

    // 5. Finalized session cannot be re-reviewed
    const reReview = reviewStagedEdit(session.stageId, 'accept', {}, tempFile)
    assert.equal(reReview.ok, false)
    assert.match(reReview.error, /already finalized/i)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('inpaint-staging (#436): compositeInpaintPatch overlays edited region on original using sharp', async () => {
  // Create blank 100x100 white original
  const origBuf = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).png().toBuffer()

  // Create 50x50 red patch
  const patchBuf = await sharp({
    create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).png().toBuffer()

  // Composite with normalized bbox [0, 0, 500, 500] (top-left quadrant)
  const resultBuf = await compositeInpaintPatch(origBuf, patchBuf, [0, 0, 500, 500], { width: 100, height: 100 })
  assert.ok(Buffer.isBuffer(resultBuf))

  const meta = await sharp(resultBuf).metadata()
  assert.equal(meta.width, 100)
  assert.equal(meta.height, 100)
})

test('batch-queue (#437): queue creation, budget pre-check, and processing lifecycle', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-queue-test-'))
  const tempFile = path.join(tempDir, 'queue.json')

  try {
    // Budget pre-check reject
    assert.throws(
      () => {
        enqueueBatch(
          {
            name: 'Expensive Batch',
            items: [{ tool: 'generate_image', estimatedCost: 0.10 }, { tool: 'generate_image', estimatedCost: 0.10 }],
            maxBudget: 0.05,
          },
          tempFile
        )
      },
      /exceeds allowed budget limit/i
    )

    // Valid queue
    const batch = enqueueBatch(
      {
        name: 'Test Batch',
        items: [
          { id: 'job_1', tool: 'generate_image', params: { prompt: 'a cat' }, estimatedCost: 0.02 },
          { id: 'job_2', tool: 'generate_image', params: { prompt: 'a dog' }, estimatedCost: 0.02 },
        ],
        concurrency: 2,
      },
      tempFile
    )

    assert.ok(batch.batchId)
    assert.equal(batch.status, 'queued')
    assert.equal(batch.items.length, 2)
    assert.equal(batch.totalEstimatedCost, 0.04)

    // Mock processing executor
    const executor = async (tool, params) => {
      if (params.prompt.includes('dog')) throw new Error('Dog generation failed')
      return { path: '/tmp/cat.webp' }
    }

    const processRes = await processBatchItems(batch.batchId, executor, tempFile)
    assert.equal(processRes.ok, true)
    assert.equal(processRes.status, 'completed_with_errors')
    assert.equal(processRes.progress.completed, 1)
    assert.equal(processRes.progress.failed, 1)

    // Retry only failed
    const retryRes = retryFailedBatchItems(batch.batchId, null, tempFile)
    assert.equal(retryRes.ok, true)
    assert.equal(retryRes.resetCount, 1)
    assert.equal(retryRes.progress.queued, 1)

    // Cancel batch
    const cancelRes = cancelBatch(batch.batchId, null, tempFile)
    assert.equal(cancelRes.ok, true)
    assert.equal(cancelRes.status, 'cancelled')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('batch-queue (#437): startup reconciliation marks active running jobs as interrupted without double billing', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-queue-reconcile-'))
  const tempFile = path.join(tempDir, 'queue.json')

  try {
    // Manually create a queue with a job stuck in 'running'
    const batch = {
      batchId: 'batch_crash_1',
      name: 'Unfinished Batch',
      status: 'running',
      items: [
        { id: 'job_done', status: 'succeeded', result: '/tmp/ok.png' },
        { id: 'job_stuck', status: 'running', startedAt: new Date().toISOString() },
        { id: 'job_waiting', status: 'queued' },
      ],
    }
    fs.writeFileSync(tempFile, JSON.stringify([batch], null, 2), 'utf8')

    // Perform startup reconciliation
    const recon = reconcileQueueOnStartup(tempFile)
    assert.equal(recon.reconciledJobs, 1)

    const updated = getBatchQueue('batch_crash_1', tempFile)
    assert.equal(updated.status, 'interrupted')
    assert.equal(updated.items[0].status, 'succeeded')
    assert.equal(updated.items[1].status, 'interrupted')
    assert.match(updated.items[1].interruptionNotice, /not retried to prevent duplicate billing/i)
    assert.equal(updated.items[2].status, 'queued')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('tools (#436, #437): staging and queue tools register with valid schema and output render', async () => {
  const registered = []
  const mockCtx = {
    tools: {
      register(def) {
        registered.push(def)
      },
    },
  }

  registerInpaintStagingTools(mockCtx, {})
  registerBatchQueueTools(mockCtx, {})

  assert.equal(registered.length, 4)
  const names = registered.map((t) => t.name)
  assert.ok(names.includes('stage_image_edit'))
  assert.ok(names.includes('review_staged_edit'))
  assert.ok(names.includes('enqueue_batch_jobs'))
  assert.ok(names.includes('manage_batch_queue'))

  for (const t of registered) {
    assert.equal(t.parameters.type, 'object')
    assert.equal(t.parameters.additionalProperties, false, `${t.name} must have additionalProperties: false`)
    assert.ok(typeof t.output?.render === 'function', `${t.name} must have output.render`)
  }
})
