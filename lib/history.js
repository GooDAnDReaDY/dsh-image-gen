import path from 'node:path'
import os from 'node:os'
import { existsSync, unlinkSync, chmodSync, readdirSync, statSync } from 'node:fs'
import { readFile, mkdir } from 'node:fs/promises'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { enforceSecurePermissions } from './security.js'

let inMemoryLockQueue = Promise.resolve()

/** Execute an operation with in-process queue + cross-process file lock (#365) */
export async function withHistoryLock(operation, options = { waitMs: 5000 }) {
  const file = historyFile()
  const dir = path.dirname(file)
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    try { chmodSync(dir, 0o700) } catch (_err) { /* non-fatal permission repair */ }
  } catch (_err) { /* non-fatal mkdir */ }

  const runWithLocks = async () => {
    return await withFileLock(file, operation, options)
  }

  const next = inMemoryLockQueue.then(runWithLocks, runWithLocks)
  inMemoryLockQueue = next.catch(() => {})
  return await next
}

export function historyFile() {
  return path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-image-gen', 'history.json')
}

/** Read history from disk file (empty array if not found). */
/** Find history entry matching seed+prompt if file exists. */
/** Find history entry matching prompt text if file exists. */
export function findCachedGeneration(entries, hash) {
  if (!hash || !Array.isArray(entries)) return undefined
  return entries.find((e) => e.cacheHash === hash)
}

export async function findCachedByPrompt(entries, prompt, criteria = {}) {
  if (!prompt || !Array.isArray(entries)) return undefined
  return entries.find((e) => {
    if (e.prompt !== prompt) return false
    if (criteria.cacheHash && e.cacheHash && criteria.cacheHash !== e.cacheHash) return false
    if (criteria.provider && e.provider && criteria.provider.toLowerCase() !== e.provider.toLowerCase()) return false
    if (criteria.model && e.model && criteria.model.toLowerCase() !== e.model.toLowerCase()) return false
    if (criteria.sourceHash !== undefined && e.sourceHash !== undefined && criteria.sourceHash !== e.sourceHash) return false
    if (criteria.sourceHash && !e.sourceHash) return false
    if (!criteria.sourceHash && e.sourceHash) return false
    if (criteria.maskHash !== undefined && e.maskHash !== undefined && criteria.maskHash !== e.maskHash) return false
    if (criteria.maskHash && !e.maskHash) return false
    if (!criteria.maskHash && e.maskHash) return false
    if (criteria.refHash !== undefined && e.refHash !== undefined && criteria.refHash !== e.refHash) return false
    if (criteria.refHash && !e.refHash) return false
    if (!criteria.refHash && e.refHash) return false
    if (criteria.quality !== undefined && e.quality !== undefined && criteria.quality !== e.quality) return false
    if (criteria.style !== undefined && e.style !== undefined && criteria.style !== e.style) return false
    if (criteria.strength !== undefined && e.strength !== undefined && criteria.strength !== e.strength) return false

    if (criteria.format) {
      const entryFmt = (e.format || (e.mediaType || '').replace('image/', '')).toLowerCase().replace('jpeg', 'jpg')
      const targetFmt = String(criteria.format).toLowerCase().replace('jpeg', 'jpg')
      if (entryFmt && targetFmt && entryFmt !== targetFmt) return false
    }
    if (criteria.aspectRatio && e.aspectRatio && e.aspectRatio !== criteria.aspectRatio) return false
    if (criteria.width && e.width && criteria.width !== e.width) return false
    if (criteria.height && e.height && criteria.height !== e.height) return false
    if (criteria.size && e.size && criteria.size !== criteria.size) return false
    return true
  })
}

export async function findCached(entries, seed, prompt, criteria = {}) {
  if (seed === undefined || !Array.isArray(entries)) return undefined
  return entries.find((e) => {
    if (e.seed !== seed || e.prompt !== prompt) return false
    if (criteria.cacheHash && e.cacheHash && criteria.cacheHash !== e.cacheHash) return false
    if (criteria.provider && e.provider && criteria.provider.toLowerCase() !== e.provider.toLowerCase()) return false
    if (criteria.model && e.model && criteria.model.toLowerCase() !== e.model.toLowerCase()) return false
    if (criteria.sourceHash !== undefined && e.sourceHash !== undefined && criteria.sourceHash !== e.sourceHash) return false
    if (criteria.sourceHash && !e.sourceHash) return false
    if (!criteria.sourceHash && e.sourceHash) return false
    if (criteria.maskHash !== undefined && e.maskHash !== undefined && criteria.maskHash !== e.maskHash) return false
    if (criteria.maskHash && !e.maskHash) return false
    if (!criteria.maskHash && e.maskHash) return false
    if (criteria.refHash !== undefined && e.refHash !== undefined && criteria.refHash !== e.refHash) return false
    if (criteria.refHash && !e.refHash) return false
    if (!criteria.refHash && e.refHash) return false
    if (criteria.quality !== undefined && e.quality !== undefined && criteria.quality !== e.quality) return false
    if (criteria.style !== undefined && e.style !== undefined && criteria.style !== e.style) return false
    if (criteria.strength !== undefined && e.strength !== undefined && criteria.strength !== e.strength) return false

    if (criteria.format) {
      const entryFmt = (e.format || (e.mediaType || '').replace('image/', '')).toLowerCase().replace('jpeg', 'jpg')
      const targetFmt = String(criteria.format).toLowerCase().replace('jpeg', 'jpg')
      if (entryFmt && targetFmt && entryFmt !== targetFmt) return false
    }
    if (criteria.aspectRatio && e.aspectRatio && e.aspectRatio !== criteria.aspectRatio) return false
    if (criteria.width && e.width && criteria.width !== e.width) return false
    if (criteria.height && e.height && criteria.height !== e.height) return false
    if (criteria.size && e.size && criteria.size !== criteria.size) return false
    return true
  })
}

/** Return cached entry if file exists on disk, otherwise undefined. */
export async function cachedResult(entry) {
  if (!entry || !entry.path) return undefined
  if (!entry.path || !existsSync(entry.path)) return undefined
  return {
    path: entry.path,
    url: entry.attachmentId ? `/dsh-image-gen/image?id=${encodeURIComponent(entry.attachmentId)}` : '',
    thumbnailUrl: entry.thumbnailUrl || (entry.attachmentId ? `/dsh-image-gen/image?id=${encodeURIComponent(entry.attachmentId)}` : ''),
    width: entry.width || 1024,
    height: entry.height || 1024,
    seed: entry.seed,
    prompt: entry.prompt,
    cost: 0,
    format: (entry.mediaType || 'image/png').replace('image/', ''),
    cached: true,
    fromCache: true,
    attachment: entry.attachmentId ? {
      attachmentId: entry.attachmentId,
      mediaType: entry.mediaType || 'image/png',
      bytes: entry.bytes || 0,
      width: entry.width || 1024,
      height: entry.height || 1024,
      name: entry.name || '',
    } : undefined,
  }
}

/** Prune files and history records older than pruneDays (including sidecars). */
export async function pruneHistory(entries, pruneDays) {
  if (!pruneDays || pruneDays <= 0) return entries
  const cutoff = Date.now() - pruneDays * 86400000
  const kept = []
  for (const e of entries) {
    const created = e.createdAt ? Date.parse(e.createdAt) : NaN
    if (Number.isFinite(created) && created < cutoff) {
      try { unlinkSync(e.path) } catch (err) { /* file already deleted */ }
      try { unlinkSync(e.path.replace(/\.[^.]+$/, '.json')) } catch (err) { /* sidecar */ }
      continue
    }
    kept.push(e)
  }
  return kept
}

/**
 * Repairs permissions on the history directory (0700) and history file (0600),
 * migrating existing installations created under world-readable umasks (#307).
 */
export function repairHistoryPermissions() {
  try {
    const file = historyFile()
    const dir = path.dirname(file)
    if (existsSync(dir)) {
      try { chmodSync(dir, 0o700) } catch (_err) { /* non-fatal permission repair */ }
      try {
        const files = readdirSync(dir)
        for (const f of files) {
          const p = path.join(dir, f)
          try {
            const st = statSync(p)
            if (st.isDirectory()) {
              chmodSync(p, 0o700)
            } else {
              chmodSync(p, 0o600)
            }
          } catch (_err) { /* skip unreadable entry */ }
        }
      } catch (_err) { /* skip unreadable directory */ }
    }
    if (existsSync(file)) {
      try { chmodSync(file, 0o600) } catch (_err) { /* non-fatal permission repair */ }
    }
  } catch (_err) { /* non-fatal permission repair */ }
}

export async function readHistory() {
  try {
    const raw = await readFile(historyFile(), 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (_e) {
    return []
  }
}

/** Save history to disk file (atomic overwrite with 0600 mode via dsh-atomic-write). */
export async function writeHistory(entries) {
  try {
    const file = historyFile()
    const dir = path.dirname(file)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    try { chmodSync(dir, 0o700) } catch (_err) { /* non-fatal permission repair */ }
    await writeFileAtomic(file, JSON.stringify(entries, null, 2), {
      mode: 0o600,
      dirMode: 0o700,
    })
    enforceSecurePermissions(file)
  } catch (_e) { /* history write failure is non-fatal */ }
}

/**
 * Atomically append an entry to history, running read -> prune -> unshift -> write
 * under an exclusive lock transaction (#365).
 */
export async function appendHistoryEntry(entry, { pruneDays = 0, historyLimit = 50 } = {}) {
  if (!entry || historyLimit <= 0) return []
  return await withHistoryLock(async () => {
    let current = await readHistory()
    if (pruneDays > 0) {
      current = await pruneHistory(current, pruneDays)
    }
    const existingIdx = current.findIndex(
      (e) => (entry.attachmentId && e.attachmentId === entry.attachmentId) || (entry.path && e.path === entry.path)
    )
    if (existingIdx !== -1) {
      current.splice(existingIdx, 1)
    }
    current.unshift(entry)
    if (current.length > historyLimit) {
      current.length = historyLimit
    }
    await writeHistory(current)
    return current
  })
}

/** Filter entries whose files exist on disk; newest first. */
export function filterHistory(entries, exists) {
  return entries.filter((e) => exists(e.path)).slice(0, 50)
}
