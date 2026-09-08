// lib/generation-cache.js
// Content-addressed disk cache for image generations with LRU eviction (#170)

import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync, readdirSync } from 'node:fs'

const DEFAULT_CACHE_MAX_BYTES = 500 * 1024 * 1024 // 500 MB

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

  const dir = getCacheDir()
  const metaPath = join(dir, `${hash}.json`)
  const dataPath = join(dir, `${hash}.bin`)

  if (!existsSync(metaPath) || !existsSync(dataPath)) return null

  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    const bytes = readFileSync(dataPath)

    // Touch meta file for LRU update
    meta.lastAccessed = Date.now()
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')

    return {
      bytes,
      mediaType: meta.mediaType || 'image/png',
      width: meta.width,
      height: meta.height,
      seed: meta.seed,
      meta,
    }
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
    writeFileSync(dataPath, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes))

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
      } catch {}
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
      } catch {}
    }
  } catch {}
}
