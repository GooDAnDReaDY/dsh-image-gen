import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Resilient Batch Queue & Job Reconciliation (#437)
 * Provides persistent queuing for image generation & processing series,
 * with concurrency throttling, budget pre-checks, cancellation, and restart recovery.
 */

export function getQueueStoragePath(customPath) {
  if (customPath) return customPath
  if (process.env.DSH_BATCH_QUEUE_PATH) return process.env.DSH_BATCH_QUEUE_PATH
  const home = os.homedir() || '/tmp'
  return path.join(home, '.dsh', 'dsh-image-gen', 'batch-queue.json')
}

export function loadBatchQueues(storagePath) {
  const filePath = getQueueStoragePath(storagePath)
  try {
    if (!fs.existsSync(filePath)) return []
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    return []
  }
}

export function saveBatchQueue(batch, storagePath) {
  const filePath = getQueueStoragePath(storagePath)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const existing = loadBatchQueues(storagePath)
  const index = existing.findIndex((b) => b.batchId === batch.batchId)
  if (index >= 0) {
    existing[index] = batch
  } else {
    existing.push(batch)
  }
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8')
  return batch
}

export function getBatchQueue(batchId, storagePath) {
  const queues = loadBatchQueues(storagePath)
  return queues.find((b) => b.batchId === batchId) || null
}

/**
 * Startup reconciliation (#437):
 * Interrupted jobs (stuck in 'running' during crash/restart) are marked 'interrupted'
 * and NEVER blindly retried without explicit user confirmation.
 */
export function reconcileQueueOnStartup(storagePath) {
  const queues = loadBatchQueues(storagePath)
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
      saveBatchQueue(batch, storagePath)
    }
  }

  return { reconciledJobs: updatedCount }
}

/**
 * Enqueues a new batch of generation/processing jobs with budget pre-flight verification.
 */
export function enqueueBatch(params, storagePath) {
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

  saveBatchQueue(batch, storagePath)
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
export function cancelBatch(batchId, itemId = null, storagePath) {
  const batch = getBatchQueue(batchId, storagePath)
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
  saveBatchQueue(batch, storagePath)
  return { ok: true, batchId, status: batch.status, progress: getBatchProgress(batch) }
}

/**
 * Resets failed items in a batch back to 'queued'.
 */
export function retryFailedBatchItems(batchId, targetItemIds = null, storagePath) {
  const batch = getBatchQueue(batchId, storagePath)
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
    saveBatchQueue(batch, storagePath)
  }

  return { ok: true, resetCount, progress: getBatchProgress(batch) }
}

/**
 * Processes queued items with concurrency limits using the supplied executor.
 */
export async function processBatchItems(batchId, executorFn, storagePath) {
  const batch = getBatchQueue(batchId, storagePath)
  if (!batch) throw new Error(`Batch "${batchId}" not found`)

  batch.status = 'running'
  saveBatchQueue(batch, storagePath)

  const concurrency = batch.concurrency || 2
  let runningCount = 0

  const queuedItems = batch.items.filter((i) => i.status === 'queued')

  for (const item of queuedItems) {
    // Check if batch was cancelled while processing
    const currentBatch = getBatchQueue(batchId, storagePath)
    if (currentBatch?.status === 'cancelled') {
      break
    }

    item.status = 'running'
    item.startedAt = new Date().toISOString()
    saveBatchQueue(batch, storagePath)

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

    saveBatchQueue(batch, storagePath)
  }

  const finalProgress = getBatchProgress(batch)
  if (finalProgress.queued === 0 && finalProgress.running === 0) {
    batch.status = finalProgress.failed > 0 ? 'completed_with_errors' : 'completed'
  }
  batch.updatedAt = new Date().toISOString()
  saveBatchQueue(batch, storagePath)

  return {
    ok: true,
    batchId,
    status: batch.status,
    progress: getBatchProgress(batch),
  }
}
