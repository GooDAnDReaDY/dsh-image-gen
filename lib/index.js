// dsh-image-gen: a `generate_image` tool with pluggable providers.
//
// A provider turns a prompt into image bytes; everything after that is shared:
//   1. save the bytes through ctx.attachments (renders in the conversation);
//   2. write a durable copy under <workspace>/<outputDir>;
//   3. hand the tool card a same-origin URL that outlives the provider's link.
//
// Providers live in providers.js — the FAL queue protocol and any
// OpenAI-compatible images API. Which one runs is the `provider` setting.
//
// API keys are resolved per call through the credentials service (Settings ->
// Credentials, or $DSH_HOME/.credentials.yaml) under the configured reference,
// falling back to the process environment.

import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { isTrustedLocalRequest } from './security.js'
import { saveAndAttachResult } from './attachment-helper.js'
import {
  historyFile,
  findCachedGeneration,
  findCachedByPrompt,
  findCached,
  cachedResult,
  pruneHistory,
  readHistory,
  writeHistory,
  filterHistory,
  repairHistoryPermissions,
} from './history.js'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  IMAGE_SIZES,
  OUTPUT_FORMATS,
  PROVIDER_KEYS,
  buildSidecar,
  normalizeMediaType,
  resolveApiKeyCandidates,
  testProviderConnection,
} from './providers.js'

import { resolveConversationImage, analyzeImageWithVision, validateImageSignature } from './resolve-image.js'
import { registerImageCommand } from './commands.js'
import { registerAllTools } from './register-tools.js'
import { registerPluginUpdater } from './updater.js'
import { registerVaultRoutes } from './vault.js'
import { registerSettingsRoutes } from './settings-route.js'
import { clearAllAnchors } from './anchor-helpers.js'
import { resetLoopGuard, getLoopGuardState } from './loop-guard.js'
import { Config, plainConfig, volatileConfig, publicConfig, ensureConfig } from './config-schema.js'
import { resolveSource } from './resolve-source.js'

export { IMAGE_SIZES, OUTPUT_FORMATS, PROVIDER_KEYS, buildSidecar, normalizeMediaType, resolveConversationImage, analyzeImageWithVision }
export { saveAndAttachResult }
export {
  historyFile,
  findCachedGeneration,
  findCachedByPrompt,
  findCached,
  cachedResult,
  pruneHistory,
  readHistory,
  writeHistory,
  filterHistory,
  repairHistoryPermissions,
}

export { Config, plainConfig, volatileConfig, publicConfig, ensureConfig }
export { resolveSource }

export const name = '@goodandready/dsh-image-gen'

/** Settings namespace the Web card edits. */
const NS = 'dsh-image-gen'

// The plugin was previously named dsh-fal-image-gen. Any settings saved
// under the legacy namespace are read as fallback and migrated once on startup.
const LEGACY_NS = 'dsh-fal-image-gen'
export const inject = ['tools', 'attachments', 'credentials', 'webServer', 'settings', 'llm', 'systemPrompt']

export function slugify(input) {
  const stem = String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9Ѐ-ӿ]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return stem || 'image'
}

/** Resolve an API key for one call (credentials service first, then env). */
export async function resolveApiKey(ctx, ref) {
  if (!ref) return ''
  const candidates = resolveApiKeyCandidates(ref)

  for (const candidate of candidates) {
    try {
      const resolved = await ctx.credentials.resolve(credentialRef(candidate))
      if (resolved && resolved.value) return resolved.value
    } catch (_) {
      // Credential reference not found in service, try next candidate
    }
    const envVal = process.env[candidate]
    if (envVal) return envVal
  }
  return ''
}

/**
 * If the user configured the plugin under its old name (dsh-fal-image-gen), copy
 * those settings forward into dsh-image-gen once so existing keys and choices
 * are preserved. Only touches values that the user actually modified.
 */
function migrateLegacySettings(sctx, scope) {
  try {
    if (!scope || typeof scope.update !== 'function') return
    const legacyScope = sctx.settings.get?.(LEGACY_NS)
    if (!legacyScope) return
    const legacy = legacyScope.get?.()
    if (!legacy || typeof legacy !== 'object') return
    scope.update(structuredClone(legacy))
  } catch (_) {
    // Settings migration skipped — fallback to default schema configuration
  }
}

/** Collect text chunks from llm.stream iterator.
 *  Canonical implementation lives in prompt-enhancer.js; re-exported for backwards compat. */
export { collectText } from './prompt-enhancer.js'

/** Expand short prompt via chat model; return original prompt on error.
 *  Canonical implementation lives in prompt-enhancer.js; re-exported for backwards compat. */
export { buildEnhancePromptSystemMessage } from './prompt-enhancer.js'

/** Expand short prompt via chat model; return original prompt on error.
 *  Canonical implementation lives in prompt-enhancer.js; re-exported for backwards compat. */
export { enhancePrompt } from './prompt-enhancer.js'

export function apply(ctx, rawConfig) {
  const config = ensureConfig(rawConfig)
  const baseConfig = plainConfig(config)
  if (ctx.systemPrompt && typeof ctx.systemPrompt.section === 'function') {
    ctx.systemPrompt.section({
      name: 'tool:image-generation',
      order: 121,
      text: 'To create images, call generate_image with a prompt and optional count, aspect_ratio, quality, or output_dir. '
        + 'The tool writes images to disk and shows them in the conversation. The model cannot see the image directly in the text stream; '
        + 'for quality inspection, verification of expected elements, or autonomous correction (Vision Loop), call analyze_image from the @goodandready/dsh-vision-bridge plugin '
        + 'or inspect_image_quality on the returned path.',
    })
  }

  let settingsApi
  let currentLiveConfig = null
  let getConfig = () => currentLiveConfig || config
  const live = () => plainConfig(getConfig() ?? {})

  const createSettingsAdapter = (svc) => {
    if (!svc) return undefined
    if (typeof svc.replace === 'function' || typeof svc.update === 'function' || typeof svc.mutate === 'function') {
      const getRevision = () => {
        try {
          return svc.describe?.().find((row) => row.ns === NS)?.revision
        } catch (_) {
          return undefined
        }
      }
      return {
        get: () => live(),
        replace: async (next) => {
          const parsed = Config(structuredClone(plainConfig(next)))
          currentLiveConfig = parsed
          const payload = volatileConfig(parsed)
          if (typeof svc.replace === 'function') {
            await svc.replace(NS, payload, getRevision())
          } else if (typeof svc.update === 'function') {
            await svc.update(NS, payload, getRevision())
          }
          return parsed
        },
        update: async (patch) => {
          const merged = Config({ ...publicConfig(live()), ...plainConfig(patch) })
          currentLiveConfig = merged
          const payload = volatileConfig(merged)
          if (typeof svc.update === 'function') {
            await svc.update(NS, payload, getRevision())
          } else if (typeof svc.replace === 'function') {
            await svc.replace(NS, payload, getRevision())
          }
          return merged
        },
        watch: (cb) => {
          if (typeof svc.watch === 'function') return svc.watch(cb)
          return () => {}
        },
      }
    }
    return undefined
  }

  ctx.inject(['settings'], (sctx) => {
    if (typeof sctx.settings?.register === 'function') {
      const scope = sctx.settings.register(NS, Config, { base: config })
      settingsApi = scope
      migrateLegacySettings(sctx, scope)
      getConfig = () => (scope?.get?.() ?? config) ?? config
      sctx.effect(() => () => {
        getConfig = () => config
        settingsApi = undefined
      })
    } else {
      settingsApi = createSettingsAdapter(sctx.settings)
      if (typeof sctx.settings?.describe === 'function') {
        try {
          sctx.settings.describe(NS, Config)
        } catch (_) { /* bestEffort */ }
      }
      sctx.effect(() => () => {
        getConfig = () => config
        settingsApi = undefined
      })
    }
  })

  // Serve the stored image so the tool card can show it inline.
  const imageHandler = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'GET only' }))
      return
    }
    if (!isTrustedLocalRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'forbidden' }))
      return
    }
    const query = new URL(req.url ?? '/', 'http://x').searchParams
    const id = query.get('id') ?? ''
    if (!/^sha256:[0-9a-f]{64}$/.test(id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'bad attachment id' }))
      return
    }

    const mediaType = query.get('mediaType') ?? 'image/png'
    const bytes = Number(query.get('bytes') ?? 0)
    const width = Number(query.get('width') ?? 0)
    const height = Number(query.get('height') ?? 0)

    try {
      const stored = await ctx.attachments.readImage({
        attachmentId: id,
        mediaType,
        bytes,
        width,
        height,
      })
      res.writeHead(200, {
        'Content-Type': stored.ref?.mediaType || mediaType,
        'Content-Length': stored.data.byteLength,
        'Cache-Control': 'public, max-age=31536000, immutable',
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      res.end(Buffer.isBuffer(stored.data) ? stored.data : Buffer.from(stored.data))
    } catch (_) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'attachment not found' }))
    }
  }

  // Repair history file & directory permissions once on startup (#307, #318)
  repairHistoryPermissions()

  for (const path of ['/dsh-image-gen/image', '/dsh-fal-image-gen/image']) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path,
      handler: imageHandler,
    }), `dsh-image-gen: image route ${path}`)
  }

  // Settings REST routes (#295)
  registerSettingsRoutes(ctx, {
    live,
    getSettingsApi: () => settingsApi,
    setLiveConfig: (c) => { currentLiveConfig = c },
  })

  // One-click plugin updater route per DSH standard
  ctx.effect(() => registerPluginUpdater(ctx, {
    endpoint: '/api/dsh-image-gen/update',
    packageName: '@goodandready/dsh-image-gen',
    manifestUrl: new URL('../package.json', import.meta.url),
  }), 'dsh-image-gen: plugin updater route')

  // Provider connection diagnostics probe
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/diagnostics/test',
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
      try {
        const u = new URL(req.url, 'http://localhost')
        const provider = u.searchParams.get('provider') || config.provider || 'fal'
        const deps = {
          fetchImpl: fetch,
          resolveKey: (ref) => resolveApiKey(ctx, ref),
          cfg: (typeof getConfig === 'function') ? getConfig() : config,
          ctx,
        }
        const result = await testProviderConnection(deps, provider)
        const guardState = getLoopGuardState(provider)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ provider, loopGuard: guardState, ...result }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    },
  }), 'dsh-image-gen: diagnostics test route')

  // Generation history: in-memory list filtered by filesystem existence.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/history',
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
      const exists = (p) => existsSync(p)
      const entries = await readHistory()
      const withThumbs = filterHistory(entries, exists).map((e) => {
        const { path: _discardPath, ...safeEntry } = e
        return {
          ...safeEntry,
          thumbnailUrl: e.attachmentId ? `/dsh-image-gen/image?id=${encodeURIComponent(e.attachmentId)}` : '',
        }
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(withThumbs))
    },
  }), 'dsh-image-gen: history route')

  // Vault route (#159)
  registerVaultRoutes(ctx)

  // Session and cache teardown cleanup effect
  ctx.effect(() => () => {
    clearAllAnchors()
    resetLoopGuard()
  }, 'dsh-image-gen: session cleanup')

  // Tool registrations live in register-tools.js; each tool is a labeled ctx.effect (#216).
    // Top-level /image slash command (#152)
  registerImageCommand(ctx, {
    config: baseConfig,
    live,
    saveAndAttachResult,
    resolveSource,
    slugify,
    resolveApiKey,
  })

  registerAllTools(ctx, {
    config: baseConfig,
    live,
    saveAndAttachResult,
    resolveSource,
    slugify,
    resolveApiKey,
  })
}
