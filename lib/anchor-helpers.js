// anchor-helpers.js — Character & Style Reference Anchor manager (#283).
// Maintains active visual identity and style reference across multi-turn sessions.

/**
 * In-memory registry of active visual anchors keyed by scopeId (e.g. session id).
 * Structure: Map<string, { image: string, label: string, mode: 'character'|'style', strength: number, updatedAt: string }>
 */
const sessionAnchors = new Map()

/**
 * Normalizes anchor strength between 0.1 and 1.0.
 *
 * @param {number|undefined} val
 * @returns {number}
 */
export function normalizeAnchorStrength(val) {
  if (typeof val !== 'number' || Number.isNaN(val)) return 0.65
  return Math.min(1.0, Math.max(0.1, Number(val.toFixed(2))))
}

/**
 * Sets or updates the active visual anchor for a given session or scope.
 *
 * @param {string} scopeId Session or workspace identifier
 * @param {object} data
 * @param {string} data.image Image URL, attachment ID (sha256:...), or local path
 * @param {string} [data.label] Human-readable description of character/style
 * @param {'character'|'style'} [data.mode='style']
 * @param {number} [data.strength=0.65]
 * @returns {object} The stored anchor record
 */
export function setSessionAnchor(scopeId, data = {}) {
  const key = String(scopeId || 'default')
  if (!data.image) {
    throw new Error('An anchor image (URL, path, or attachment ID) is required.')
  }

  const mode = data.mode === 'character' ? 'character' : 'style'
  const strength = normalizeAnchorStrength(data.strength)
  const label = String(data.label || (mode === 'character' ? 'Character Anchor' : 'Style Anchor')).trim()

  const anchor = {
    image: String(data.image).trim(),
    label,
    mode,
    strength,
    updatedAt: new Date().toISOString(),
  }

  sessionAnchors.set(key, anchor)
  return anchor
}

/**
 * Retrieves the currently active visual anchor for a session scope.
 *
 * @param {string} scopeId
 * @returns {object|null}
 */
export function getSessionAnchor(scopeId) {
  const key = String(scopeId || 'default')
  return sessionAnchors.get(key) || null
}

/**
 * Clears the active visual anchor for a session scope.
 *
 * @param {string} scopeId
 * @returns {boolean} True if an anchor was present and removed
 */
export function clearSessionAnchor(scopeId) {
  const key = String(scopeId || 'default')
  return sessionAnchors.delete(key)
}

/**
 * Clears all active anchors (for testing/cleanup).
 */
export function clearAllAnchors() {
  sessionAnchors.clear()
}

/**
 * Injects anchor reference hints into the prompt if an anchor is active and not already included.
 *
 * @param {object|null} anchor
 * @param {string} prompt
 * @returns {string}
 */
export function applyAnchorPromptHints(anchor, prompt) {
  if (!anchor || !anchor.label) return prompt
  const lower = prompt.toLowerCase()
  const labelLower = anchor.label.toLowerCase()

  // Avoid duplicate injection if user already mentioned the anchor label
  if (lower.includes(labelLower)) return prompt

  if (anchor.mode === 'character') {
    return `${prompt}, visual character anchor: ${anchor.label}, maintaining consistent facial features, costume, and physical identity`
  }

  return `${prompt}, visual style anchor: ${anchor.label}, maintaining consistent aesthetic palette, rendering technique, and lighting`
}
