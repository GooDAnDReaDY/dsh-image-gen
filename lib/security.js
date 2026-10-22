import path from 'node:path'
import { chmodSync, existsSync, realpathSync } from 'node:fs'

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
  } catch (_err) {
    /* non-fatal: permission change error */
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
  } catch (_err) {
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
 * Safely extracts remote IP address from request socket or connection (#474).
 * Strips IPv6-mapped IPv4 prefix if present.
 */
export function getClientIp(req) {
  if (!req) return ''
  const socket = req.socket || req.connection
  const raw = socket?.remoteAddress
  if (!raw || typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed
}

/**
 * Validates whether the given Host header targets loopback or private LAN authority (#474).
 */
export function isTrustedHost(hostHeader) {
  if (!hostHeader || typeof hostHeader !== 'string') return false
  const hostName = extractHostName(hostHeader)
  if (!hostName) return false
  return isLoopbackAddress(hostName) || isPrivateLanAddress(hostName)
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

  const isLoopbackRemote = (remote ? isLoopbackAddress(remote) : false) || (!remote && isLoopbackAddress(hostName))

  const origin = getHeader(req, 'origin')
  if (origin !== undefined) {
    if (typeof origin !== 'string' || origin === '' || origin === 'null') {
      return false
    }
    try {
      const url = new URL(origin)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        const originHostName = url.hostname.replace(/^\[|\]$/g, '')
        if (!isLoopbackAddress(originHostName) && !isPrivateLanAddress(originHostName)) {
          return false
        }
        if (url.host.toLowerCase() !== host.toLowerCase()) {
          return false
        }
      } else if (url.protocol === 'dsh-app:' && (url.host === 'app' || url.hostname === 'app') && isLoopbackRemote) {
        // Trusted DSH Desktop Electron renderer origin (#478)
      } else {
        return false
      }
    } catch (_err) {
      return false
    }
  }

  const referer = getHeader(req, 'referer')
  if (referer !== undefined && typeof referer === 'string' && referer !== '') {
    try {
      const url = new URL(referer)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        const refererHostName = url.hostname.replace(/^\[|\]$/g, '')
        if (!isLoopbackAddress(refererHostName) && !isPrivateLanAddress(refererHostName)) {
          return false
        }
      } else if (url.protocol === 'dsh-app:' && (url.host === 'app' || url.hostname === 'app') && isLoopbackRemote) {
        // Trusted DSH Desktop Electron renderer referer (#478)
      } else {
        return false
      }
    } catch (_err) {
      return false
    }
  }

  return true
}

/**
 * Evaluates whether an incoming HTTP request is trusted and authenticated (#474).
 *
 * Security gates:
 * 1. If DSH connection service is available (options.connection or options.ctx?.connection),
 *    requestRejection(req) is the authoritative gate for browser session authentication
 *    and trusted network access.
 *    If rejection is returned, the numeric status (e.g. 401 or 403) is returned.
 * 2. Host header, if present, must pass isTrustedHost (prevents DNS rebinding).
 * 3. Cross-site requests (sec-fetch-site: cross-site) are strictly rejected with 403.
 * 4. Origin & Referer headers (if present) must match Host or a trusted host.
 * 5. Fallback when connection service is absent (unit tests, standalone runner):
 *    - Loopback callers (127.0.0.1, ::1) are allowed.
 *    - Remote / LAN callers without connection authentication are rejected with 403 (fail closed!).
 *    - Unknown remote address (socket present but empty remoteAddress) fails closed with 403.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {{ connection?: { requestRejection?: (req: any) => number | undefined }, ctx?: any }} [options]
 * @returns {number|undefined} Rejection HTTP status code (401, 403), or undefined if allowed.
 */
/**
 * Safely extracts DSH connection service without throwing on Cordis Context proxy (#480).
 */
export function getConnection(target) {
  if (!target) return null
  if (typeof target.requestRejection === 'function') return target
  if (typeof target.connection === 'object' && target.connection !== null) {
    return target.connection
  }
  try {
    const ctx = target.ctx || target
    return ctx?.connection || null
  } catch (_err) {
    return null
  }
}

/**
 * Wraps an async route handler with safe exception handling and JSON 500 error reporting (#480).
 * Prevents unhandled rejections from turning into silent empty 400s at the DSH webserver layer.
 */
export function safeJsonHandler(fn, ctx) {
  return async (req, res) => {
    try {
      await fn(req, res)
    } catch (err) {
      try {
        ctx?.logger?.error?.(err)
      } catch (_logErr) { /* ignore */ }
      if (res.headersSent) {
        res.destroy()
        return
      }
      const status = Number(err?.status || err?.statusCode) || 500
      const code = err?.code || 'INTERNAL_ERROR'
      const message = String(err?.message || err || 'Internal server error')
      res.writeHead(status >= 400 && status < 600 ? status : 500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: { code, message } }))
    }
  }
}

export function getRouteRejectionStatus(req, options = {}) {
  if (!req) return 403

  const connection = getConnection(options?.connection || options?.ctx || options)
  if (connection && typeof connection.requestRejection === 'function') {
    try {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        if (typeof rejection === 'number' && Number.isInteger(rejection) && rejection >= 400 && rejection < 600) {
          return rejection
        }
        return rejection === 401 ? 401 : 403
      }
    } catch (_err) {
      // Fail closed if connection service throws (#474)
      return 403
    }
  }

  const host = getHeader(req, 'host')

  // 1. Host header must be present and trusted if provided
  if (host && !isTrustedHost(host)) {
    return 403
  }

  // 2. Strict rejection of cross-site requests
  const site = getHeader(req, 'sec-fetch-site')
  if (site === 'cross-site') {
    return 403
  }

  // 3. Origin header validation if present
  const origin = getHeader(req, 'origin')
  if (origin !== undefined) {
    if (typeof origin !== 'string' || origin === '' || origin === 'null') {
      return 403
    }
    try {
      const originUrl = new URL(origin)
      if (originUrl.protocol === 'http:' || originUrl.protocol === 'https:') {
        if (!isTrustedHost(originUrl.hostname)) {
          return 403
        }
        if (host && originUrl.host.toLowerCase() !== host.toLowerCase()) {
          return 403
        }
      } else if (originUrl.protocol === 'dsh-app:' && (originUrl.host === 'app' || originUrl.hostname === 'app')) {
        const ip = getClientIp(req)
        const hostIsLoopback = host ? isLoopbackAddress(extractHostName(host)) : false
        const isLocal = ip ? isLoopbackAddress(ip) : hostIsLoopback
        if (!isLocal) return 403
      } else {
        return 403
      }
    } catch (_err) {
      return 403
    }
  }

  // 4. Referer header validation if present
  const referer = getHeader(req, 'referer')
  if (referer !== undefined && typeof referer === 'string' && referer !== '') {
    try {
      const refUrl = new URL(referer)
      if (refUrl.protocol === 'http:' || refUrl.protocol === 'https:') {
        if (!isTrustedHost(refUrl.hostname)) {
          return 403
        }
        if (host && refUrl.host.toLowerCase() !== host.toLowerCase()) {
          return 403
        }
      } else if (refUrl.protocol === 'dsh-app:' && (refUrl.host === 'app' || refUrl.hostname === 'app')) {
        const ip = getClientIp(req)
        const hostIsLoopback = host ? isLoopbackAddress(extractHostName(host)) : false
        const isLocal = ip ? isLoopbackAddress(ip) : hostIsLoopback
        if (!isLocal) return 403
      } else {
        return 403
      }
    } catch (_err) {
      return 403
    }
  }

  // 5. Network boundary validation when connection service is absent:
  const hasSocket = Boolean(req.socket || req.connection)
  const ip = getClientIp(req)

  if (hasSocket) {
    // Fail closed on missing/unknown remoteAddress (#474)
    if (!ip) {
      return 403
    }
    // Remote / LAN callers without connection authentication are rejected (fail closed!)
    if (!isLoopbackAddress(ip)) {
      if (!connection) {
        return 403
      }
    }
  } else if (!connection) {
    // Synthetic mock request without socket: allow loopback host for unit tests
    if (host && !isLoopbackAddress(extractHostName(host))) {
      return 403
    }
  }

  if (!connection) {
    const isLocal = ip ? isLoopbackAddress(ip) : (host ? isLoopbackAddress(extractHostName(host)) : false)
    if (!isLocal) return 403
  }

  return undefined
}

/**
 * Evaluates whether an incoming HTTP write/mutation request (POST, PUT, DELETE)
 * is safe, authenticated, and protected against CSRF (#474).
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {{ connection?: { requestRejection?: (req: any) => number | undefined }, ctx?: any }} [options]
 * @returns {number|undefined} Rejection HTTP status code (401, 403), or undefined if allowed.
 */
export function getRouteWriteRejectionStatus(req, options = {}) {
  const readStatus = getRouteRejectionStatus(req, options)
  if (readStatus !== undefined) {
    return readStatus
  }

  const site = getHeader(req, 'sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') {
    return 403
  }

  const host = getHeader(req, 'host')
  const origin = getHeader(req, 'origin')
  const referer = getHeader(req, 'referer')
  const ip = getClientIp(req)
  const connection = getConnection(options?.connection || options?.ctx || options)

  if (origin !== undefined) {
    if (origin === 'null' || typeof origin !== 'string') return 403
    try {
      const originUrl = new URL(origin)
      if (originUrl.protocol === 'http:' || originUrl.protocol === 'https:') {
        if (host && originUrl.host.toLowerCase() !== host.toLowerCase()) return 403
      } else if (originUrl.protocol === 'dsh-app:' && (originUrl.host === 'app' || originUrl.hostname === 'app')) {
        const hostIsLoopback = host ? isLoopbackAddress(extractHostName(host)) : false
        const isLocal = ip ? isLoopbackAddress(ip) : hostIsLoopback
        if (!isLocal) return 403
      } else {
        return 403
      }
    } catch (_err) {
      return 403
    }
  } else if (referer !== undefined && typeof referer === 'string' && referer !== '') {
    try {
      const refUrl = new URL(referer)
      if (refUrl.protocol === 'http:' || refUrl.protocol === 'https:') {
        if (host && refUrl.host.toLowerCase() !== host.toLowerCase()) return 403
      } else if (refUrl.protocol === 'dsh-app:' && (refUrl.host === 'app' || refUrl.hostname === 'app')) {
        const hostIsLoopback = host ? isLoopbackAddress(extractHostName(host)) : false
        const isLocal = ip ? isLoopbackAddress(ip) : hostIsLoopback
        if (!isLocal) return 403
      } else {
        return 403
      }
    } catch (_err) {
      return 403
    }
  } else {
    // Write request without Origin/Referer: fail closed with 403 (#482)
    // Prevents CSRF and reverse proxy bypass via loopback bridge (e.g. dsh-lanmode)
    return 403
  }

  if (!connection) {
    const hasSocket = Boolean(req.socket || req.connection)
    if (hasSocket) {
      if (!ip || !isLoopbackAddress(ip)) return 403
    } else {
      if (host && !isLoopbackAddress(extractHostName(host))) return 403
    }
  }

  return undefined
}

const CLOUD_METADATA_IPS = new Set([
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'metadata.google.internal',
])

const TRUSTED_AI_HOST_PATTERNS = [
  /(^|\.)fal\.(run|ai)$/i,
  /(^|\.)openai\.com$/i,
  /(^|\.)groq\.com$/i,
  /(^|\.)together\.(xyz|ai)$/i,
  /(^|\.)mistral\.ai$/i,
  /(^|\.)deepseek\.com$/i,
  /(^|\.)anthropic\.com$/i,
  /(^|\.)openrouter\.ai$/i,
  /(^|\.)siliconflow\.cn$/i,
  /(^|\.)replicate\.com$/i,
  /(^|\.)volc(es|engine)\.com$/i,
]

/**
 * Validates provider URL configurations against SSRF, credential exfiltration,
 * protocol smuggling, and cloud metadata access (#474).
 *
 * @param {string} field Config field name (e.g. 'baseURL', 'customBaseURL')
 * @param {string} urlString Target URL string
 * @param {{ allowCustomBaseUrl?: boolean }} [options]
 * @returns {string} Normalized trimmed URL
 * @throws {Error} If URL is invalid, unsafe, or targets unauthorized domains
 */
export function validateProviderBaseUrl(field, urlString, options = {}) {
  if (!urlString || typeof urlString !== 'string') {
    throw new Error(`Field "${field}" must be a non-empty URL string`)
  }
  const trimmed = urlString.trim()
  if (!trimmed) {
    throw new Error(`Field "${field}" must not be empty`)
  }

  let parsed
  try {
    parsed = new URL(trimmed)
  } catch (_err) {
    throw new Error(`Field "${field}" is not a valid URL: "${trimmed}"`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Field "${field}" has unsafe protocol "${parsed.protocol}". Only "http:" and "https:" are allowed.`)
  }

  if (parsed.username || parsed.password) {
    throw new Error(`Field "${field}" must not include embedded credentials in URL authority`)
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!hostname) {
    throw new Error(`Field "${field}" is missing hostname`)
  }

  // Block cloud metadata addresses and IPv4 link-local (169.254.0.0/16)
  if (CLOUD_METADATA_IPS.has(hostname) || hostname.startsWith('169.254.') || hostname.startsWith('fe80:')) {
    throw new Error(`Field "${field}" is forbidden from targeting cloud metadata or link-local address "${hostname}"`)
  }

  const isLoopback = isLoopbackAddress(hostname)
  const isLan = isPrivateLanAddress(hostname)
  const allowCustom = Boolean(options?.allowCustomBaseUrl)

  if (field === 'baseURL') {
    const isOfficialFal = /(^|\.)fal\.(run|ai)$/i.test(hostname)
    if (!isOfficialFal && !isLoopback && !allowCustom) {
      throw new Error(`Field "baseURL" must target an official FAL domain (*.fal.run, *.fal.ai) or loopback, got "${hostname}". Set allowCustomBaseUrl to true to permit custom endpoints.`)
    }
    return trimmed
  }

  if (field === 'seedreamBaseURL') {
    const isOfficialVolces = /(^|\.)volc(es|engine)\.com$/i.test(hostname)
    if (!isOfficialVolces && !isLoopback && !allowCustom) {
      throw new Error(`Field "seedreamBaseURL" must target Volcengine domain (*.volces.com, *.volcengine.com) or loopback, got "${hostname}". Set allowCustomBaseUrl to true to permit custom endpoints.`)
    }
    return trimmed
  }

  if (field === 'localBaseURL' || field === 'localComfyUrl' || field === 'localA1111Url') {
    if (!isLoopback && !isLan) {
      throw new Error(`Field "${field}" must target loopback or private LAN address, got "${hostname}".`)
    }
    return trimmed
  }

  if (field === 'customBaseURL') {
    const isKnownAi = TRUSTED_AI_HOST_PATTERNS.some((pat) => pat.test(hostname))
    if (!isKnownAi && !isLoopback && !isLan && !allowCustom) {
      throw new Error(`Field "customBaseURL" domain "${hostname}" is not in trusted AI provider allowlist. Set allowCustomBaseUrl to true in settings to permit arbitrary external endpoints.`)
    }
    return trimmed
  }

  return trimmed
}

/**
 * Resolves candidatePath strictly inside baseDir.
 * If candidatePath is absolute or contains '..', it must resolve inside baseDir.
 * Both lexical containment check and realpath check (for baseDir and existing targets/ancestors)
 * are performed to prevent symlink and lexical directory traversal attacks (#409, #410, #411, #412, #420).
 *
 * @param {string} baseDir Base directory (e.g. sessionCwd or workspace root)
 * @param {string} candidatePath Relative or sub-path to resolve
 * @returns {string} Absolute resolved path guaranteed to be contained within baseDir
 * @throws {Error} if candidatePath escapes baseDir
 */
export function resolveInside(baseDir, candidatePath) {
  const root = path.resolve(baseDir || '.')
  const sub = candidatePath ? String(candidatePath).trim() : '.'
  const resolved = path.resolve(root, sub)
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path traversal denied: "${candidatePath}" escapes base directory "${root}"`)
  }

  let realRoot = root
  try {
    realRoot = realpathSync(root)
  } catch (_err) {
    // If baseDir does not exist yet on disk, lexical containment check above is sufficient
    return resolved
  }

  try {
    const realTarget = realpathSync(resolved)
    const relReal = path.relative(realRoot, realTarget)
    if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
      throw new Error(`Path traversal denied: "${candidatePath}" resolves via symlink outside "${realRoot}"`)
    }
  } catch (err) {
    if (err?.code === 'ENOENT') {
      let curr = path.dirname(resolved)
      while (curr === root || curr.startsWith(root + path.sep)) {
        try {
          const realCurr = realpathSync(curr)
          const relCurr = path.relative(realRoot, realCurr)
          if (relCurr.startsWith('..') || path.isAbsolute(relCurr)) {
            throw new Error(`Path traversal denied: ancestor in "${candidatePath}" resolves via symlink outside "${realRoot}"`)
          }
          break
        } catch (ancestorErr) {
          if (ancestorErr?.code === 'ENOENT') {
            const parent = path.dirname(curr)
            if (parent === curr) break
            curr = parent
            continue
          }
          throw ancestorErr
        }
      }
    } else {
      throw err
    }
  }

  return resolved
}

const SAFE_HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const SAFE_RGB_COLOR = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+)\s*)?\)$/i
const SAFE_HSL_COLOR = /^hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+)\s*)?\)$/i
const SAFE_NAMED_COLOR = /^(?:transparent|currentColor|none|[a-zA-Z]{3,20})$/i

/**
 * Escapes characters for safe inclusion in XML/SVG documents and attributes (#414).
 * Replaces &, <, >, ", ' with their corresponding XML entities.
 *
 * @param {string|unknown} val
 * @returns {string} XML-safe string
 */
export function escapeXml(val) {
  if (val === null || val === undefined) return ''
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Sanitizes a color value for safe inclusion in SVG attributes (fill, stroke, stop-color) (#414).
 * If the input is not a recognized safe color (hex, rgb/rgba, hsl/hsla, or safe named color),
 * returns the provided fallback color.
 *
 * @param {string|unknown} color
 * @param {string} [fallback='#000000']
 * @returns {string} Sanitized color string
 */
export function sanitizeSvgColor(color, fallback = '#000000') {
  if (typeof color !== 'string') return fallback
  const trimmed = color.trim()
  if (
    SAFE_HEX_COLOR.test(trimmed) ||
    SAFE_RGB_COLOR.test(trimmed) ||
    SAFE_HSL_COLOR.test(trimmed) ||
    SAFE_NAMED_COLOR.test(trimmed)
  ) {
    return trimmed
  }
  return fallback
}

