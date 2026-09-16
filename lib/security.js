// lib/security.js
// Secure credential handling, 0600 file permissions, and token masking (#169)

import { chmodSync, existsSync } from 'node:fs'

/**
 * Masks sensitive API keys, leaving only the prefix/suffix.
 * E.g. "sk-proj-1234567890abcdef" -> "sk-p...cdef"
 */
export function maskApiKey(key) {
  if (!key || typeof key !== 'string') return ''
  const trimmed = key.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 8) return '********'
  return trimmed.slice(0, 4) + '...' + trimmed.slice(-4)
}

/**
 * Sanitizes arbitrary text, error messages, and URLs to remove authorization tokens.
 */
export function sanitizeErrorAndLogs(input) {
  if (!input) return ''
  let text = typeof input === 'string' ? input : (input.message || JSON.stringify(input))

  // Mask Bearer tokens
  text = text.replace(/Bearer\s+([a-zA-Z0-9_\-\.]{6,})/gi, (match, token) => {
    return `Bearer ${maskApiKey(token)}`
  })

  // Mask Key tokens
  text = text.replace(/Key\s+([a-zA-Z0-9_\-\.]{6,})/gi, (match, token) => {
    return `Key ${maskApiKey(token)}`
  })

  // Mask query params like ?key=... or &api_key=...
  text = text.replace(/([?&](?:api_)?key=)([^&\s]+)/gi, (match, prefix, val) => {
    return `${prefix}${maskApiKey(val)}`
  })

  // Mask raw sk-... tokens
  text = text.replace(/(sk-[a-zA-Z0-9_\-]{8,})/gi, (match, token) => {
    return maskApiKey(token)
  })

  // Mask Replicate tokens r8_...
  text = text.replace(/(r8_[a-zA-Z0-9_\-]{8,})/gi, (match, token) => {
    return maskApiKey(token)
  })

  // Mask Google Gemini API keys (starts with AIza and ~35-45 chars)
  text = text.replace(/(AIza[0-9A-Za-z\-_]{30,45})/g, (match, token) => {
    return maskApiKey(token)
  })

  return text
}

/**
 * Ensures strict 0600 file permissions on sensitive config/key files.
 */
export function enforceSecurePermissions(filePath) {
  if (!filePath || !existsSync(filePath)) return false
  try {
    chmodSync(filePath, 0o600)
    return true
  } catch {
    return false
  }
}
