// lib/settings-route.js
// REST endpoints for plugin settings (/dsh-image-gen/config, /dsh-image-gen/status) (#295, #300).
// Provides HTTP read/write fallback when DSH core is accessed over network.

import { isTrustedLocalRequest } from './security.js'
import { readBoundedRequestBody } from './vault.js'
import { publicConfig, plainConfig, Config } from './index.js'

export function registerSettingsRoutes(ctx, { live, getSettingsApi, setLiveConfig }) {
  // 1. GET /dsh-image-gen/status
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/status',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'GET only' }))
        return
      }
      if (!isTrustedLocalRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }
      const cfg = publicConfig(live())
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ok: true,
        provider: cfg.provider,
        model: cfg.model,
        enabled: cfg.enabled,
        config: cfg,
      }))
    },
  }), 'dsh-image-gen: status route')

  // 2. GET & PUT /dsh-image-gen/config
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/config',
    handler: async (req, res) => {
      if (req.method === 'GET') {
        if (!isTrustedLocalRequest(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'forbidden' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, config: publicConfig(live()) }))
        return
      }

      if (req.method !== 'PUT') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'GET or PUT only' }))
        return
      }

      if (!isTrustedLocalRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }

      let buf
      try {
        buf = await readBoundedRequestBody(req, 64 * 1024)
      } catch (err) {
        if (err?.statusCode === 413) {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
          return
        }
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err?.message || 'body read failed' }))
        return
      }

      let payload
      try {
        payload = JSON.parse(buf.toString('utf8') || '{}')
      } catch (_err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }))
        return
      }

      const raw = payload && typeof payload.config === 'object' && payload.config !== null ? payload.config : payload
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'body must be a JSON object' }))
        return
      }

      const resetFields = []
      if (Array.isArray(payload?.resetFields)) {
        resetFields.push(...payload.resetFields)
      } else if (Array.isArray(payload?.reset)) {
        resetFields.push(...payload.reset)
      } else if (typeof payload?.resetField === 'string') {
        resetFields.push(payload.resetField)
      }

      const allowedKeys = new Set(Object.keys(Config.dict || {}))
      for (const k of resetFields) {
        if (!allowedKeys.has(k)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: `unknown config field to reset: ${k}` }))
          return
        }
      }

      for (const [k, v] of Object.entries(raw)) {
        if (k === 'resetFields' || k === 'reset' || k === 'resetField') continue
        if (!allowedKeys.has(k)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: `unknown config field: ${k}` }))
          return
        }
        if (v === null) {
          resetFields.push(k)
        }
      }

      try {
        const base = structuredClone(plainConfig(live()) || {})
        for (const k of resetFields) {
          delete base[k]
        }
        for (const [k, v] of Object.entries(raw)) {
          if (k === 'resetFields' || k === 'reset' || k === 'resetField') continue
          if (v !== null && v !== undefined) {
            base[k] = v
          }
        }
        const merged = plainConfig(Config(base))
        const settingsApi = getSettingsApi ? getSettingsApi() : null
        if (settingsApi && typeof settingsApi.replace === 'function') {
          await settingsApi.replace(merged)
        } else if (settingsApi && typeof settingsApi.update === 'function') {
          await settingsApi.update(merged)
        } else if (typeof setLiveConfig === 'function') {
          setLiveConfig(merged)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, config: publicConfig(merged) }))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }))
      }
    },
  }), 'dsh-image-gen: config route')
}