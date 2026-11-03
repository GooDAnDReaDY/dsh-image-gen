// @ts-check
// canvas-route.js — Canvas state synchronizer HTTP route (#506, #507).
// Receives live canvas state pushes and selection screenshots from browser workbench.

import { isTrustedLocalRequest, safeJsonHandler } from './security.js'
import { getCanvasMirror } from './canvas-state.js'

const MAX_BODY_BYTES = 15 * 1024 * 1024 // 15MB for base64 screenshot data

export function registerCanvasRoutes(ctx) {
  const webServer = ctx.get && ctx.get('webServer')
  if (!webServer || typeof webServer.registerRoute !== 'function') return

  webServer.registerRoute({
    path: '/dsh-image-gen/canvas/state',
    handler: safeJsonHandler(async (req, res) => {
      if (!isTrustedLocalRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }

      const mirror = getCanvasMirror()

      if (req.method === 'GET') {
        const latest = mirror.latest()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          connected: mirror.connected(),
          digest: mirror.digest(),
          nodeCount: latest?.nodeCount || 0,
          selectionCount: latest?.selectionCount || 0,
          hasSelectionImage: Boolean(mirror.latestSelectionImage()),
        }))
        return
      }

      if (req.method === 'POST') {
        const chunks = []
        let received = 0
        for await (const chunk of req) {
          received += chunk.length
          if (received > MAX_BODY_BYTES) {
            res.writeHead(413, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'payload_too_large' }))
            return
          }
          chunks.push(chunk)
        }

        let body
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch (_err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid_json' }))
          return
        }

        let selectionImage = undefined
        if (body.selectionImage && typeof body.selectionImage === 'string') {
          const match = /^data:(image\/[a-zA-Z0-9.-]+);base64,(.+)$/.exec(body.selectionImage)
          if (match) {
            selectionImage = {
              mediaType: match[1],
              data: Buffer.from(match[2], 'base64'),
            }
          }
        }

        mirror.apply(body, selectionImage)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          digest: mirror.digest(),
          connected: mirror.connected(),
        }))
        return
      }

      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'method_not_allowed' }))
    }),
  })

  webServer.registerRoute({
    path: '/dsh-image-gen/canvas/clear',
    handler: safeJsonHandler(async (req, res) => {
      if (!isTrustedLocalRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }
      if (req.method === 'POST') {
        getCanvasMirror().clear()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'method_not_allowed' }))
    }),
  })
}
