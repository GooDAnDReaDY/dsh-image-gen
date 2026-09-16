// lib/generation-cache.js
// Content-addressed disk cache for image generations with LRU eviction (#170)

import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync, readdirSync } from 'node:fs'
import { enforceSecurePermissions } from './security.js'

const DEFAULT_CACHE_MAX_BYTES = 500 * 1024 * 1024 // 500 MB

// In-Memory L1 LRU cache (up to 32 entries) for sub-millisecond retrieval
const L1_CACHE = new Map()
const L1_MAX_ENTRIES = 32

function getFromL1(hash) {
  if (!L1_CACHE.has(hash)) return null
  const entry = L1_CACHE.get(hash)
  L1_CACHE.delete(hash)
  L1_CACHE.set(hash, entry) // refresh LRU order
  return entry
}

function setToL1(hash, entry) {
  if (L1_CACHE.has(hash)) L1_CACHE.delete(hash)
  else if (L1_CACHE.size >= L1_MAX_ENTRIES) {
    const oldestKey = L1_CACHE.keys().next().value
    if (oldestKey) L1_CACHE.delete(oldestKey)
  }
  L1_CACHE.set(hash, entry)
}

function getCacheDir() {
  const base = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(base, 'cache', 'image-gen')
}

/**
 * Looks up an identical previous generation in content-addressed disk cache.
 *
 * @param {string} hash - Deterministic sha256 hash
 * @param {Object} [options]
 * @param {boolean} [options.force=false] - If true, bypass cache
 * @returns {Object|null} Cached entry { bytes, mediaType, meta } or null
 */
export function getCachedGeneration(hash, { force = false } = {}) {
  if (force || !hash) return null

  const l1Hit = getFromL1(hash)
  if (l1Hit) return l1Hit

  const dir = getCacheDir()
  const metaPath = join(dir, `${hash}.json`)
  const dataPath = join(dir, `${hash}.bin`)

  if (!existsSync(metaPath) || !existsSync(dataPath)) return null

  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    const bytes = readFileSync(dataPath)

    // Touch meta file for LRU update in isolated block
    try {
      meta.lastAccessed = Date.now()
      writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')
    } catch {
      // Non-fatal touch failure: still return valid cache entry
    }

    const cachedEntry = {
      bytes,
      mediaType: meta.mediaType || 'image/png',
      width: meta.width,
      height: meta.height,
      seed: meta.seed,
      meta,
    }
    setToL1(hash, cachedEntry)
    return cachedEntry
  } catch {
    return null
  }
}

/**
 * Stores a generation result in content-addressed cache and performs LRU pruning if needed.
 */
export function setCachedGeneration(hash, { bytes, mediaType = 'image/png', width, height, seed, meta = {} } = {}, maxBytes = DEFAULT_CACHE_MAX_BYTES) {
  if (!hash || !bytes) return

  const dir = getCacheDir()
  try {
    mkdirSync(dir, { recursive: true })
    const metaPath = join(dir, `${hash}.json`)
    const dataPath = join(dir, `${hash}.bin`)

    const cacheMeta = {
      ...meta,
      hash,
      mediaType,
      width,
      height,
      seed,
      sizeBytes: bytes.length,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
    }

    writeFileSync(metaPath, JSON.stringify(cacheMeta, null, 2), 'utf8')
    const binBuf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    writeFileSync(dataPath, binBuf)
    enforceSecurePermissions(metaPath)
    enforceSecurePermissions(dataPath)

    setToL1(hash, {
      bytes: binBuf,
      mediaType,
      width,
      height,
      seed,
      meta: cacheMeta,
    })

    pruneCacheToLimit(maxBytes)
  } catch {
    // Non-fatal write failure
  }
}

/**
 * Prunes the cache directory down to maxBytes using LRU (least recently accessed).
 */
export function pruneCacheToLimit(maxBytes = DEFAULT_CACHE_MAX_BYTES) {
  const dir = getCacheDir()
  if (!existsSync(dir)) return

  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    const entries = []
    let totalSize = 0

    for (const file of files) {
      const metaPath = join(dir, file)
      const stem = file.slice(0, -5)
      const dataPath = join(dir, `${stem}.bin`)
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
        const binStat = existsSync(dataPath) ? statSync(dataPath) : { size: 0 }
        const size = binStat.size + statSync(metaPath).size
        totalSize += size
        entries.push({
          stem,
          metaPath,
          dataPath,
          size,
          lastAccessed: meta.lastAccessed || meta.createdAt || 0,
        })
      } catch { /* entry meta unreadable; skip */ }
    }

    if (totalSize <= maxBytes) return

    // Sort by lastAccessed ascending (oldest first)
    entries.sort((a, b) => a.lastAccessed - b.lastAccessed)

    for (const entry of entries) {
      if (totalSize <= maxBytes) break
      try {
        if (existsSync(entry.metaPath)) unlinkSync(entry.metaPath)
        if (existsSync(entry.dataPath)) unlinkSync(entry.dataPath)
        totalSize -= entry.size
      } catch { /* entry unlink failed; skip */ }
    }
  } catch { /* cache dir unreadable; prune skipped */ }
}
