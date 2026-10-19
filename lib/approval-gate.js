// lib/approval-gate.js — Interactive generation approval gate & coordinator (#450)

import { isTrustedLocalRequest, getRouteRejectionStatus, getRouteWriteRejectionStatus } from './security.js'
import { readBoundedRequestBody } from './vault.js'

const MAX_APPROVAL_BODY_BYTES = 64 * 1024 // 64 KB
const activeApprovals = new Map()

/**
 * Creates an in-flight approval gate for billable generation calls.
 *
 * @param {object} options
 * @param {string} options.callId
 * @param {object} options.plan Task plan details (prompt, provider, model, size, estimatedCost, count)
 * @param {number} [options.timeoutSec=120] Timeout in seconds
 * @param {AbortSignal} [options.signal] Optional cancellation signal
 * @returns {object}
 */
export function createApprovalGate(options = {}) {
  const {
    callId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    plan = {},
    timeoutSec = 120,
    signal,
  } = options

  let resolver
  let rejecter
  let timeoutTimer
  let signalHandler
  let status = 'pending' // 'pending' | 'approved' | 'rejected' | 'timeout'

  const promise = new Promise((resolve, reject) => {
    resolver = resolve
    rejecter = reject
  })
  // Suppress unhandledRejection if wait() is attached asynchronously
  promise.catch(() => {})

  function cleanup() {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      timeoutTimer = null
    }
    if (signal && signalHandler) {
      try { signal.removeEventListener('abort', signalHandler) } catch (_) { /* ignore */ }
      signalHandler = null
    }
    activeApprovals.delete(callId)
  }

  function approve(meta = {}) {
    if (status !== 'pending') return false
    status = 'approved'
    cleanup()
    resolver({ approved: true, callId, meta, timestamp: Date.now() })
    return true
  }

  function reject(reason = 'Image generation cancelled by user') {
    if (status !== 'pending') return false
    status = 'rejected'
    cleanup()
    const err = new Error(reason)
    err.code = 'APPROVAL_REJECTED'
    rejecter(err)
    return true
  }

  function timeout() {
    if (status !== 'pending') return false
    status = 'timeout'
    cleanup()
    const err = new Error(`Image generation approval timed out after ${timeoutSec}s waiting for user confirmation`)
    err.code = 'APPROVAL_TIMEOUT'
    rejecter(err)
    return true
  }

  const effectiveTimeoutSec = Math.max(1, Math.min(600, Number(timeoutSec) || 120))
  timeoutTimer = setTimeout(timeout, effectiveTimeoutSec * 1000)

  if (signal) {
    if (signal.aborted) {
      status = 'rejected'
      cleanup()
      const err = new Error('Image generation approval aborted by signal')
      err.code = 'APPROVAL_ABORTED'
      rejecter(err)
    } else {
      signalHandler = () => {
        status = 'rejected'
        cleanup()
        const err = new Error('Image generation approval aborted by signal')
        err.code = 'APPROVAL_ABORTED'
        rejecter(err)
      }
      try { signal.addEventListener('abort', signalHandler, { once: true }) } catch (_) { /* ignore */ }
    }
  }

  const gate = {
    callId,
    plan,
    get status() { return status },
    timeoutSec: effectiveTimeoutSec,
    createdAt: Date.now(),
    wait: () => promise,
    approve,
    reject,
  }

  activeApprovals.set(callId, gate)
  return gate
}

export function registerApprovalRequest(callId, gate) {
  if (!callId || !gate) return
  activeApprovals.set(callId, gate)
}

export function getApprovalRequest(callId) {
  if (!callId) return null
  return activeApprovals.get(callId) || null
}

export function approveApprovalRequest(callId, meta = {}) {
  const gate = getApprovalRequest(callId)
  if (!gate) return false
  return gate.approve(meta)
}

export function rejectApprovalRequest(callId, reason) {
  const gate = getApprovalRequest(callId)
  if (!gate) return false
  return gate.reject(reason)
}

export function listPendingApprovals() {
  const list = []
  for (const [callId, gate] of activeApprovals.entries()) {
    list.push({
      callId,
      plan: gate.plan,
      status: gate.status,
      timeoutSec: gate.timeoutSec,
      createdAt: gate.createdAt,
    })
  }
  return list
}

export function clearAllApprovals() {
  for (const gate of activeApprovals.values()) {
    try { gate.reject('Approval gate cleared') } catch (_) { /* ignore */ }
  }
  activeApprovals.clear()
}

/**
 * Registers /dsh-image-gen/approval route on cordis web server.
 *
 * @param {object} ctx
 */
export function registerApprovalRoutes(ctx) {
  if (!ctx || !ctx.webServer) return

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/approval',
    handler: async (req, res) => {
      if (!isTrustedLocalRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'forbidden' }))
        return
      }

      if (req.method === 'GET') {
        const rejection = getRouteRejectionStatus(req, { connection: ctx?.connection })
        if (rejection !== undefined) {
          res.writeHead(rejection, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' }))
          return
        }

        const u = new URL(req.url, 'http://localhost')
        const callId = u.searchParams.get('callId')
        if (callId) {
          const gate = getApprovalRequest(callId)
          if (!gate) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Approval request not found or expired' }))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: true,
            callId,
            plan: gate.plan,
            status: gate.status,
            timeoutSec: gate.timeoutSec,
          }))
          return
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, approvals: listPendingApprovals() }))
        return
      }

      if (req.method === 'POST') {
        const writeRejection = getRouteWriteRejectionStatus(req, { connection: ctx?.connection })
        if (writeRejection !== undefined) {
          res.writeHead(writeRejection, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: writeRejection === 401 ? 'unauthorized' : 'forbidden' }))
          return
        }

        const u = new URL(req.url, 'http://localhost')
        let callId = u.searchParams.get('callId')
        let action = u.searchParams.get('action')
        let reason = u.searchParams.get('reason')

        if (!callId || !action) {
          try {
            const buf = await readBoundedRequestBody(req, MAX_APPROVAL_BODY_BYTES)
            if (buf && buf.length > 0) {
              const body = JSON.parse(buf.toString('utf-8'))
              if (body) {
                callId = callId || body.callId
                action = action || body.action
                reason = reason || body.reason
              }
            }
          } catch (_) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Invalid JSON request body' }))
            return
          }
        }

        if (!callId) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'callId parameter required' }))
          return
        }

        if (action === 'approve') {
          const success = approveApprovalRequest(callId)
          if (!success) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Approval request not found, already resolved, or timed out' }))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, status: 'approved', callId }))
          return
        }

        if (action === 'reject' || action === 'cancel') {
          const success = rejectApprovalRequest(callId, reason || 'Image generation cancelled by user')
          if (!success) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Approval request not found, already resolved, or timed out' }))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, status: 'rejected', callId }))
          return
        }

        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Invalid action. Must be "approve" or "reject"' }))
        return
      }

      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
    },
  }), 'dsh-image-gen: approval route')
}

