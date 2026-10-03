// lib/live-progress.js — Live progress event hub & presentation transport (#147, #329, #379)

import { isTrustedLocalRequest } from './security.js'

const activeSessions = new Map()

/**
 * Creates or resets a live progress session for a tool call.
 *
 * @param {string} callId
 * @param {{ signal?: AbortSignal, onProgress?: Function }} [options]
 * @returns {object}
 */
export function createLiveProgressSession(callId, options = {}) {
  if (!callId) return null
  const existing = activeSessions.get(callId)
  const listeners = existing?.listeners ? existing.listeners : new Set()

  if (typeof options.onProgress === 'function') {
    listeners.add(options.onProgress)
  }

  const session = {
    callId,
    stage: 'Starting...',
    step: undefined,
    progress: undefined,
    draftUrl: undefined,
    done: false,
    error: undefined,
    timestamp: Date.now(),
    listeners,
  }

  if (options.signal) {
    options.signal.addEventListener(
      'abort',
      () => {
        abortLiveProgress(callId, 'Execution aborted')
      },
      { once: true },
    )
  }

  activeSessions.set(callId, session)
  return session
}

/**
 * Publishes an incremental update to a live progress session.
 *
 * @param {string} callId
 * @param {{ stage?: string, step?: string, progress?: number, draftUrl?: string }} update
 */
export function publishLiveProgress(callId, update = {}) {
  if (!callId) return
  let session = activeSessions.get(callId)
  if (!session) {
    session = createLiveProgressSession(callId)
  }
  if (session.done) return

  if (update.stage !== undefined) session.stage = update.stage
  if (update.step !== undefined) session.step = update.step
  if (update.progress !== undefined) {
    session.progress = typeof update.progress === 'number'
      ? Math.min(100, Math.max(0, Math.round(update.progress)))
      : undefined
  }
  if (update.draftUrl !== undefined) session.draftUrl = update.draftUrl
  session.timestamp = Date.now()

  const payload = {
    callId,
    stage: session.stage,
    step: session.step,
    progress: session.progress,
    draftUrl: session.draftUrl,
    done: false,
  }

  for (const listener of session.listeners) {
    try {
      listener(payload)
    } catch (_err) {
      // Listener notification failure ignored
    }
  }
}

/**
 * Marks a session as complete and notifies subscribers.
 *
 * @param {string} callId
 * @param {object} [finalData]
 */
export function completeLiveProgress(callId, finalData = {}) {
  if (!callId) return
  const session = activeSessions.get(callId)
  if (!session || session.done) return

  session.done = true
  session.stage = 'Complete'
  session.progress = 100
  session.timestamp = Date.now()

  const payload = {
    callId,
    stage: 'Complete',
    progress: 100,
    draftUrl: session.draftUrl,
    done: true,
    ...finalData,
  }

  for (const listener of session.listeners) {
    try {
      listener(payload)
    } catch (_err) {
      // Listener notification failure ignored
    }
  }
  session.listeners.clear()

  // Retain briefly for trailing SSE disconnects, then purge
  setTimeout(() => {
    activeSessions.delete(callId)
  }, 15000)
}

/**
 * Marks a session as aborted or errored.
 *
 * @param {string} callId
 * @param {string} [reason]
 */
export function abortLiveProgress(callId, reason = 'Cancelled') {
  if (!callId) return
  const session = activeSessions.get(callId)
  if (!session || session.done) return

  session.done = true
  session.error = reason
  session.timestamp = Date.now()

  const payload = {
    callId,
    error: reason,
    done: true,
  }

  for (const listener of session.listeners) {
    try {
      listener(payload)
    } catch (_err) {
      // Listener notification failure ignored
    }
  }
  session.listeners.clear()

  setTimeout(() => {
    activeSessions.delete(callId)
  }, 10000)
}

/**
 * Returns current snapshot of a live progress session.
 *
 * @param {string} callId
 * @returns {object|null}
 */
export function getLiveProgress(callId) {
  if (!callId) return null
  const session = activeSessions.get(callId)
  if (!session) return null
  return {
    callId: session.callId,
    stage: session.stage,
    step: session.step,
    progress: session.progress,
    draftUrl: session.draftUrl,
    done: session.done,
    error: session.error,
  }
}

/**
 * Subscribes a listener to progress events for a callId.
 * Calls listener with current state immediately if present.
 *
 * @param {string} callId
 * @param {Function} listener
 * @returns {Function} unsubscribe
 */
export function subscribeLiveProgress(callId, listener) {
  if (!callId || typeof listener !== 'function') return () => {}
  let session = activeSessions.get(callId)
  if (!session) {
    session = createLiveProgressSession(callId)
  }

  session.listeners.add(listener)

  // Initial event replay
  listener({
    callId: session.callId,
    stage: session.stage,
    step: session.step,
    progress: session.progress,
    draftUrl: session.draftUrl,
    done: session.done,
    error: session.error,
  })

  return () => {
    session.listeners.delete(listener)
  }
}

/**
 * Registers the /dsh-image-gen/live-events SSE route on DSH web server.
 *
 * @param {object} ctx cordis context
 */
export function registerLiveProgressRoutes(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/live-events',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'GET only' }))
        return
      }
      if (!isTrustedLocalRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }

      const u = new URL(req.url, 'http://localhost')
      const callId = u.searchParams.get('callId') || ''
      if (!callId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'callId query parameter required' }))
        return
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })

      res.write(': connected\n\n')

      const unsubscribe = subscribeLiveProgress(callId, (data) => {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`)
          if (data.done) {
            setTimeout(() => {
              try {
                res.end()
              } catch (_err) {
                // Response end failure ignored
              }
            }, 300)
          }
        } catch (_err) {
          // SSE write failure ignored
        }
      })

      req.on('close', () => {
        unsubscribe()
      })
    },
  }), 'dsh-image-gen: live events route')
}
