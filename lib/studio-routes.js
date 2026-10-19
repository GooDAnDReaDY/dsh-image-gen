// lib/studio-routes.js
// REST endpoints for studio/workbench extensions (#432-#439, #456).
// Keeps lib/index.js thin and under 800 lines (#216).

import { isTrustedLocalRequest, getRouteRejectionStatus, getRouteWriteRejectionStatus } from './security.js'
import { readBoundedRequestBody } from './vault.js'
import { readHistory } from './history.js'
import { getAllRecipes } from './recipes.js'
import { getComfyTemplates } from './comfy-catalog.js'
import { getCapabilityRegistry } from './capabilities.js'
import { getAllProjectProfiles, saveCustomProfile } from './project-profiles.js'
import { getStagingSession, reviewStagedEdit } from './inpaint-staging.js'
import {
  getBatchQueue,
  getBatchProgress,
  enqueueBatch,
  reconcileQueueOnStartup,
} from './batch-queue.js'
import {
  getVariantSession,
  selectVariantWinner,
  createVariantSession,
} from './variant-selection.js'
import { getImageLineage } from './lineage.js'
import { compactSessionPayload } from './attachment-helper.js'

export function registerStudioRoutes(ctx) {
  // Reconcile batch queues on startup (#437)
  try {
    reconcileQueueOnStartup()
  } catch (_err) {
    // Non-fatal if queue storage is empty or initial
  }

  // Recipes route (#432)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/recipes',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'GET only' }))
        return
      }
      const rejection = getRouteRejectionStatus(req, { connection: ctx?.connection })
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, recipes: getAllRecipes() }))
    },
  }), 'dsh-image-gen: recipes route')

  // Comfy templates route (#433)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/comfy/templates',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'GET only' }))
        return
      }
      const rejection = getRouteRejectionStatus(req, { connection: ctx?.connection })
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, templates: getComfyTemplates() }))
    },
  }), 'dsh-image-gen: comfy templates route')

  // Capabilities route (#434)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/capabilities',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'GET only' }))
        return
      }
      const rejection = getRouteRejectionStatus(req, { connection: ctx?.connection })
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, registry: getCapabilityRegistry() }))
    },
  }), 'dsh-image-gen: capabilities route')

  // Project profiles route (#435)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/profiles',
    handler: async (req, res) => {
      const rejection = req.method === 'POST'
        ? getRouteWriteRejectionStatus(req, { connection: ctx?.connection })
        : getRouteRejectionStatus(req, { connection: ctx?.connection })
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' }))
        return
      }
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, profiles: getAllProjectProfiles() }))
        return
      }
      if (req.method === 'POST') {
        try {
          const body = await readBoundedRequestBody(req, 1024 * 1024)
          const data = JSON.parse(body.toString('utf8'))
          const saved = saveCustomProfile(data)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, profile: saved }))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
        return
      }
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'GET or POST only' }))
    },
  }), 'dsh-image-gen: project profiles route')

  // Inpaint staging route (#436)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/staging',
    handler: async (req, res) => {
      const rejection = req.method === 'POST'
        ? getRouteWriteRejectionStatus(req, { connection: ctx?.connection })
        : getRouteRejectionStatus(req, { connection: ctx?.connection })
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' }))
        return
      }
      const url = new URL(req.url, 'http://localhost')
      if (req.method === 'GET') {
        const stageId = url.searchParams.get('stageId')
        const session = stageId ? getStagingSession(stageId) : null
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: Boolean(session), session }))
        return
      }
      if (req.method === 'POST') {
        try {
          const body = await readBoundedRequestBody(req, 1024 * 1024)
          const data = JSON.parse(body.toString('utf8'))
          const review = reviewStagedEdit(data.stageId, data.action, data)
          res.writeHead(review.ok ? 200 : 400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(review))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
        return
      }
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'GET or POST only' }))
    },
  }), 'dsh-image-gen: staging route')

  // Batch queue route (#437)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/queue',
    handler: async (req, res) => {
      const rejection = req.method === 'POST'
        ? getRouteWriteRejectionStatus(req, { connection: ctx?.connection })
        : getRouteRejectionStatus(req, { connection: ctx?.connection })
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' }))
        return
      }
      const url = new URL(req.url, 'http://localhost')
      if (req.method === 'GET') {
        const batchId = url.searchParams.get('batchId')
        const batch = batchId ? getBatchQueue(batchId) : null
        const progress = batch ? getBatchProgress(batch) : null
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: Boolean(batch), batch, progress }))
        return
      }
      if (req.method === 'POST') {
        try {
          const body = await readBoundedRequestBody(req, 1024 * 1024)
          const data = JSON.parse(body.toString('utf8'))
          const batch = enqueueBatch(data)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, batch }))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
        return
      }
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'GET or POST only' }))
    },
  }), 'dsh-image-gen: batch queue route')

  // Variant comparison route (#438)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/variants',
    handler: async (req, res) => {
      const rejection = req.method === 'POST'
        ? getRouteWriteRejectionStatus(req, { connection: ctx?.connection })
        : getRouteRejectionStatus(req, { connection: ctx?.connection })
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' }))
        return
      }
      const url = new URL(req.url, 'http://localhost')
      if (req.method === 'GET') {
        const selectionId = url.searchParams.get('selectionId')
        const session = selectionId ? getVariantSession(selectionId) : null
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: Boolean(session), session }))
        return
      }
      if (req.method === 'POST') {
        try {
          const body = await readBoundedRequestBody(req, 1024 * 1024)
          const data = JSON.parse(body.toString('utf8'))
          let result
          if (data.action === 'select' || data.winnerIndex !== undefined || data.winnerPath) {
            result = selectVariantWinner(data.selectionId, data)
          } else {
            result = { ok: true, session: createVariantSession(data) }
          }
          res.writeHead(result.ok !== false ? 200 : 400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
        return
      }
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'GET or POST only' }))
    },
  }), 'dsh-image-gen: variants route')

  // Image lineage route (#439)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/lineage',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'GET only' }))
        return
      }
      const rejection = getRouteRejectionStatus(req, { connection: ctx?.connection })
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' }))
        return
      }
      const url = new URL(req.url, 'http://localhost')
      const revisionId = url.searchParams.get('revisionId')
      if (!revisionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'revisionId parameter required' }))
        return
      }
      try {
        const entries = await readHistory()
        const lineage = getImageLineage(revisionId, entries)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: Boolean(lineage), lineage }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    },
  }), 'dsh-image-gen: lineage route')

  // Offload & compaction route (#456)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/offload',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'POST only' }))
        return
      }
      if (!isTrustedLocalRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }
      const offRejection = getRouteWriteRejectionStatus(req, { connection: ctx?.connection })
      if (offRejection !== undefined) {
        res.writeHead(offRejection, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: offRejection === 401 ? 'unauthorized' : 'forbidden' }))
        return
      }
      try {
        const bodyBuf = await readBoundedRequestBody(req, 10 * 1024 * 1024)
        const payload = JSON.parse(bodyBuf.toString('utf8'))
        const compacted = await compactSessionPayload(payload?.content ?? payload, { ctx, threshold: payload?.threshold })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, compacted }))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    },
  }), 'dsh-image-gen: offload route')
}

