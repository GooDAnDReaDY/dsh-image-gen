// lib/loop-guard.js
// Fail-fast loop guard protecting against runaway agent retry loops (#168, #370)
// Paid provider-call guard for fan-out tools (#544)

/** In-memory session tracking map: sessionId -> { count: number, lastPrompt: string, lastTimestamp: number, lastTurnId: any } */
const sessionStates = new Map()

/** Paid provider-call tracking map (#544): sessionId -> { count: number, lastTurnId: any } */
const paidCallStates = new Map()

/** Default maximum consecutive generations without user interaction */
const DEFAULT_MAX_CONSECUTIVE_GENERATIONS = 3

/** Default maximum paid provider API calls per single user turn (#544) */
const DEFAULT_MAX_PROVIDER_CALLS_PER_TURN = 24

/**
 * Derives a stable turn identifier from exec context (#370).
 * @returns {any} turn identifier or null/undefined when unavailable
 */
function deriveTurnIdentifier(exec, turnId) {
  const session = exec?.agent?.session
  let derivedTurnId = turnId ?? exec?.turnId ?? exec?.agent?.turnId

  if (derivedTurnId === null || derivedTurnId === undefined) {
    const rawMessages = typeof session?.deriveMessages === 'function'
      ? session.deriveMessages()
      : (Array.isArray(session?.messages) ? session.messages : null)

    if (Array.isArray(rawMessages)) {
      const userMessages = rawMessages.filter(m => m && (m.role === 'user' || m.type === 'user'))
      if (userMessages.length > 0) {
        const lastUser = userMessages[userMessages.length - 1]
        derivedTurnId = lastUser.id ?? lastUser.turnId ?? `user_turn_${userMessages.length}`
      }
    }
  }

  if (derivedTurnId === null || derivedTurnId === undefined) {
    derivedTurnId = session?.lastUserMessageId ?? session?.lastMessageId ?? session?.turnId ?? null
  }

  return derivedTurnId
}

/**
 * Checks and records a generation turn for a session.
 *
 * @param {string} sessionId - Conversation session identifier
 * @param {Object} options
 * @param {number} [options.limit=3] - Maximum allowed calls
 * @param {string} [options.prompt=''] - Current prompt
 * @param {boolean} [options.isUserTurn=false] - Whether the user just submitted a turn (resets counter)
 * @param {any} [options.turnId=null] - Canonical turn / message identifier
 * @param {Object} [options.exec=null] - Tool execution context
 * @throws {Error} If consecutive generation limit is exceeded.
 */
export function trackAndAssertLoopGuard(sessionId, {
  limit = DEFAULT_MAX_CONSECUTIVE_GENERATIONS,
  prompt = '',
  isUserTurn = false,
  turnId = null,
  exec = null,
} = {}) {
  const sid = String(sessionId || 'default_session')

  if (isUserTurn) {
    sessionStates.delete(sid)
    paidCallStates.delete(sid)
    return { count: 0, allowed: true }
  }

  // A limit of 0 explicitly disables loop guard protection
  if (limit === 0 || limit === '0') {
    return { count: 0, remaining: Infinity, allowed: true }
  }

  const current = sessionStates.get(sid) || { count: 0, lastPrompt: '', lastTimestamp: 0, lastTurnId: null }
  const maxLimit = Math.max(1, Number(limit) || DEFAULT_MAX_CONSECUTIVE_GENERATIONS)

  // Derive turn identifier from turnId or exec context (#370)
  const derivedTurnId = deriveTurnIdentifier(exec, turnId)

  // If turn identifier changed, reset count for the new user turn
  if (derivedTurnId !== null && derivedTurnId !== undefined) {
    if (current.lastTurnId !== null && current.lastTurnId !== undefined && current.lastTurnId !== derivedTurnId) {
      current.count = 0
    }
    current.lastTurnId = derivedTurnId
  }

  if (current.count >= maxLimit) {
    throw new Error(
      `Generation loop limit reached (${current.count}/${maxLimit} consecutive generations). ` +
      `To prevent runaway API billing, please stop retrying and ask the user to clarify or confirm the image prompt.`
    )
  }

  current.count += 1
  current.lastPrompt = prompt
  current.lastTimestamp = Date.now()
  sessionStates.set(sid, current)

  return { count: current.count, remaining: maxLimit - current.count, allowed: true }
}

/**
 * Tracks a single paid provider API call within a user turn (#544).
 * Fan-out tools (matrices, sheets, packs, spritesheet frames) call this once per
 * billable provider invocation so a single agent turn cannot trigger an
 * unbounded number of charged requests.
 *
 * @param {string} sessionId - Conversation session identifier
 * @param {Object} options
 * @param {number} [options.limit=24] - Maximum paid provider calls per turn (0 disables)
 * @param {string} [options.label='provider call'] - Human-readable call description for the error message
 * @param {any} [options.turnId=null] - Canonical turn / message identifier
 * @param {Object} [options.exec=null] - Tool execution context
 * @throws {Error} If the per-turn provider call limit is exceeded.
 */
export function trackProviderCall(sessionId, {
  limit = DEFAULT_MAX_PROVIDER_CALLS_PER_TURN,
  label = 'provider call',
  turnId = null,
  exec = null,
} = {}) {
  const sid = String(sessionId || 'default_session')

  // A limit of 0 explicitly disables provider call protection
  if (limit === 0 || limit === '0') {
    return { count: 0, remaining: Infinity, allowed: true }
  }

  const derivedTurnId = deriveTurnIdentifier(exec, turnId)
  const current = paidCallStates.get(sid) || { count: 0, lastTurnId: null }

  if (derivedTurnId !== null && derivedTurnId !== undefined) {
    if (current.lastTurnId !== null && current.lastTurnId !== undefined && current.lastTurnId !== derivedTurnId) {
      current.count = 0
    }
    current.lastTurnId = derivedTurnId
  }

  const maxLimit = Math.max(1, Number(limit) || DEFAULT_MAX_PROVIDER_CALLS_PER_TURN)

  if (current.count >= maxLimit) {
    throw new Error(
      `Provider call limit reached (${current.count}/${maxLimit} paid provider calls in a single turn) while executing: ${label}. ` +
      `To prevent runaway API billing, reduce the fan-out size or ask the user to confirm further generation.`
    )
  }

  current.count += 1
  paidCallStates.set(sid, current)

  return { count: current.count, remaining: maxLimit - current.count, allowed: true }
}

/**
 * Resets loop guard counters for a session, or clears all session states if sessionId is omitted.
 */
export function resetLoopGuard(sessionId) {
  if (!sessionId) {
    sessionStates.clear()
    paidCallStates.clear()
    return
  }
  const sid = String(sessionId)
  sessionStates.delete(sid)
  paidCallStates.delete(sid)
}

/**
 * Gets current state for debugging/testing.
 */
export function getLoopGuardState(sessionId) {
  const sid = String(sessionId || 'default_session')
  return sessionStates.get(sid) || { count: 0, lastPrompt: '', lastTimestamp: 0, lastTurnId: null }
}

/**
 * Gets current paid provider-call state for debugging/testing (#544).
 */
export function getProviderCallState(sessionId) {
  const sid = String(sessionId || 'default_session')
  return paidCallStates.get(sid) || { count: 0, lastTurnId: null }
}
