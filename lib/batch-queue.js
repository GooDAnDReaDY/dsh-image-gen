import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { chmodSync, mkdirSync } from 'node:fs'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/**
 * Resilient Batch Queue & Job Reconciliation (#437)
 * Provides persistent queuing for image generation & processing series,
 * with concurrency throttling, budget pre-checks, cancellation, and restart recovery.
 *
 * #554: queue persistence now follows the history.js integrity contract —
 * DSH_HOME-aware path resolution, in-process serialization + cross-process
 * withFileLock around every read-modify-write, atomic 0600 writes, and a real
 * bounded-concurrency worker pool in processBatchItems.
 */

/** In-memory writer queue: serializes every read-modify-write within the process (#554) */
let inMemoryLockQueue = Promise.resolve()

/** Resolve the queue storage path honoring custom path, DSH_BATCH_QUEUE_PATH and DSH_HOME (#554) */
export function getQueueStoragePath(customPath) {
  if (customPath) return customPath
  if (process.env.DSH_BATCH_QUEUE_PATH) return process.env.DSH_BATCH_QUEUE_PATH
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'dsh-image-gen', 'batch-queue.json')
}

/** Run an operation under the in-memory writer queue + cross-process file lock (#554) */
export async function withQueueLock(storagePath, operation, options = { waitMs: 5000 }) {
  const file = getQueueStoragePath(storagePath)
  const dir = path.dirname(file)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    try { chmodSync(dir, 0o700) } catch (_err) { /* non-fatal permission repair */ }
  } catch (_err) { /* non-fatal mkdir */ }

  const runWithLocks = async () => {
    return await withFileLock(file, operation, options)
  }
  const next = inMemoryLockQueue.then(runWithLocks, runWithLocks)
  inMemoryLockQueue = next.catch((_err) => { /* non-fatal best-effort */ })
  return await next
}

function readQueuesSync(filePath) {
  try {
    if (!fs.existsSync(filePath)) return []
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch (_err) {
    return []
  }
}

/** Atomic 0600 write of the full queue list (#554). MUST be called under withQueueLock. */
async function writeQueuesAtomic(filePath, queues) {
  const dir = path.dirname(filePath)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    try { chmodSync(dir, 0o700) } catch (_err) { /* non-fatal permission repair */ }
  } catch (_err) { /* non-fatal mkdir */ }
  await writeFileAtomic(filePath, JSON.stringify(queues, null, 2), {
    mode: 0o600,
    dirMode: 0o700,
  })
}

export async function loadBatchQueues(storagePath) {
  const filePath = getQueueStoragePath(storagePath)
  return await withQueueLock(storagePath, async () => readQueuesSync(filePath))
}

/**
 * Persist a batch (insert or replace by batchId) under exclusive lock with an
 * atomic 0600 write — parallel saves no longer lose each other's batches (#554).
 */
export async function saveBatchQueue(batch, storagePath) {
  const filePath = getQueueStoragePath(storagePath)
  return await withQueueLock(storagePath, async () => {
    const existing = readQueuesSync(filePath)
    const index = existing.findIndex((b) => b.batchId === batch.batchId)
    if (index >= 0) {
      existing[index] = batch
    } else {
      existing.push(batch)
    }
    await writeQueuesAtomic(filePath, existing)
    return batch
  })
}

export async function getBatchQueue(batchId, storagePath) {
  const queues = await loadBatchQueues(storagePath)
  return queues.find((b) => b.batchId === batchId) || null
}

/**
 * Startup reconciliation (#437):
 * Interrupted jobs (stuck in 'running' during crash/restart) are marked 'interrupted'
 * and NEVER blindly retried without explicit user confirmation.
 */
export async function reconcileQueueOnStartup(storagePath) {
  const queues = await loadBatchQueues(storagePath)
  let updatedCount = 0

  for (const batch of queues) {
    let batchModified = false
    for (const item of batch.items || []) {
      if (item.status === 'running') {
        item.status = 'interrupted'
        item.interruptedAt = new Date().toISOString()
        item.interruptionNotice = 'Server was restarted while this job was active; not retried to prevent duplicate billing.'
        batchModified = true
        updatedCount++
      }
    }
    if (batchModified) {
      if (batch.status === 'running') {
        batch.status = 'interrupted'
      }
      await saveBatchQueue(batch, storagePath)
    }
  }

  return { reconciledJobs: updatedCount }
}

/**
 * Enqueues a new batch of generation/processing jobs with budget pre-flight verification.
 */
export async function enqueueBatch(params, storagePath) {
  const {
    name = 'Unnamed Batch',
    items = [],
    concurrency = 2,
    maxBudget = Infinity,
  } = params

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Batch requires a non-empty array of items')
  }

  // Pre-calculate total estimated cost
  let totalEstimatedCost = 0
  const preparedItems = items.map((item, idx) => {
    const cost = typeof item.estimatedCost === 'number' ? item.estimatedCost : 0.02
    totalEstimatedCost += cost
    return {
      id: item.id || `item_${idx + 1}`,
      tool: item.tool || 'generate_image',
      params: item.params || {},
      estimatedCost: cost,
      status: 'queued',
      createdAt: new Date().toISOString(),
    }
  })

  if (totalEstimatedCost > maxBudget) {
    throw new Error(
      `Batch estimated cost ($${totalEstimatedCost.toFixed(3)}) exceeds allowed budget limit ($${maxBudget.toFixed(3)}). Pre-flight rejected.`
    )
  }

  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const batch = {
    batchId,
    name,
    status: 'queued',
    concurrency: Math.max(1, Math.min(10, concurrency)),
    totalEstimatedCost,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: preparedItems,
  }

  await saveBatchQueue(batch, storagePath)
  return batch
}

/**
 * Computes progress summary for a batch.
 */
export function getBatchProgress(batch) {
  if (!batch || !Array.isArray(batch.items)) {
    return { total: 0, completed: 0, failed: 0, queued: 0, running: 0, cancelled: 0, percent: 0 }
  }

  const items = batch.items
  const total = items.length
  const completed = items.filter((i) => i.status === 'succeeded').length
  const failed = items.filter((i) => i.status === 'failed').length
  const running = items.filter((i) => i.status === 'running').length
  const queued = items.filter((i) => i.status === 'queued').length
  const cancelled = items.filter((i) => i.status === 'cancelled').length
  const interrupted = items.filter((i) => i.status === 'interrupted').length

  const percent = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0

  return {
    total,
    completed,
    failed,
    running,
    queued,
    cancelled,
    interrupted,
    percent,
  }
}

/**
 * Cancels an entire batch or specific item.
 */
export async function cancelBatch(batchId, itemId = null, storagePath) {
  return await withQueueLock(storagePath, async () => {
    const filePath = getQueueStoragePath(storagePath)
    const queues = readQueuesSync(filePath)
    const batch = queues.find((b) => b.batchId === batchId)
    if (!batch) {
      return { ok: false, error: `Batch "${batchId}" not found` }
    }

    const timestamp = new Date().toISOString()

    if (itemId) {
      const item = batch.items.find((i) => i.id === itemId)
      if (!item) return { ok: false, error: `Item "${itemId}" not found in batch` }
      if (item.status === 'queued') {
        item.status = 'cancelled'
        item.cancelledAt = timestamp
      }
    } else {
      batch.status = 'cancelled'
      for (const it of batch.items) {
        if (it.status === 'queued') {
          it.status = 'cancelled'
          it.cancelledAt = timestamp
        }
      }
    }

    batch.updatedAt = timestamp
    await writeQueuesAtomic(filePath, queues)
    return { ok: true, batchId, status: batch.status, progress: getBatchProgress(batch) }
  })
}

/**
 * Resets failed items in a batch back to 'queued'.
 */
export async function retryFailedBatchItems(batchId, targetItemIds = null, storagePath) {
  return await withQueueLock(storagePath, async () => {
    const filePath = getQueueStoragePath(storagePath)
    const queues = readQueuesSync(filePath)
    const batch = queues.find((b) => b.batchId === batchId)
    if (!batch) {
      return { ok: false, error: `Batch "${batchId}" not found` }
    }

    let resetCount = 0
    for (const it of batch.items) {
      if (it.status === 'failed' || it.status === 'interrupted') {
        if (!targetItemIds || targetItemIds.includes(it.id)) {
          it.status = 'queued'
          it.error = null
          it.interruptedAt = null
          resetCount++
        }
      }
    }

    if (resetCount > 0) {
      batch.status = 'queued'
      batch.updatedAt = new Date().toISOString()
      await writeQueuesAtomic(filePath, queues)
    }

    return { ok: true, resetCount, progress: getBatchProgress(batch) }
  })
}

/**
 * Processes queued items with a real bounded-concurrency worker pool (#554).
 * Item claims and completions are serialized under the queue lock so parallel
 * workers never overwrite each other's state; cancellation is honored between
 * item claims.
 */
export async function processBatchItems(batchId, executorFn, storagePath) {
  let batch = await getBatchQueue(batchId, storagePath)
  if (!batch) throw new Error(`Batch "${batchId}" not found`)

  batch.status = 'running'
  await saveBatchQueue(batch, storagePath)

  const concurrency = Math.max(1, Math.min(10, Number(batch.concurrency) || 2))

  // Claim the next queued item atomically under the lock; null when exhausted/cancelled
  const claimNextItem = async () => {
    return await withQueueLock(storagePath, async () => {
      const filePath = getQueueStoragePath(storagePath)
      const queues = readQueuesSync(filePath)
      const current = queues.find((b) => b.batchId === batchId)
      if (!current || current.status === 'cancelled') return null
      const next = (current.items || []).find((i) => i.status === 'queued')
      if (!next) return null
      next.status = 'running'
      next.startedAt = new Date().toISOString()
      await writeQueuesAtomic(filePath, queues)
      return next
    })
  }

  // Persist terminal item state under the lock
  const completeItem = async (item) => {
    await withQueueLock(storagePath, async () => {
      const filePath = getQueueStoragePath(storagePath)
      const queues = readQueuesSync(filePath)
      const current = queues.find((b) => b.batchId === batchId)
      if (!current) return
      const idx = (current.items || []).findIndex((i) => i.id === item.id)
      if (idx >= 0) current.items[idx] = item
      await writeQueuesAtomic(filePath, queues)
    })
  }

  const worker = async () => {
    for (;;) {
      const item = await claimNextItem()
      if (!item) return
      try {
        const res = await executorFn(item.tool, item.params)
        item.status = 'succeeded'
        item.result = res
        item.completedAt = new Date().toISOString()
      } catch (err) {
        item.status = 'failed'
        item.error = err.message
        item.completedAt = new Date().toISOString()
      }
      await completeItem(item)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const finalBatch = await getBatchQueue(batchId, storagePath)
  const finalProgress = getBatchProgress(finalBatch || batch)
  if (finalProgress.queued === 0 && finalProgress.running === 0) {
    finalBatch.status = finalProgress.failed > 0 ? 'completed_with_errors' : 'completed'
  }
  finalBatch.updatedAt = new Date().toISOString()
  await saveBatchQueue(finalBatch, storagePath)

  return {
    ok: true,
    batchId,
    status: finalBatch.status,
    progress: getBatchProgress(finalBatch),
  }
}
