import { existsSync, unlinkSync } from 'node:fs'
import { readHistory, writeHistory } from './history.js'
import { isTrustedLocalRequest } from './security.js'

/**
 * Match image dimensions against an aspect ratio label or ratio value.
 */
export function matchAspectRatio(width, height, targetAspect) {
  if (!targetAspect || targetAspect === 'any' || targetAspect === 'all') return true
  if (!width || !height) return false
  const ratio = width / height

  switch (targetAspect) {
    case '1:1':
    case 'square':
      return Math.abs(ratio - 1.0) < 0.1
    case '16:9':
    case 'landscape':
      return Math.abs(ratio - (16 / 9)) < 0.15
    case '9:16':
    case 'portrait':
      return Math.abs(ratio - (9 / 16)) < 0.15
    case '4:3':
      return Math.abs(ratio - (4 / 3)) < 0.15
    case '3:4':
      return Math.abs(ratio - (3 / 4)) < 0.15
    case '21:9':
    case 'ultrawide':
      return Math.abs(ratio - (21 / 9)) < 0.2
    default:
      return true
  }
}

/**
 * Filter, sort, and paginate vault entries with path sanitization.
 */
export function filterVaultEntries(entries, options = {}, existsFn = existsSync) {
  const {
    q = '',
    provider = '',
    aspect = '',
    sort = 'newest',
    offset = 0,
    limit = 30,
  } = options

  const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0)
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 30))
  const cleanQ = String(q).trim().toLowerCase()
  const cleanProvider = String(provider).trim().toLowerCase()

  const existing = (Array.isArray(entries) ? entries : []).filter((e) => e && e.path && existsFn(e.path))

  const filtered = existing.filter((e) => {
    if (cleanQ && !String(e.prompt || '').toLowerCase().includes(cleanQ)) {
      return false
    }
    if (cleanProvider && String(e.provider || '').toLowerCase() !== cleanProvider) {
      return false
    }
    if (aspect && !matchAspectRatio(e.width, e.height, aspect)) {
      return false
    }
    return true
  })

  filtered.sort((a, b) => {
    const timeA = a.createdAt ? Date.parse(a.createdAt) : 0
    const timeB = b.createdAt ? Date.parse(b.createdAt) : 0
    if (sort === 'oldest') {
      return timeA - timeB
    }
    return timeB - timeA
  })

  const total = filtered.length
  const sliced = filtered.slice(safeOffset, safeOffset + safeLimit)

  const items = sliced.map((e) => {
    const { path: _discardPath, ...safeEntry } = e
    return {
      id: e.id || e.attachmentId || String(e.createdAt || Math.random()),
      ...safeEntry,
      thumbnailUrl: e.thumbnailUrl || (e.attachmentId ? `/dsh-image-gen/image?id=${encodeURIComponent(e.attachmentId)}` : ''),
      url: e.attachmentId ? `/dsh-image-gen/image?id=${encodeURIComponent(e.attachmentId)}` : '',
    }
  })

  return {
    items,
    total,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: safeOffset + safeLimit < total,
  }
}

/**
 * Delete entry and associated disk files (image + sidecar json).
 */
export async function deleteVaultEntry(id) {
  if (!id) return { success: false, error: 'Missing entry id' }
  const entries = await readHistory()
  const idx = entries.findIndex((e) => e.id === id || e.attachmentId === id)
  if (idx === -1) {
    return { success: false, error: 'Vault entry not found' }
  }

  const [entry] = entries.splice(idx, 1)
  if (entry && entry.path) {
    try {
      unlinkSync(entry.path)
    } catch { /* ignore missing file */ }
    try {
      unlinkSync(entry.path.replace(/\.[^.]+$/, '.json'))
    } catch { /* ignore missing sidecar */ }
  }

  await writeHistory(entries)
  return { success: true, id }
}

/**
 * Register vault HTTP routes on DSH webServer.
 */
export function registerVaultRoutes(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/vault',
    handler: async (req, res) => {
      if (!isTrustedLocalRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }

      if (req.method === 'GET') {
        const u = new URL(req.url, 'http://localhost')
        const q = u.searchParams.get('q') || ''
        const provider = u.searchParams.get('provider') || ''
        const aspect = u.searchParams.get('aspect') || ''
        const sort = u.searchParams.get('sort') || 'newest'
        const offset = u.searchParams.get('offset') || '0'
        const limit = u.searchParams.get('limit') || '30'

        const entries = await readHistory()
        const result = filterVaultEntries(entries, { q, provider, aspect, sort, offset, limit })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, ...result }))
        return
      }

      if (req.method === 'DELETE') {
        const u = new URL(req.url, 'http://localhost')
        let id = u.searchParams.get('id')

        if (!id) {
          try {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
            id = body.id
          } catch { /* body parse error */ }
        }

        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Missing id parameter' }))
          return
        }

        const result = await deleteVaultEntry(id)
        res.writeHead(result.success ? 200 : 404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: result.success, ...result }))
        return
      }

      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
    },
  }), 'dsh-image-gen: vault route')
}
