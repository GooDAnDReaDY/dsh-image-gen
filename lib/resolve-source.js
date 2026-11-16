// lib/resolve-source.js — Safe image source resolution for image tools (#317)

import path from 'node:path'
import { readFile, stat, realpath } from 'node:fs/promises'
import { validateImageSignature } from './resolve-image.js'

/** Maximum size for remote (http/https) reference downloads (#546) */
const REMOTE_FETCH_MAX_BYTES = 50 * 1024 * 1024

/** Cloud metadata / link-local hosts that must never be fetched (#546) */
const BLOCKED_REMOTE_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata.azure.com',
  'metadata.aws.cloud',
  'instance-data',
])

/**
 * Validates a remote reference image URL before download (#546).
 * Allows only http/https, rejects embedded credentials, cloud metadata and link-local targets.
 */
function validateRemoteImageUrl(ref) {
  let parsed
  try {
    parsed = new URL(ref)
  } catch {
    throw new Error(`Invalid reference image URL: "${ref}"`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Reference image URL must use http: or https: protocol, got "${parsed.protocol}"`)
  }
  if (parsed.username || parsed.password) {
    throw new Error('Reference image URL must not include embedded credentials in URL authority')
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!hostname) {
    throw new Error('Reference image URL is missing hostname')
  }
  if (hostname.startsWith('169.254.') || hostname.startsWith('fe80:') || BLOCKED_REMOTE_HOSTS.has(hostname)) {
    throw new Error(`Reference image URL is forbidden from targeting cloud metadata or link-local address "${hostname}"`)
  }
  return parsed
}

/**
 * Downloads a remote http(s) image reference with scheme/size/signature validation (#546).
 */
async function fetchRemoteImageSource(ctx, exec, ref) {
  const parsed = validateRemoteImageUrl(ref)
  const fetchImpl = (exec && typeof exec.fetchImpl === 'function')
    ? exec.fetchImpl
    : (ctx && typeof ctx.fetchImpl === 'function' ? ctx.fetchImpl : fetch)
  const signal = exec?.signal || AbortSignal.timeout(30000)
  let res
  try {
    res = await fetchImpl(parsed.href, { signal, redirect: 'follow' })
  } catch (err) {
    throw new Error(`Failed to download reference image "${ref}": ${err?.message || err}`)
  }
  if (!res || !res.ok) {
    throw new Error(`Reference image download failed with HTTP ${res ? res.status : 'unknown'} for "${ref}"`)
  }
  const declaredLength = Number(res.headers?.get?.('content-length') || 0)
  if (declaredLength > REMOTE_FETCH_MAX_BYTES) {
    throw new Error(`Reference image too large (${(declaredLength / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is 50 MB.`)
  }
  const buffer = await res.arrayBuffer()
  const bytes = Buffer.from(buffer)
  if (bytes.length === 0) {
    throw new Error(`Reference image download returned empty body: "${ref}"`)
  }
  if (bytes.length > REMOTE_FETCH_MAX_BYTES) {
    throw new Error(`Reference image too large (${(bytes.length / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is 50 MB.`)
  }
  validateImageSignature(bytes, ref)
  const contentType = String(res.headers?.get?.('content-type') || '').split(';')[0].trim()
  const mediaType = /^image\/(png|jpeg|webp|gif|svg\+xml)$/i.test(contentType) ? contentType.toLowerCase() : 'image/png'
  return { bytes, mediaType }
}

/** Read source image for editing: filesystem path, attachment id, data URI, or http(s) URL (#546). */
export async function resolveSource(ctx, exec, ref) {
  if (!ref) return undefined
  const sessionCwd = exec?.agent?.session?.header?.cwd || process.cwd()
  if (ref.startsWith('sha256:')) {
    const stored = await ctx.attachments.readImage({ attachmentId: ref, mediaType: 'image/png', bytes: 0, width: 0, height: 0 })
    const bytes = Buffer.from(stored.data || stored.bytes || [])
    validateImageSignature(bytes, ref)
    return { bytes, mediaType: stored.ref?.mediaType || 'image/png' }
  }
  if (ref.startsWith('data:')) {
    const commaIndex = ref.indexOf(',')
    if (commaIndex > 0) {
      const meta = ref.slice(0, commaIndex)
      const data = ref.slice(commaIndex + 1).trim()
      const approxBytes = Math.ceil((data.length * 3) / 4)
      if (approxBytes > 50 * 1024 * 1024) {
        throw new Error('Data URI payload too large. Maximum allowed size is 50 MB.')
      }
      const bytes = Buffer.from(data, 'base64')
      if (bytes.length > 50 * 1024 * 1024) {
        throw new Error('Decoded image data too large. Maximum allowed size is 50 MB.')
      }
      validateImageSignature(bytes, 'inline data URI')
      const mediaMatch = meta.match(/data:([^;]+)/)
      return { bytes, mediaType: mediaMatch ? mediaMatch[1] : 'image/png' }
    }
    throw new Error('Malformed data URI')
  }
  if (/^https?:\/\//i.test(ref)) {
    return await fetchRemoteImageSource(ctx, exec, ref)
  }
  // #546: explicit rejection for other URI schemes (ftp:, file:, gopher:, ...) —
  // single-letter Windows drive prefixes ("C:\...") are not URI schemes.
  const schemeMatch = ref.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)
  if (schemeMatch && schemeMatch[1].length > 1) {
    throw new Error(`Source scheme "${schemeMatch[1]}:" is not supported. Only http: and https: URLs, data URIs, sha256: attachment ids and workspace paths are allowed.`)
  }

  const root = path.resolve(sessionCwd)
  const target = path.resolve(root, ref)
  const rel = path.relative(root, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Access denied: path "${ref}" is outside allowed workspace directory "${root}"`)
  }

  const realRoot = await realpath(root).catch(() => root)
  const realTarget = await realpath(target).catch(() => null)
  if (!realTarget) {
    throw new Error(`Source image not found: ${ref}`)
  }
  const relReal = path.relative(realRoot, realTarget)
  if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
    throw new Error(`Access denied: path "${ref}" points outside allowed workspace directory "${realRoot}"`)
  }

  const fileStat = await stat(realTarget).catch(() => null)
  if (!fileStat) {
    throw new Error(`Source image not found: ${ref}`)
  }
  if (!fileStat.isFile()) {
    throw new Error(`Target is not a regular file: ${ref}`)
  }
  if (fileStat.size === 0) {
    throw new Error(`Image file is empty (0 bytes): ${ref}`)
  }
  if (fileStat.size > 50 * 1024 * 1024) {
    throw new Error(`Source image too large (${(fileStat.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is 50 MB.`)
  }

  const bytes = await readFile(realTarget)
  validateImageSignature(bytes, ref)
  const ext = path.extname(target).toLowerCase()
  const mediaType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
    : ext === '.gif' ? 'image/gif'
    : ext === '.svg' ? 'image/svg+xml'
    : 'image/png'
  return { bytes, mediaType }
}
