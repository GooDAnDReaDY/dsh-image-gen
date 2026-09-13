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
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  IMAGE_SIZES,
  OUTPUT_FORMATS,
  PROVIDER_KEYS,
  buildSidecar,
  normalizeMediaType,
  resolveApiKeyCandidates,
  toLosslessJson,
  saveAttachmentSafe,
  testProviderConnection,
} from './providers.js'

import { buildDualOutputMarkdown, resolveConversationImage, analyzeImageWithVision } from './resolve-image.js'
import { registerAllTools } from './register-tools.js'


export { IMAGE_SIZES, OUTPUT_FORMATS, PROVIDER_KEYS, buildSidecar, normalizeMediaType, resolveConversationImage, analyzeImageWithVision }


/**
 * Сохраняет сгенерированный ассет в воркспейс, регистрирует в attachments и возвращает Dual-Output (#150).
 */



export async function saveAndAttachResult(ctx, exec, cfg, {
  bytes,
  mediaType,
  name,
  stem,
  prompt,
  size,
  format,
  seed,
  provider,
  model,
  cost,
  sourceUrl,
  deliverAs,
  args = {},
  action = 'generated',
}) {
  const { attachment, localUrl } = await saveAttachmentSafe(ctx, { bytes, mediaType, name })

  const sessionCwd = exec?.agent?.session?.header?.cwd
  const targetDir = (args.output_dir && String(args.output_dir).trim()) || cfg.outputDir || 'generated/images'
  const outDir = path.resolve(sessionCwd || process.cwd(), targetDir)
  await mkdir(outDir, { recursive: true })
  const filePath = path.join(outDir, name)
  await writeFile(filePath, bytes)

  await writeFile(
    path.join(outDir, `${stem}.json`),
    JSON.stringify(buildSidecar({
      prompt,
      size,
      format,
      seed,
      provider,
      deliverAs,
      width: attachment.width,
      height: attachment.height,
      mediaType,
      attachmentId: attachment.attachmentId,
      url: deliverAs === 'image' && sourceUrl ? sourceUrl : localUrl,
      cost,
    }), null, 2),
  )

  const summary = buildDualOutputMarkdown({
    action,
    filePath,
    width: attachment.width,
    height: attachment.height,
    mediaType,
    seed,
    provider,
    model: model || cfg.model || cfg.customModel || 'default',
    cost,
    attachmentId: attachment.attachmentId,
  })

  return toLosslessJson({
    summary,
    path: filePath,
    url: deliverAs === 'image' && sourceUrl ? sourceUrl : localUrl,
    width: attachment.width,
    height: attachment.height,
    seed,
    prompt,
    cost,
    format: mediaType.replace('image/', ''),
    attachment: {
      attachmentId: attachment.attachmentId,
      mediaType: attachment.mediaType,
      bytes: attachment.bytes,
      width: attachment.width,
      height: attachment.height,
      name: attachment.name,
    },
  })
}

export const name = 'dsh-image-gen'

/** Settings namespace the Web card edits. */
const NS = 'dsh-image-gen'

// Плагин раньше назывался dsh-fal-image-gen, и у тех, кто им пользовался, все
// настройки лежат под старым именем. Оно читается как запасное и переносится
// под новое имя один раз — молча, при первом запуске после обновления.
const LEGACY_NS = 'dsh-fal-image-gen'
export const inject = ['tools', 'attachments', 'credentials', 'webServer', 'settings', 'llm', 'systemPrompt']

export const Config = z.object({
  enabled: z
    .boolean()
    .description('Master switch for image generation. When false, tools refuse to execute.')
    .default(true),
  provider: z
    .string()
    .description(`Which provider generates the image. One of: ${PROVIDER_KEYS.join(', ')}. `
      + '"fal" uses the FAL queue below; "custom" uses the OpenAI-compatible API configured under it.')
    .default('fal'),
  model: z
    .string()
    .description('FAL model id, called as {baseURL}/{model}.')
    .default('fal-ai/flux-2/klein/9b'),
  apiKeyEnv: z
    .string()
    .role('credential-ref')
    .description('Credential reference / env var holding the FAL API key (the "Key " auth prefix is added automatically when missing).')
    .default('FAL_API_KEY'),
  baseURL: z
    .string()
    .description('FAL queue base URL.')
    .default('https://queue.fal.run'),
  defaultSize: z
    .string()
    .description(`Default image size when the tool call omits image_size. One of: ${IMAGE_SIZES.join(', ')}.`)
    .default('landscape_4_3'),
  defaultFormat: z
    .string()
    .description(`Default output format. One of: ${OUTPUT_FORMATS.join(', ')}.`)
    .default('png'),
  pollIntervalMs: z
    .number()
    .description('Status polling interval in milliseconds.')
    .default(2000),
  timeoutMs: z
    .number()
    .description('Total generation timeout in milliseconds (submit + poll + download).')
    .default(180000),
  deliverAs: z
    .string()
    .description(
      'How the finished image reaches the conversation. '
      + '"link": the tool returns a link and the card renders the picture from it — the chat model only ever sees text, so this works with any model. '
      + '"image": the tool returns the image itself — the picture is part of the result, which a text-only chat model cannot read, so this mode needs dsh-vision-bridge (or a vision-capable chat model).'
    )
    .default('link'),
  customBaseURL: z
    .string()
    .description('provider=custom: API root without a trailing slash, e.g. https://api.openai.com/v1. '
      + 'The request goes to {customBaseURL}/images/generations.')
    .default(''),
  customModel: z
    .string()
    .description('provider=custom: model id, e.g. gpt-image-1.')
    .default(''),
  customKeyEnv: z
    .string()
    .role('credential-ref')
    .description('provider=custom: credential reference / env var holding the API key. '
      + 'Empty means no authorization header, for gateways that need none.')
    .default('OPENAI_API_KEY'),

  replicateModel: z
    .string()
    .description('provider=replicate: model identifier on Replicate.')
    .default('black-forest-labs/flux-schnell'),
  replicateKeyEnv: z
    .string()
    .role('credential-ref')
    .description('provider=replicate: credential reference / env var holding API token.')
    .default('REPLICATE_API_TOKEN'),

  subscriptionQuality: z
    .string()
    .description('provider=codex or grok: quality asked of the subscription — low, medium, high or empty '
      + 'for the provider default.')
    .default(''),
  customSize: z
    .string()
    .description('provider=custom: fixed size sent to the API, e.g. 1024x1024. '
      + 'Empty means the named size is translated automatically — set this only for an API picky about sizes.')
    .default(''),
  localKind: z
    .string()
    .description('provider=local: which local API to use — "comfyui" or "a1111".')
    .default('comfyui'),
  localBaseURL: z
    .string()
    .description('provider=local: server address, e.g. http://127.0.0.1:8188 (ComfyUI) or http://127.0.0.1:7860 (A1111).')
    .default(''),
  localModel: z
    .string()
    .description('provider=local: model id (A1111) or workflow/schema name (ComfyUI). Empty means the server default.')
    .default(''),
  localSteps: z
    .number()
    .description('provider=local: sampling steps.')
    .default(20),
  localCfg: z
    .number()
    .description('provider=local: CFG scale.')
    .default(7),
  seedreamBaseURL: z
    .string()
    .description('provider=seedream: base URL, e.g. https://api.bytedanceapi.com/v1 or Volcengine Ark.')
    .default('https://api.bytedanceapi.com/v1'),
  seedreamKeyEnv: z
    .string()
    .role('credential-ref')
    .description('provider=seedream: credential reference / env var holding the API key.')
    .default('SEEDREAM_API_KEY'),
  seedreamModel: z
    .string()
    .description('provider=seedream: model id, e.g. seedream-4.0.')
    .default('seedream-4.0'),
  geminiKeyEnv: z
    .string()
    .role('credential-ref')
    .description('provider=gemini: credential reference / env var holding the Google API key.')
    .default('GEMINI_API_KEY'),
  geminiModel: z
    .string()
    .description('provider=gemini: model id, e.g. gemini-2.0-flash-exp-image-generation.')
    .default('gemini-2.0-flash-exp-image-generation'),
  outputDir: z
    .string()
    .description('Where generated images are saved. A relative path resolves against the session working directory; an absolute path is used as given.')
    .default('generated/images'),
  historyLimit: z
    .number()
    .description('How many recent generations to keep in the in-memory history list.')
    .default(50),
  pruneDays: z
    .number()
    .description('Delete generated files and history entries older than this many days. 0 (default) disables pruning.')
    .default(0),
  enhancePrompt: z
    .boolean()
    .description('Expand a short prompt into a detailed one through the chat model before generating. Off by default.')
    .default(false),
  enhanceModel: z
    .string()
    .description('Model used to enhance the prompt. Empty means the same model that leads the conversation.')
    .default(''),
  autoEnhancePrompt: z
    .boolean()
    .description('Enrich prompts with photography, lighting, and composition quality tokens.')
    .default(false),
  defaultStylePreset: z
    .string()
    .description('Default style preset applied to generations (e.g. cinematic, anime, photorealistic).')
    .default('none'),
  enhanceBelowChars: z
    .number()
    .description('Only enhance prompts shorter than this many characters.')
    .default(200),
  stylePreset: z
    .string()
    .description('Optional style suffix appended to the prompt before generation. Empty (default) means no style is applied and the prompt is used as-is.')
    .default(''),
  cacheBySeed: z
    .boolean()
    .description('If the same seed+prompt was already generated (present in history), return the cached result instead of generating again. Off by default.')
    .default(false),
  cacheByPrompt: z
    .boolean()
    .description('If the same prompt was already generated (present in history), return the cached result instead of generating again. Off by default.')
    .default(false),
  qualityGate: z
    .boolean()
    .description('Automatic quality gate with silent re-roll for blank or defective frames. On by default.')
    .default(true),
  dailyBudgetUsd: z
    .number()
    .description('Daily image generation spending budget in USD. 0 (default) disables limit enforcement.')
    .default(0),
  loopGuardLimit: z
    .number()
    .description('Maximum consecutive image generations per session without user interaction. 0 disables protection.')
    .default(3),
  diskCache: z
    .boolean()
    .description('Content-addressed disk caching for identical generations (<50ms retrieval, zero API cost). On by default.')
    .default(true),
})

/** Keep a file stem safe for the filesystem. */
/** Прочитать исходное изображение для правки: путь к файлу или attachment id. */
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
    } catch {
      // fall through to the environment
    }
    const fromEnv = process.env[candidate]
    if (fromEnv) return fromEnv
  }
  throw new Error(
    `API key not configured: set credential/env "${ref}" (Web: Settings → Credentials, or add "${ref}: <key>" to $DSH_HOME/.credentials.yaml)`,
  )
}

/**
 * Перенести настройки из-под старого имени плагина.
 *
 * Берётся сырой пользовательский слой: значения по умолчанию переносить незачем,
 * а отличить их от заданных руками можно только по нему. Если под новым именем
 * человек уже что-то задал, не трогаем ничего — его выбор новее.
 *
 * Старый блок остаётся в файле нетронутым: удалять чужие строки из настроек
 * пользователя плагину не по чину, а лишним он не мешает.
 */
function migrateLegacySettings(sctx, scope) {
  try {
    const readSection = sctx.settings.section
    if (typeof readSection !== 'function') return
    const legacy = readSection.call(sctx.settings, LEGACY_NS)
    if (!legacy || typeof legacy !== 'object' || Object.keys(legacy).length === 0) return
    const mine = readSection.call(sctx.settings, NS)
    if (mine && typeof mine === 'object' && Object.keys(mine).length > 0) return
    scope.update(structuredClone(legacy))
  } catch (cannotMigrate) {
    // Настройки не перенеслись — плагин работает на значениях по умолчанию,
    // и человек задаст своё в карточке. Ронять из-за этого запуск незачем.
  }
}

/** Каталог истории: общий для всех устройств, переживает рестарт. */
export function historyFile() {
  return path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-image-gen', 'history.json')
}

/** Прочитать историю из файла (пусто, если файла нет). */
/** Найти запись истории по seed+prompt, если файл ещё существует. */
/** Найти запись истории по промпту (без учёта seed), если файл существует. */
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

/** Вернуть запись из кэша, если файл существует; иначе undefined. */
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

/** Удалить файлы и записи истории старше pruneDays дней (включая .json sidecar). */
export async function pruneHistory(entries, pruneDays) {
  if (!pruneDays || pruneDays <= 0) return entries
  const cutoff = Date.now() - pruneDays * 86400000
  const kept = []
  for (const e of entries) {
    const created = e.createdAt ? Date.parse(e.createdAt) : NaN
    if (Number.isFinite(created) && created < cutoff) {
      try { unlinkSync(e.path) } catch (err) { /* файл уже удалён */ }
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

/** Записать историю в файл (перезапись целиком). */
export async function writeHistory(entries) {
  try {
    await mkdir(path.dirname(historyFile()), { recursive: true })
    await writeFile(historyFile(), JSON.stringify(entries, null, 2))
  } catch (e) { /* история не критична */ }
}

/** Отфильтровать записи, чьи файлы ещё существуют; новые первыми. */
export function filterHistory(entries, exists) {
  return entries.filter((e) => exists(e.path)).slice(0, 50)
}

/** Собрать текст из итератора llm.stream (text-delta / block-end). */
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

/** Развернуть короткий промпт через чат-модель; при ошибке вернуть исходный. */
export function buildEnhancePromptSystemMessage(provider, model) {
  const isFlux = String(model || '').toLowerCase().includes('flux') || provider === 'fal'
  if (isFlux) {
    return 'You are an expert prompt engineer for FLUX image models. Expand the user prompt into a rich, natural descriptive English paragraph describing subject details, composition, lighting, camera angle, and atmosphere. Reply with ONLY the expanded prompt, no commentary, no markdown quotes.'
  }
  return 'You are an expert prompt engineer for Stable Diffusion models. Expand the user prompt into detailed comma-separated descriptive visual tags including subject, composition, studio lighting, materials, and artistic medium. Reply with ONLY the expanded prompt, no commentary.'
}

/** Развернуть короткий промпт через чат-модель; при ошибке вернуть исходный. */
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
  } catch (e) {
    return { prompt, enhanced: false }
  }
}

export function apply(ctx, config) {
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


  // The Web card edits this namespace; without registering it the card binds to
  // a namespace nobody declared, stays unready and renders nothing — which is
  // why the plugin's settings tab was empty. Reading through getConfig() also
  // means an edit applies to the next call instead of after a restart.
  let getConfig = () => config
  const live = () => Config(structuredClone(getConfig() ?? {})) ?? config

  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(NS, Config, { base: config })
    migrateLegacySettings(sctx, scope)
    getConfig = () => (scope?.get?.() ?? config) ?? config
    sctx.effect(() => () => {
      getConfig = () => config
    })
  })

  // Serve the stored image so the tool card can show it inline. Tool cards do
  // not render image blocks — only assistant messages do — so the picture a
  // tool produces needs a URL of its own.
  //
  // Ids are content-addressed (`sha256:<hex>`), the store verifies them, and
  // the route is same-origin like every other plugin route.
  const imageHandler = (() => {
    return async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'GET only' }))
        return
      }
      const query = new URL(req.url ?? '/', 'http://x').searchParams
      const id = query.get('id') ?? ''
      if (!/^sha256:[0-9a-f]{64}$/.test(id)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'bad attachment id' }))
        return
      }
      // The store verifies the whole reference, not just the id: mediaType,
      // byte count and dimensions must match what it probes from the bytes.
      // The tool result carries all of them, so the card sends them back.
      // Nothing is gained by forging them — the bytes are still verified
      // against the sha256 in the id, and a mismatch is simply a 404.
      const rawBytes = Number(query.get('b'))
      const rawW = Number(query.get('w'))
      const rawH = Number(query.get('h'))
      const safeBytes = Number.isFinite(rawBytes) && rawBytes >= 0 ? rawBytes : 0
      const safeW = Number.isFinite(rawW) && rawW >= 0 ? rawW : 0
      const safeH = Number.isFinite(rawH) && rawH >= 0 ? rawH : 0

      const ref = {
        attachmentId: id,
        mediaType: query.get('mt') || 'image/png',
        bytes: safeBytes,
        width: safeW,
        height: safeH,
      }
      try {
        if (!ctx.attachments || typeof ctx.attachments.readImage !== 'function') {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'attachment service unavailable' }))
          return
        }
        const stored = await ctx.attachments.readImage(ref)
        res.writeHead(200, {
          'Content-Type': stored.ref?.mediaType || 'image/png',
          // Content-addressed: the bytes behind an id never change.
          'Cache-Control': 'public, max-age=31536000, immutable',
        })
        res.end(Buffer.from(stored.data))
      } catch (error) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'image not found or reference mismatch' }))
      }
    }
  })()

  // Два адреса, один обработчик. Новый — тот, что уходит в новые сообщения;
  // старый остался от прежнего имени плагина, и по нему сделаны ссылки в уже
  // отправленных: сними его — и картинки в истории разговоров перестанут
  // показываться.
  for (const path of ['/dsh-image-gen/image', '/dsh-fal-image-gen/image']) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path,
      handler: imageHandler,
    }), `dsh-image-gen: image route ${path}`)
  }

  // Диагностика подключения к провайдерам
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/diagnostics/test',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'GET only' }))
        return
      }
      try {
        const u = new URL(req.url, 'http://localhost')
        const provider = u.searchParams.get('provider') || config.provider || 'fal'
        const deps = {
          fetchImpl: fetch,
          resolveKey: (ref) => resolveApiKey(ctx, ref),
          cfg: (typeof getConfig === "function") ? getConfig() : config,
          ctx,
        }
        const result = await testProviderConnection(deps, provider)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ provider, ...result }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    },
  }), 'dsh-image-gen: diagnostics test route')

    // История генераций: in-memory список, отфильтрованный по существованию файлов.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-gen/history',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'GET only' }))
        return
      }
      const exists = (p) => existsSync(p)
      const entries = await readHistory()
      const withThumbs = filterHistory(entries, exists).map((e) => ({
        ...e,
        thumbnailUrl: e.attachmentId ? `/dsh-image-gen/image?id=${encodeURIComponent(e.attachmentId)}` : '',
      }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(withThumbs))
    },
  }), 'dsh-image-gen: history route')

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
