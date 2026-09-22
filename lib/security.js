// lib/security.js
// Secure credential handling, 0600 file permissions, and token masking (#169)
// Address validation and trusted request guards against DNS rebinding & cross-site leaks (Refs: GitHub #1, #280, #276, #277)

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

/**
 * Strict loopback address verification.
 * Supports:
 * - 'localhost' and RFC 6761 reserved '.localhost' TLD (e.g. 'sub.localhost')
 * - IPv6 loopback '::1'
 * - Strict IPv4 loopback 127.0.0.0/8 (anchored ^ and $, valid octets 0..255)
 * - IPv6-mapped IPv4 loopback '::ffff:127.x.x.x'
 *
 * Explicitly rejects prefix-matched hostnames such as 127.0.0.1.evil.com.
 */
export function isLoopbackAddress(value) {
  if (!value || typeof value !== 'string') return false
  const address = value.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (
    address === 'localhost' ||
    address === 'localhost.' ||
    address === '::1' ||
    address.endsWith('.localhost') ||
    address.endsWith('.localhost.')
  ) {
    return true
  }
  const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ipv4)
  if (!m) return false
  const o = [Number(m[1]), Number(m[2]), Number(m[3])]
  return o.every((n) => n >= 0 && n <= 255)
}

/**
 * Strict private LAN address verification.
 * Supports:
 * - 10.0.0.0/8 (10.0.0.0 - 10.255.255.255)
 * - 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
 * - 192.168.0.0/16 (192.168.0.0 - 192.168.255.255)
 * - 169.254.0.0/16 (link-local)
 * - IPv6-mapped IPv4 equivalents (::ffff:...)
 * - IPv6 ULA (fc00::/7) and link-local (fe80::/10)
 *
 * Explicitly rejects prefix-matched hostnames such as 10.evil.com,
 * 192.168.evil.com, 172.16.evil.com, 10.0.0.1.nip.io.
 */
export function isPrivateLanAddress(value) {
  if (!value || typeof value !== 'string') return false
  const address = value.trim().toLowerCase().replace(/^\[|\]$/g, '')
  const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ipv4)
  if (m) {
    const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
    if (o.some((n) => n < 0 || n > 255)) return false
    if (o[0] === 10) return true
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true
    if (o[0] === 192 && o[1] === 168) return true
    if (o[0] === 169 && o[1] === 254) return true
    return false
  }

  // IPv6 ULA (fc00::/7) or link-local (fe80::/10)
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(address) || /^fe80:/i.test(address)) {
    return true
  }

  return false
}

/**
 * Safely extracts hostname without port or IPv6 brackets from Host header or authority string.
 */
export function extractHostName(hostHeader) {
  if (!hostHeader || typeof hostHeader !== 'string') return ''
  const trimmed = hostHeader.trim()
  try {
    const url = new URL(`http://${trimmed}`)
    return url.hostname.replace(/^\[|\]$/g, '')
  } catch {
    return trimmed.replace(/^\[|\]$/g, '').split(':')[0] || ''
  }
}

/**
 * Helper to get header value in case-insensitive manner.
 */
function getHeader(req, name) {
  if (!req?.headers) return undefined
  const direct = req.headers[name]
  if (direct !== undefined) return Array.isArray(direct) ? direct[0] : direct
  const lower = req.headers[name.toLowerCase()]
  return Array.isArray(lower) ? lower[0] : lower
}

/**
 * Verifies that an incoming HTTP request originates from and targets a trusted local or private LAN authority.
 * Guards against DNS rebinding, cross-site leaks, and unauthorized external probing.
 *
 * Rules:
 * 1. Client remote address (if present on socket) must be loopback or private LAN.
 * 2. Sec-Fetch-Site (if present) must NOT be 'cross-site'.
 * 3. Host header must be present and its hostname must be loopback or private LAN.
 * 4. Origin header (if present) must have valid http/https protocol, its hostname must be loopback/LAN,
 *    and its host authority must match the request's Host header.
 * 5. Referer header (if present) must have valid http/https protocol and its hostname must be loopback/LAN.
 */
export function isTrustedLocalRequest(req) {
  if (!req) return false

  const remote = req.socket?.remoteAddress
  if (remote && !isLoopbackAddress(remote) && !isPrivateLanAddress(remote)) {
    return false
  }

  const site = getHeader(req, 'sec-fetch-site')
  if (site === 'cross-site') {
    return false
  }

  const host = getHeader(req, 'host')
  if (!host || typeof host !== 'string') {
    return false
  }
  const hostName = extractHostName(host)
  if (!isLoopbackAddress(hostName) && !isPrivateLanAddress(hostName)) {
    return false
  }

  const origin = getHeader(req, 'origin')
  if (origin !== undefined) {
    if (typeof origin !== 'string' || origin === '' || origin === 'null') {
      return false
    }
    try {
      const url = new URL(origin)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false
      }
      const originHostName = url.hostname.replace(/^\[|\]$/g, '')
      if (!isLoopbackAddress(originHostName) && !isPrivateLanAddress(originHostName)) {
        return false
      }
      if (url.host.toLowerCase() !== host.toLowerCase()) {
        return false
      }
    } catch {
      return false
    }
  }

  const referer = getHeader(req, 'referer')
  if (referer !== undefined && typeof referer === 'string' && referer !== '') {
    try {
      const url = new URL(referer)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false
      }
      const refererHostName = url.hostname.replace(/^\[|\]$/g, '')
      if (!isLoopbackAddress(refererHostName) && !isPrivateLanAddress(refererHostName)) {
        return false
      }
    } catch {
      return false
    }
  }

  return true
}