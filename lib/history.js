import path from 'node:path'
import os from 'node:os'
import { existsSync, unlinkSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { enforceSecurePermissions } from './security.js'

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

export async function findCachedByPrompt(entries, prompt) {
  return entries.find((e) => e.prompt === prompt)
}

export async function findCached(entries, seed, prompt) {
  if (seed === undefined) return undefined
  return entries.find((e) => e.seed === seed && e.prompt === prompt)
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

export async function readHistory() {
  try {
    const raw = await readFile(historyFile(), 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    return []
  }
}

/** Save history to disk file (atomic overwrite). */
export async function writeHistory(entries) {
  try {
    await mkdir(path.dirname(historyFile()), { recursive: true })
    await writeFile(historyFile(), JSON.stringify(entries, null, 2))
    enforceSecurePermissions(historyFile())
  } catch (e) { /* history write failure is non-fatal */ }
}

/** Filter entries whose files exist on disk; newest first. */
export function filterHistory(entries, exists) {
  return entries.filter((e) => exists(e.path)).slice(0, 50)
}
