// lib/live-progress.js — Live progress event hub & presentation transport (#147, #329, #379, #555)

import { isTrustedLocalRequest, getRouteRejectionStatus, getConnection, safeJsonHandler } from './security.js'

const activeSessions = new Map()

/**
 * #555: early (pre-session) subscribers are held in a bounded, TTL-scoped
 * pending map instead of materializing an activeSessions entry for any
 * arbitrary callId — unknown callIds no longer leak permanent memory, while
 * the #379 guarantee (early subscribers survive session initialization)
 * is preserved when the session is actually created.
 */
const pendingSubscribers = new Map()
const PENDING_SUBSCRIBER_TTL_MS = 30000
const PENDING_SUBSCRIBER_MAX = 200

/** #555: hard cap on tracked sessions; oldest entries are purged beyond it */
const MAX_ACTIVE_SESSIONS = 500

/** #555: sessions without updates for this long are swept as stale */
const STALE_SESSION_TTL_MS = 10 * 60 * 1000

function absorbPendingSubscribers(callId, listeners) {
  const pending = pendingSubscribers.get(callId)
  if (pending) {
    const absorbed = [...pending.listeners]
    for (const listener of absorbed) {
      listeners.add(listener)
    }
    pendingSubscribers.delete(callId)
    // Give newly absorbed early subscribers the same initial replay they would
    // have received if the session had already existed at subscribe time
    const snapshot = {
      callId,
      stage: 'Starting...',
      step: undefined,
      progress: undefined,
      draftUrl: undefined,
      done: false,
      error: undefined,
    }
    for (const listener of absorbed) {
      try { listener(snapshot) } catch (_err) { /* ignored */ }
    }
  }
}

function schedulePendingCleanup(callId) {
  const timer = setTimeout(() => {
    const pending = pendingSubscribers.get(callId)
    if (pending && Date.now() - pending.createdAt >= PENDING_SUBSCRIBER_TTL_MS - 50) {
      pendingSubscribers.delete(callId)
    }
  }, PENDING_SUBSCRIBER_TTL_MS)
  if (typeof timer.unref === 'function') timer.unref()
  return timer
}

function capActiveSessions() {
  if (activeSessions.size < MAX_ACTIVE_SESSIONS) return
  // Prefer purging finished sessions first, then the oldest entries
  for (const [id, session] of activeSessions) {
    if (activeSessions.size < MAX_ACTIVE_SESSIONS) break
    if (session.done) activeSessions.delete(id)
  }
  while (activeSessions.size >= MAX_ACTIVE_SESSIONS) {
    const oldestKey = activeSessions.keys().next().value
    if (oldestKey === undefined) break
    activeSessions.delete(oldestKey)
  }
}

/**
 * #555: periodic sweep — sessions that never completed and stopped receiving
 * updates are closed and purged, bounding memory against orphaned callIds.
 */
const sweepTimer = setInterval(() => {
  const now = Date.now()
  for (const [id, session] of activeSessions) {
    if (session.done) continue
    if (now - session.timestamp > STALE_SESSION_TTL_MS) {
      session.done = true
      session.error = 'Progress session timed out'
      const payload = { callId: id, error: session.error, done: true }
      for (const listener of session.listeners) {
        try { listener(payload) } catch (_err) { /* ignored */ }
      }
      session.listeners.clear()
      activeSessions.delete(id)
    }
  }
  for (const [id, pending] of pendingSubscribers) {
    if (now - pending.createdAt > PENDING_SUBSCRIBER_TTL_MS * 2) {
      pendingSubscribers.delete(id)
    }
  }
}, 60000)
if (typeof sweepTimer.unref === 'function') sweepTimer.unref()

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
  absorbPendingSubscribers(callId, listeners)

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

  capActiveSessions()
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
  if (!session || session.done) return

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
 * #555: bounded-memory diagnostics for tests and monitoring.
 */
export function getLiveProgressStats() {
  return {
    activeSessions: activeSessions.size,
    pendingSubscribers: pendingSubscribers.size,
  }
}

/**
 * Subscribes a listener to progress events for a callId.
 * Calls listener with current state immediately if present.
 *
 * #555: subscribing to an unknown callId no longer materializes an
 * activeSessions entry — the listener is parked in a bounded TTL map and
 * re-attached automatically when the session appears (#379 preserved).
 *
 * @param {string} callId
 * @param {Function} listener
 * @returns {Function} unsubscribe
 */
export function subscribeLiveProgress(callId, listener) {
  if (!callId || typeof listener !== 'function') return () => {}

  const session = activeSessions.get(callId)
  if (session) {
    session.listeners.add(listener)
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

  // Unknown callId: park the subscriber with a TTL, deliver an empty snapshot
  let pending = pendingSubscribers.get(callId)
  if (!pending) {
    pending = { listeners: new Set(), createdAt: Date.now() }
    pendingSubscribers.set(callId, pending)
    schedulePendingCleanup(callId)
  }
  // Bound total parked subscribers
  if (pendingSubscribers.size > PENDING_SUBSCRIBER_MAX) {
    const oldestKey = pendingSubscribers.keys().next().value
    if (oldestKey !== undefined) pendingSubscribers.delete(oldestKey)
  }
  pending.listeners.add(listener)

  listener({ callId, stage: undefined, step: undefined, progress: undefined, draftUrl: undefined, done: false, exists: false })

  return () => {
    const p = pendingSubscribers.get(callId)
    if (p) {
      p.listeners.delete(listener)
      if (p.listeners.size === 0) pendingSubscribers.delete(callId)
    } else {
      const s = activeSessions.get(callId)
      if (s) s.listeners.delete(listener)
    }
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
    handler: safeJsonHandler(async (req, res) => {
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
      const sseRejection = getRouteRejectionStatus(req, { connection: getConnection(ctx) })
      if (sseRejection !== undefined) {
        res.writeHead(sseRejection, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: sseRejection === 401 ? 'unauthorized' : 'forbidden' }))
        return
      }

      const u = new URL(req.url, 'http://localhost')
      const callId = u.searchParams.get('callId') || ''
      if (!callId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'callId query parameter required' }))
        return
      }

      // #555: no wildcard CORS — the SSE stream is same-origin only (loopback
      // trusted clients already enforced above); EventSource does not need ACAO
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      })

      res.write(': connected\n\n')

      const current = getLiveProgress(callId)
      if (current) {
        try {
          res.write(`data: ${JSON.stringify(current)}\n\n`)
        } catch (_err) {
          // Ignore stream write failure on initial snapshot replay (#429)
        }
      }

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
    }, ctx),
  }), 'dsh-image-gen: live events route')
}
