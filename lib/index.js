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

import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { readFile } from 'node:fs/promises'
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

import { resolveConversationImage, analyzeImageWithVision } from './resolve-image.js'
import { registerAllTools } from './register-tools.js'
import { registerPluginUpdater } from './updater.js'
import { registerVaultRoutes } from './vault.js'
import { registerSettingsRoutes } from './settings-route.js'
import { clearAllAnchors } from './anchor-helpers.js'
import { resetLoopGuard, getLoopGuardState } from './loop-guard.js'

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
}

export const name = '@goodandready/dsh-image-gen'

/** Settings namespace the Web card edits. */
const NS = 'dsh-image-gen'

// The plugin was previously named dsh-fal-image-gen. Any settings saved
// under the legacy namespace are read as fallback and migrated once on startup.
const LEGACY_NS = 'dsh-fal-image-gen'
export const inject = ['tools', 'attachments', 'credentials', 'webServer', 'settings', 'llm', 'systemPrompt']

// Polyfill for .volatile() schema annotation if runtime schemastery lacks it (#295)
if (typeof z.prototype?.volatile !== 'function') {
  z.prototype.volatile = function volatile() {
    if (this.meta && this.meta.volatile) throw new TypeError('volatile schema is already wrapped')
    return typeof this.extra === 'function' ? this.extra('volatile', true) : this
  }
}

export const Config = z.object({
  enabled: z
    .boolean()
    .description('Master switch for image generation. When false, tools refuse to execute.')
    .default(true)
    .volatile(),
  provider: z
    .string()
    .description(`Which provider generates the image. One of: ${PROVIDER_KEYS.join(', ')}. `
      + '"fal" uses the FAL queue below; "custom" uses the OpenAI-compatible API configured under it.')
    .default('fal')
    .volatile(),
  model: z
    .string()
    .description('FAL model id, called as {baseURL}/{model}.')
    .default('fal-ai/flux-2/klein/9b')
    .volatile(),
  apiKeyEnv: z
    .string()
    .role('credential-ref')
    .description('Credential reference / env var holding the FAL API key (the "Key " auth prefix is added automatically when missing).')
    .default('FAL_API_KEY')
    .volatile(),
  baseURL: z
    .string()
    .description('FAL queue base URL.')
    .default('https://queue.fal.run')
    .volatile(),
  defaultSize: z
    .string()
    .description(`Default image size when the tool call omits image_size. One of: ${IMAGE_SIZES.join(', ')}.`)
    .default('landscape_4_3')
    .volatile(),
  defaultFormat: z
    .string()
    .description(`Default output format. One of: ${OUTPUT_FORMATS.join(', ')}.`)
    .default('png')
    .volatile(),
  pollIntervalMs: z
    .number()
    .description('Status polling interval in milliseconds.')
    .default(2000)
    .volatile(),
  timeoutMs: z
    .number()
    .description('Total generation timeout in milliseconds (submit + poll + download).')
    .default(180000)
    .volatile(),
  deliverAs: z
    .string()
    .description(
      'How the finished image reaches the conversation. '
      + '"link": the tool returns a link and the card renders the picture from it — the chat model only ever sees text, so this works with any model. '
      + '"image": the tool returns the image itself — the picture is part of the result, which a text-only chat model cannot read, so this mode needs dsh-vision-bridge (or a vision-capable chat model).'
    )
    .default('link')
    .volatile(),
  customBaseURL: z
    .string()
    .description('provider=custom: API root without a trailing slash, e.g. https://api.openai.com/v1. '
      + 'The request goes to {customBaseURL}/images/generations.')
    .default('')
    .volatile(),
  customModel: z
    .string()
    .description('provider=custom: model id, e.g. gpt-image-1.')
    .default('')
    .volatile(),
  customKeyEnv: z
    .string()
    .role('credential-ref')
    .description('provider=custom: credential reference / env var holding the API key. '
      + 'Empty means no authorization header, for gateways that need none.')
    .default('OPENAI_API_KEY')
    .volatile(),

  replicateModel: z
    .string()
    .description('provider=replicate: model identifier on Replicate.')
    .default('black-forest-labs/flux-schnell')
    .volatile(),
  replicateKeyEnv: z
    .string()
    .role('credential-ref')
    .description('provider=replicate: credential reference / env var holding API token.')
    .default('REPLICATE_API_TOKEN')
    .volatile(),

  subscriptionQuality: z
    .string()
    .description('provider=codex or grok: quality asked of the subscription — low, medium, high or empty '
      + 'for the provider default.')
    .default('')
    .volatile(),
  customSize: z
    .string()
    .description('provider=custom: fixed size sent to the API, e.g. 1024x1024. '
      + 'Empty means the named size is translated automatically — set this only for an API picky about sizes.')
    .default('')
    .volatile(),
  localKind: z
    .string()
    .description('provider=local: which local API to use — "comfyui" or "a1111".')
    .default('comfyui')
    .volatile(),
  localBaseURL: z
    .string()
    .description('provider=local: server address, e.g. http://127.0.0.1:8188 (ComfyUI) or http://127.0.0.1:7860 (A1111).')
    .default('')
    .volatile(),
  localModel: z
    .string()
    .description('provider=local: model id (A1111) or workflow/schema name (ComfyUI). Empty means the server default.')
    .default('')
    .volatile(),
  localSteps: z
    .number()
    .description('provider=local: sampling steps.')
    .default(20)
    .volatile(),
  localCfg: z
    .number()
    .description('provider=local: CFG scale.')
    .default(7)
    .volatile(),
  seedreamBaseURL: z
    .string()
    .description('provider=seedream: base URL, e.g. https://api.bytedanceapi.com/v1 or Volcengine Ark.')
    .default('https://api.bytedanceapi.com/v1')
    .volatile(),
  seedreamKeyEnv: z
    .string()
    .role('credential-ref')
    .description('provider=seedream: credential reference / env var holding the API key.')
    .default('SEEDREAM_API_KEY')
    .volatile(),
  seedreamModel: z
    .string()
    .description('provider=seedream: model id, e.g. seedream-4.0.')
    .default('seedream-4.0')
    .volatile(),
  geminiKeyEnv: z
    .string()
    .role('credential-ref')
    .description('provider=gemini: credential reference / env var holding the Google API key.')
    .default('GEMINI_API_KEY')
    .volatile(),
  geminiModel: z
    .string()
    .description('provider=gemini: model id, e.g. gemini-2.0-flash-exp-image-generation.')
    .default('gemini-2.0-flash-exp-image-generation')
    .volatile(),
  outputDir: z
    .string()
    .description('Where generated images are saved. A relative path resolves against the session working directory; an absolute path is used as given.')
    .default('generated/images')
    .volatile(),
  historyLimit: z
    .number()
    .description('How many recent generations to keep in the in-memory history list.')
    .default(50)
    .volatile(),
  pruneDays: z
    .number()
    .description('Delete generated files and history entries older than this many days. 0 (default) disables pruning.')
    .default(0)
    .volatile(),
  enhancePrompt: z
    .boolean()
    .description('Expand a short prompt into a detailed one through the chat model before generating. Off by default.')
    .default(false)
    .volatile(),
  enhanceModel: z
    .string()
    .description('Model used to enhance the prompt. Empty means the same model that leads the conversation.')
    .default('')
    .volatile(),
  autoEnhancePrompt: z
    .boolean()
    .description('Enrich prompts with photography, lighting, and composition quality tokens.')
    .default(false)
    .volatile(),
  defaultStylePreset: z
    .string()
    .description('Default style preset applied to generations (e.g. cinematic, anime, photorealistic).')
    .default('none')
    .volatile(),
  enhanceBelowChars: z
    .number()
    .description('Only enhance prompts shorter than this many characters.')
    .default(200)
    .volatile(),
  stylePreset: z
    .string()
    .description('Optional style suffix appended to the prompt before generation. Empty (default) means no style is applied and the prompt is used as-is.')
    .default('')
    .volatile(),
  cacheBySeed: z
    .boolean()
    .description('If the same seed+prompt was already generated (present in history), return the cached result instead of generating again. Off by default.')
    .default(false)
    .volatile(),
  cacheByPrompt: z
    .boolean()
    .description('If the same prompt was already generated (present in history), return the cached result instead of generating again. Off by default.')
    .default(false)
    .volatile(),
  qualityGate: z
    .boolean()
    .description('Automatic quality gate with silent re-roll for blank or defective frames. On by default.')
    .default(true)
    .volatile(),
  dailyBudgetUsd: z
    .number()
    .description('Daily image generation spending budget in USD. 0 (default) disables limit enforcement.')
    .default(0)
    .volatile(),
  loopGuardLimit: z
    .number()
    .description('Maximum consecutive image generations per session without user interaction. 0 disables protection.')
    .default(3)
    .volatile(),
  diskCache: z
    .boolean()
    .description('Content-addressed disk caching for identical generations (<50ms retrieval, zero API cost). On by default.')
    .default(true)
    .volatile(),
  fallbackProviders: z
    .array(z.string())
    .description('Ordered list of fallback providers to cascade to if the primary encounters 429, 5xx, or quota limits.')
    .default([])
    .volatile(),
})

function isVolatileRef(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.get === 'function'
}

export function plainConfig(cfg) {
  if (isVolatileRef(cfg)) return plainConfig(cfg.get())
  if (!cfg || typeof cfg !== 'object') return cfg
  const out = {}
  for (const key of Object.keys(cfg)) {
    const value = cfg[key]
    out[key] = isVolatileRef(value) ? value.get() : value
  }
  return out
}

export function volatileConfig(cfg) {
  const plain = plainConfig(cfg)
  if (!plain || typeof plain !== 'object') return plain
  const out = {}
  for (const [key, field] of Object.entries(Config.dict || {})) {
    if (field?.meta?.volatile && Object.hasOwn(plain, key)) {
      out[key] = plain[key]
    }
  }
  return out
}

export function publicConfig(cfg) {
  return plainConfig(cfg)
}

/** Keep a file stem safe for the filesystem. */
/** Read source image for editing: filesystem path or attachment id. */
export async function resolveSource(ctx, exec, ref) {
  if (!ref) return undefined
  const sessionCwd = exec.agent?.session?.header?.cwd
  if (ref.startsWith('sha256:')) {
    const stored = await ctx.attachments.readImage({ attachmentId: ref, mediaType: 'image/png', bytes: 0, width: 0, height: 0 })
    return { bytes: Buffer.from(stored.data), mediaType: stored.ref?.mediaType || 'image/png' }
  }
  const p = path.resolve(sessionCwd || process.cwd(), ref)
  const bytes = await readFile(p)
  const ext = path.extname(p).toLowerCase()
  const mediaType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
    : ext === '.svg' ? 'image/svg+xml'
    : 'image/png'
  return { bytes, mediaType }
}

export function slugify(input) {
  const stem = String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/gi, '-')
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

/** Collect text chunks from llm.stream iterator. */
export async function collectText(iterable) {
  let out = ''
  let sawDelta = false
  for await (const chunk of iterable) {
    if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      out += chunk.text
      sawDelta = true
    } else if (
      !sawDelta && chunk && chunk.type === 'block-end'
      && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string'
    ) {
      out += chunk.block.text
    }
  }
  return out.trim()
}

/** Expand short prompt via chat model; return original prompt on error. */
export function buildEnhancePromptSystemMessage(provider, model) {
  const isFlux = String(model || '').toLowerCase().includes('flux') || provider === 'fal'
  if (isFlux) {
    return 'You are an expert prompt engineer for FLUX image models. Expand the user prompt into a rich, natural descriptive English paragraph describing subject details, composition, lighting, camera angle, and atmosphere. Reply with ONLY the expanded prompt, no commentary, no markdown quotes.'
  }
  return 'You are an expert prompt engineer for Stable Diffusion models. Expand the user prompt into detailed comma-separated descriptive visual tags including subject, composition, studio lighting, materials, and artistic medium. Reply with ONLY the expanded prompt, no commentary.'
}

/** Expand short prompt via chat model; return original prompt on error. */
export async function enhancePrompt(ctx, cfg, prompt, signal, provider) {
  if (!cfg.enhancePrompt) return { prompt, enhanced: false }
  if (String(prompt).length >= (cfg.enhanceBelowChars || 200)) return { prompt, enhanced: false }
  try {
    const sysMsg = buildEnhancePromptSystemMessage(provider || cfg.provider, cfg.enhanceModel || cfg.model)
    const chunks = ctx.llm.stream({
      ...(signal ? { signal } : {}),
      ...(cfg.enhanceModel ? { model: cfg.enhanceModel } : {}),
      messages: [
        { role: 'system', content: sysMsg },
        { role: 'user', content: prompt },
      ],
    })
    const text = await collectText(chunks)
    if (!text) return { prompt, enhanced: false }
    return { prompt: text, enhanced: true }
  } catch (_) {
    return { prompt, enhanced: false }
  }
}

export function apply(ctx, rawConfig) {
  const config = Config(rawConfig ?? {})
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
  const live = () => Config(structuredClone(plainConfig(getConfig() ?? {}))) ?? config

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
  const imageHandler = (() => {
    return async (req, res) => {
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
  })()

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
  registerAllTools(ctx, {
    config,
    live,
    saveAndAttachResult,
    resolveSource,
    slugify,
    resolveApiKey,
  })
}
