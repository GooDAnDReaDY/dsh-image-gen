// @ts-check
// async-task-manager.js — async image generation task management and polling pipeline (#460).
import { EventEmitter } from 'node:events'

export const TASK_STATUSES = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
}

class AsyncTaskRegistry extends EventEmitter {
  constructor() {
    super()
    /** @type {Map<string, object>} */
    this.tasks = new Map()
    this.maxRetained = 200
  }

  /**
   * Creates and registers a new async task.
   */
  createTask({ prompt, params = {}, session = null }) {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()
    const task = {
      id,
      prompt,
      params,
      sessionId: session?.id || session?.header?.id || 'session',
      status: TASK_STATUSES.QUEUED,
      stage: 'Queued in generation pipeline',
      progress: 0,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
    }

    if (this.tasks.size >= this.maxRetained) {
      // Evict oldest completed/failed tasks
      const oldestKey = this.tasks.keys().next().value
      if (oldestKey) this.tasks.delete(oldestKey)
    }

    this.tasks.set(id, task)
    this.emit('task:created', task)
    return task
  }

  getTask(id) {
    return this.tasks.get(id) || null
  }

  updateTask(id, updates = {}) {
    const task = this.tasks.get(id)
    if (!task) return null

    Object.assign(task, updates)
    this.emit('task:updated', task)
    return task
  }

  cancelTask(id) {
    const task = this.tasks.get(id)
    if (!task) return null

    if (task.status === TASK_STATUSES.QUEUED || task.status === TASK_STATUSES.PROCESSING) {
      task.status = TASK_STATUSES.CANCELLED
      task.stage = 'Cancelled by user'
      task.completedAt = new Date().toISOString()
      this.emit('task:cancelled', task)
    }
    return task
  }

  /**
   * Executes runner function in background and updates task state.
   */
  runBackgroundTask(id, runnerFn) {
    const task = this.tasks.get(id)
    if (!task) return

    task.status = TASK_STATUSES.PROCESSING
    task.startedAt = new Date().toISOString()
    task.stage = 'Starting generation worker'
    this.emit('task:started', task)

    const onProgress = (update) => {
      if (task.status === TASK_STATUSES.CANCELLED) return
      if (typeof update === 'number') {
        task.progress = Math.min(100, Math.max(0, Math.round(update)))
      } else if (update && typeof update === 'object') {
        if (typeof update.progress === 'number') {
          task.progress = Math.min(100, Math.max(0, Math.round(update.progress)))
        }
        if (update.stage) task.stage = String(update.stage)
      }
      this.emit('task:progress', task)
    }

    // Launch asynchronously without awaiting
    Promise.resolve().then(async () => {
      try {
        const result = await runnerFn(onProgress)
        if (task.status === TASK_STATUSES.CANCELLED) return

        task.status = TASK_STATUSES.COMPLETED
        task.progress = 100
        task.stage = 'Generation completed'
        task.completedAt = new Date().toISOString()
        task.result = result
        this.emit('task:completed', task)
      } catch (err) {
        if (task.status === TASK_STATUSES.CANCELLED) return

        task.status = TASK_STATUSES.FAILED
        task.stage = 'Generation failed'
        task.completedAt = new Date().toISOString()
        task.error = err.message || String(err)
        this.emit('task:failed', task)
      }
    })
  }

  /**
   * Polls a task until completion or timeout with exponential backoff.
   */
  async pollTaskWithBackoff(id, options = {}) {
    const {
      timeoutMs = 120000,
      initialIntervalMs = 250,
      maxIntervalMs = 2500,
      multiplier = 1.5,
      signal = null,
    } = options

    const start = Date.now()
    let currentInterval = initialIntervalMs

    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) {
        throw new Error('Task polling aborted')
      }

      const task = this.getTask(id)
      if (!task) {
        throw new Error(`Task "${id}" not found`)
      }

      if (task.status === TASK_STATUSES.COMPLETED) {
        return task
      }
      if (task.status === TASK_STATUSES.FAILED) {
        throw new Error(`Async generation task failed: ${task.error}`)
      }
      if (task.status === TASK_STATUSES.CANCELLED) {
        throw new Error(`Async generation task was cancelled`)
      }

      // Wait interval
      await new Promise((resolve) => setTimeout(resolve, currentInterval))
      currentInterval = Math.min(maxIntervalMs, Math.round(currentInterval * multiplier))
    }

    const currentTask = this.getTask(id)
    return {
      ...currentTask,
      timedOut: true,
      message: `Polling timed out after ${Math.round(timeoutMs / 1000)}s; task is still running in background.`,
    }
  }

  clear() {
    this.tasks.clear()
  }
}

export const defaultTaskRegistry = new AsyncTaskRegistry()

