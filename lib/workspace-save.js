// @ts-check
// workspace-save.js — Deterministic content-addressed workspace disk export (#510).
// Dual lexical + realpath validation against symlink traversal and staged atomic rename.

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** @type {Record<string, string>} */
const EXTENSION = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const GENERATED_IMAGE_NAME_REGEX = /^image-[0-9a-f]{8,}\.(png|jpg|jpeg|webp|gif)$/i

/**
 * Build deterministic filename for generated image: image-<digest-prefix>.<ext>.
 * @param {string} attachmentId
 * @param {string} [mediaType]
 * @returns {string}
 */
export function workspaceImageName(attachmentId, mediaType = 'image/png') {
  const normId = String(attachmentId || '').trim()
  const digest = normId.startsWith('sha256:') ? normId.slice('sha256:'.length) : normId
  const cleanHex = digest.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
  const prefix = (cleanHex.slice(0, 8) || '00000000').padEnd(8, '0')
  const ext = EXTENSION[mediaType] || 'png'
  return `image-${prefix}.${ext}`
}

/**
 * Lexical containment check. True when child equals parent or lives inside parent.
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
export function containsPath(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * Resolve target image folder inside session workspace root lexically.
 * @param {string} workspaceRoot
 * @param {string} [folder]
 * @returns {string}
 */
export function workspaceImageDir(workspaceRoot, folder) {
  const trimmed = (folder ?? '').trim()
  const root = resolve(workspaceRoot)
  const dir = trimmed === '' ? root : resolve(root, trimmed)
  if (!containsPath(root, dir)) {
    throw new Error(`image workspace folder '${folder}' must stay inside the session workspace`)
  }
  return dir
}

/**
 * Real path of the closest existing ancestor of dir.
 * @param {string} dir
 * @returns {Promise<string>}
 */
async function nearestExistingRealPath(dir) {
  let probe = dir
  while (true) {
    try {
      return await realpath(probe)
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== 'ENOENT') throw error
      const parent = dirname(probe)
      if (parent === probe) throw error
      probe = parent
    }
  }
}

/**
 * Write one generated image durably under the session workspace with dual lexical + realpath validation
 * and staged atomic rename.
 *
 * @param {{
 *   workspaceRoot: string,
 *   folder?: string,
 *   attachmentId: string,
 *   mediaType?: string,
 *   bytes: Uint8Array | Buffer,
 *   signal?: AbortSignal
 * }} options
 * @returns {Promise<{ path: string, filename: string, bytes: number, digest: string }>}
 */
export async function saveImageToWorkspace(options) {
  const { workspaceRoot, folder, attachmentId, mediaType = 'image/png', bytes, signal } = options
  if (signal?.aborted) throw new Error('Aborted')

  const realRoot = await realpath(resolve(workspaceRoot))
  const targetDir = workspaceImageDir(realRoot, folder)

  // Verify realpath of closest ancestor to prevent symlink escape
  const ancestorReal = await nearestExistingRealPath(targetDir)
  if (!containsPath(realRoot, ancestorReal)) {
    throw new Error(`image workspace folder '${folder ?? ''}' resolves outside session workspace (${ancestorReal})`)
  }

  await mkdir(targetDir, { recursive: true })

  // Verify realpath after directory creation
  const createdReal = await realpath(targetDir)
  if (!containsPath(realRoot, createdReal)) {
    throw new Error(`image workspace folder '${folder ?? ''}' resolves outside session workspace (${createdReal})`)
  }

  const filename = workspaceImageName(attachmentId, mediaType)
  const targetPath = join(createdReal, filename)
  const stagingPath = `${targetPath}.${randomUUID()}.tmp`

  try {
    await writeFile(stagingPath, bytes)
    if (signal?.aborted) {
      await unlink(stagingPath).catch(() => {})
      throw new Error('Aborted')
    }
    await rename(stagingPath, targetPath)
  } catch (err) {
    await unlink(stagingPath).catch(() => {})
    throw err
  }

  const digest = filename.replace(/^image-/, '').replace(/\.[^.]+$/, '')
  return {
    path: targetPath,
    filename,
    bytes: bytes.byteLength || bytes.length,
    digest,
  }
}

/**
 * Safely delete a generated image file from workspace disk by its path.
 *
 * @param {string} filePath
 * @param {Iterable<string>} [allowedWorkspaceRoots]
 * @returns {Promise<boolean>}
 */
export async function deleteImageFromWorkspace(filePath, allowedWorkspaceRoots) {
  const resolved = resolve(filePath)
  const base = basename(resolved)
  if (!GENERATED_IMAGE_NAME_REGEX.test(base)) {
    return false
  }

  try {
    const fileLstat = await lstat(resolved)
    if (fileLstat.isSymbolicLink() || !fileLstat.isFile()) {
      return false
    }
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err)?.code === 'ENOENT') {
      return true
    }
    throw err
  }

  try {
    const realFile = await realpath(resolved)
    const realBase = basename(realFile)
    if (!GENERATED_IMAGE_NAME_REGEX.test(realBase)) {
      return false
    }

    const rootsToCheck = new Set()
    if (allowedWorkspaceRoots) {
      for (const r of allowedWorkspaceRoots) {
        if (typeof r === 'string' && r.trim()) rootsToCheck.add(resolve(r))
      }
    }
    rootsToCheck.add(resolve(process.cwd()))

    let withinAllowed = false
    for (const root of rootsToCheck) {
      try {
        const realRoot = await realpath(root)
        if (containsPath(realRoot, realFile)) {
          withinAllowed = true
          break
        }
      } catch {
        // ignore unresolvable root
      }
    }

    if (!withinAllowed) {
      return false
    }

    await unlink(realFile)
    return true
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err)?.code === 'ENOENT') {
      return true
    }
    throw err
  }
}
