// lib/loop-guard.js
// Fail-fast loop guard protecting against runaway agent retry loops (#168)

/** In-memory session tracking map: sessionId -> { count: number, lastPrompt: string, lastTimestamp: number } */
const sessionStates = new Map()

/** Default maximum consecutive generations without user interaction */
export const DEFAULT_MAX_CONSECUTIVE_GENERATIONS = 3

/**
 * Checks and records a generation turn for a session.
 *
 * @param {string} sessionId - Conversation session identifier
 * @param {Object} options
 * @param {number} [options.limit=3] - Maximum allowed calls
 * @param {string} [options.prompt=''] - Current prompt
 * @param {boolean} [options.isUserTurn=false] - Whether the user just submitted a turn (resets counter)
 * @throws {Error} If consecutive generation limit is exceeded.
 */
export function trackAndAssertLoopGuard(sessionId, {
  limit = DEFAULT_MAX_CONSECUTIVE_GENERATIONS,
  prompt = '',
  isUserTurn = false,
} = {}) {
  const sid = String(sessionId || 'default_session')

  if (isUserTurn) {
    sessionStates.delete(sid)
    return { count: 0, allowed: true }
  }

  // A limit of 0 explicitly disables loop guard protection
  if (limit === 0 || limit === '0') {
    return { count: 0, remaining: Infinity, allowed: true }
  }

  const current = sessionStates.get(sid) || { count: 0, lastPrompt: '', lastTimestamp: 0 }
  const maxLimit = Math.max(1, Number(limit) || DEFAULT_MAX_CONSECUTIVE_GENERATIONS)

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
 * Resets loop guard counter for a session.
 */
export function resetLoopGuard(sessionId) {
  const sid = String(sessionId || 'default_session')
  sessionStates.delete(sid)
}

/**
 * Gets current state for debugging/testing.
 */
export function getLoopGuardState(sessionId) {
  const sid = String(sessionId || 'default_session')
  return sessionStates.get(sid) || { count: 0, lastPrompt: '', lastTimestamp: 0 }
}
