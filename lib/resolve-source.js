// lib/resolve-source.js — Safe image source resolution for image tools (#317)

import path from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { validateImageSignature } from './resolve-image.js'

/** Read source image for editing: filesystem path or attachment id. */
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

  const root = path.resolve(sessionCwd)
  const target = path.resolve(root, ref)
  const rel = path.relative(root, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Access denied: path "${ref}" is outside allowed workspace directory "${root}"`)
  }

  const fileStat = await stat(target).catch(() => null)
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

  const bytes = await readFile(target)
  validateImageSignature(bytes, ref)
  const ext = path.extname(target).toLowerCase()
  const mediaType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
    : ext === '.gif' ? 'image/gif'
    : ext === '.svg' ? 'image/svg+xml'
    : 'image/png'
  return { bytes, mediaType }
}
