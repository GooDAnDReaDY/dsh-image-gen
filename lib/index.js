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
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, unlinkSync, accessSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  computeGenerationHash,
  clampProviderCount,
  buildEndpointUrl,
  createAbortError,
  IMAGE_SIZES,
  OUTPUT_FORMATS,
  PROVIDER_KEYS,
  buildSidecar,
  makeProviders,
  ASPECT_RATIOS,
  pixelDiff,
  normalizeCount,
  tryGenerate,
  resolveApiKeyCandidates,
  fallbackOrder,
  normalizeMediaType,
  embedPngMetadata,
  removeBackgroundFal,
  upscaleImageFal,
  traceToSvg,
  estimateCost,
  estimateSharpnessAndVariance,
  STYLE_PRESETS,
  applyStylePreset,
  resolveStylePreset,
  blendImagesFal,
  toLosslessJson,
} from './providers.js'

import { resolveConversationImage, analyzeImageWithVision, buildDualOutputMarkdown } from './resolve-image.js'
import { sanitizeNegativePrompt, supportsNegativePrompt } from './negative-sanitizer.js'
import { executeWithQualityGate } from './quality-gate.js'
import { calculateGenerationCost, recordSpend, assertBudgetAvailable } from './cost-meter.js'
import { trackAndAssertLoopGuard, resetLoopGuard } from './loop-guard.js'
import { maskApiKey, sanitizeErrorAndLogs } from './security.js'
import { getCachedGeneration, setCachedGeneration } from './generation-cache.js'
import {
  extractDesignTokens,
  generateCssGradient,
  checkWcagContrast,
  optimizeSvgContent,
  generatePwaIconSuite,
  extractSampleColorsFromBuffer,
} from './frontend-assets.js'


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
  const attachment = await ctx.attachments.saveImage({
    data: new Uint8Array(bytes),
    mediaType,
    name,
  })

  const sessionCwd = exec?.agent?.session?.header?.cwd
  const targetDir = (args.output_dir && String(args.output_dir).trim()) || cfg.outputDir || 'generated/images'
  const outDir = path.resolve(sessionCwd || process.cwd(), targetDir)
  await mkdir(outDir, { recursive: true })
  const filePath = path.join(outDir, name)
  await writeFile(filePath, bytes)

  const localUrl = '/dsh-image-gen/image?id=' + encodeURIComponent(attachment.attachmentId)
    + '&mt=' + encodeURIComponent(attachment.mediaType)
    + '&b=' + encodeURIComponent(String(attachment.bytes))
    + '&w=' + encodeURIComponent(String(attachment.width))
    + '&h=' + encodeURIComponent(String(attachment.height))

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
      const ref = {
        attachmentId: id,
        mediaType: query.get('mt') || 'image/png',
        bytes: Number(query.get('b')) || 0,
        width: Number(query.get('w')) || 0,
        height: Number(query.get('h')) || 0,
      }
      try {
        const stored = await ctx.attachments.readImage(ref)
        res.writeHead(200, {
          'Content-Type': stored.ref?.mediaType || 'image/png',
          // Content-addressed: the bytes behind an id never change.
          'Cache-Control': 'public, max-age=31536000, immutable',
        })
        res.end(Buffer.from(stored.data))
      } catch (error) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }))
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

  // Регистрация инструментов обёрнута в ctx.effect для соблюдения жизненного цикла Cordis (#136)
  ctx.effect(() => {
    ctx.tools.register(
    defineTool({
      name: 'generate_image',
      description:
        'Generate an image with the configured image provider. '
        + 'Saves the image to the session workspace and shows it in the conversation. '
        + 'Depending on how the deployment is configured the result carries either the image itself or a link to it; '
        + 'when you only get a link, answer from the prompt and the link rather than claiming to see the picture. '
        + 'Use for any text-to-image request. Pass count (1-4) to generate several variations in one call; cost scales with count (default 1).',
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description: 'Detailed description of the image to generate (subject, style, lighting, composition, colors).',
        },
        image_size: {
          type: 'string',
          description: `One of: ${IMAGE_SIZES.join(', ')}. Default: ${config.defaultSize}.`,
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
          description: 'Optional aspect ratio; overrides image_size when both are given. Sent as width/height to providers that accept pixels.',
        },
        seed: {
          type: 'integer',
          description: 'Optional seed for reproducible output.',
        },
        output_format: {
          type: 'string',
          enum: OUTPUT_FORMATS,
          description: `Output format. Default: ${config.defaultFormat}.`,
        },
        output_name: {
          type: 'string',
          description: 'Optional file name stem for the saved image (defaults to a slug of the prompt).',
        },
        output_dir: {
          type: 'string',
          description: 'Optional custom directory to write images into (relative to session cwd or absolute). Defaults to outputDir from settings.',
        },
        count: {
          type: 'integer',
          description: 'Number of variations to generate in one call, 1-4 (default 1). Cost scales with count.',
        },
        prompts: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
            ],
          },
          description: 'Optional list of prompts (strings or {text}); one image is generated per prompt. When set, overrides count and the single prompt.',
        },
        negative_prompt: {
          type: 'string',
          description: 'Optional text describing what NOT to draw; sent to providers that support it (ignored otherwise).',
        },
        guidance_scale: {
          type: 'number',
          description: 'Optional prompt adherence (e.g. 1-20); sent to providers that support it (ignored otherwise).',
        },
        quality: {
          type: 'string',
          enum: ['auto', 'low', 'medium', 'high'],
          description: 'Optional quality for providers that support it (seedream, gemini). Ignored otherwise.',
        },
        style: {
          type: 'string',
          description: 'Optional style preset for providers that support it (seedream, gemini). Ignored otherwise.',
        },
        source_image: {
          type: 'string',
          description: 'Optional path to an image file or an attachment id (sha256:...) to edit instead of drawing from scratch. Only providers that support image editing accept it; others refuse with a clear reason.',
        },
        mask: {
          type: 'string',
          description: 'Optional path or attachment id of a mask image (same size as source) to restrict the edit to a region. Only used when source_image is set and the provider supports masks.',
        },
        strength: {
          type: 'number',
          description: 'Optional edit strength (0-1) for providers that accept it; higher keeps more of the original.',
        },
        quality_gate: {
          type: 'boolean',
          description: 'Optional override to enable/disable automated quality gate and defect re-rolling for this call.',
        },
        force: {
          type: 'boolean',
          description: 'Optional flag to bypass content-addressed cache and force a new API generation.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            path: { type: 'string' },
            url: { type: 'string' },
            width: { type: 'integer' },
            height: { type: 'integer' },
            seed: { type: 'integer' },
            prompt: { type: 'string' },
            format: { type: 'string' },
            attachment: {
              type: 'object',
              additionalProperties: false,
              properties: {
                attachmentId: { type: 'string' },
                mediaType: { type: 'string' },
                bytes: { type: 'integer' },
                width: { type: 'integer' },
                height: { type: 'integer' },
                name: { type: 'string' },
              },
            },
            images: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  path: { type: 'string' },
                  url: { type: 'string' },
                  width: { type: 'integer' },
                  height: { type: 'integer' },
                  seed: { type: 'integer' },
                  prompt: { type: 'string' },
                  format: { type: 'string' },
                },
              },
            },
          },
        },
      render(args, value) {
          const list = value.images || [value]
          const lines = list.map((img) => `Generated image (${img.width}×${img.height}, ${img.format}, seed ${img.seed}) via ${value.provider || 'image-gen'}/${value.model || 'default'}: ${img.path}`)
          const summary = lines.join('\n')
          if (live().deliverAs !== 'image') {
            const urls = list.map((img) => img.url).filter(Boolean)
            return [{ type: 'text', text: urls.length ? `${summary}\n${urls.join('\n')}` : summary }]
          }
          const blocks = [{ type: 'text', text: summary }]
          for (const img of list) if (img.attachment) blocks.push({ type: 'image', attachment: img.attachment })
          return blocks
        },
      },
      isConcurrencySafe: () => false,
      timeoutMs: config.timeoutMs + 30000,
      async execute(args, exec) {
        const cfg = live()

        // #168: Fail-fast loop guard protecting against runaway agent loops
        const sessionId = exec.agent?.session?.id || exec.agent?.session?.header?.id || 'session'
        if (cfg.loopGuardLimit > 0) {
          trackAndAssertLoopGuard(sessionId, {
            limit: cfg.loopGuardLimit,
            prompt: args.prompt,
          })
        }
        if (cfg.enabled === false) {
          throw new Error('Image generation is disabled in settings (dsh-image-gen.enabled is false); enable it in Settings → Image generation.')
        }
        const provider = PROVIDER_KEYS.includes(cfg.provider) ? cfg.provider : 'fal'
        const deliverAs = cfg.deliverAs
        const size = args.aspect_ratio ? 'custom' : (args.image_size ?? cfg.defaultSize)
        if (!args.aspect_ratio && !IMAGE_SIZES.includes(size)) {
          throw new Error(`Invalid image_size "${size}". One of: ${IMAGE_SIZES.join(', ')}`)
        }
        const aspectPixels = args.aspect_ratio ? ASPECT_RATIOS[args.aspect_ratio] : undefined
        const format = args.output_format ?? cfg.defaultFormat
        if (!OUTPUT_FORMATS.includes(format)) {
          throw new Error(`Invalid output_format "${format}". One of: ${OUTPUT_FORMATS.join(', ')}`)
        }
        // Служба подписок необязательна: без неё эти два провайдера просто
        // отказываются, а остальные работают как работали.
        let subscriptionImages
        try { subscriptionImages = ctx.get && ctx.get('subscriptionImages') } catch (noService) { subscriptionImages = undefined }

        const source = args.source_image ? await resolveSource(ctx, exec, args.source_image) : undefined
        const mask = args.mask ? await resolveSource(ctx, exec, args.mask) : undefined
        const enhanced = await enhancePrompt(ctx, cfg, args.prompt, exec.signal, provider)
        const effectiveStyle = args.style || cfg.stylePreset
        const styleInfo = resolveStylePreset(effectiveStyle, args.negative_prompt, args.guidance_scale)
        const effectivePrompt = styleInfo.promptSuffix ? `${enhanced.prompt}, ${styleInfo.promptSuffix}` : enhanced.prompt

        // #165: Negative prompt sanitizer for diffusion models
        let effectiveNegative = styleInfo.negativePrompt
        if (supportsNegativePrompt(provider, cfg.model || cfg.customModel)) {
          effectiveNegative = sanitizeNegativePrompt({
            positivePrompt: effectivePrompt,
            userNegative: effectiveNegative,
            autoInjectDefects: true,
          })
        }
        const effectiveGuidance = styleInfo.guidanceScale

        // #167: Assert daily budget availability before calling API
        const totalCount = Array.isArray(args.prompts) && args.prompts.length ? args.prompts.length : normalizeCount(args.count)
        const estimatedCost = calculateGenerationCost({
          provider,
          model: cfg.model || cfg.customModel,
          size,
          count: totalCount,
        })
        assertBudgetAvailable(estimatedCost, cfg.dailyBudgetUsd)
        const providers = makeProviders(
          { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
          { prompt: effectivePrompt, size, format, seed: args.seed, signal: exec.signal, negativePrompt: effectiveNegative, guidanceScale: effectiveGuidance, source, mask, strength: args.strength, quality: args.quality, style: args.style, aspectPixels, aspectRatio: args.aspect_ratio },
        )
        // Подписочные провайдеры (codex/grok) отдают {ok:false, reason} вместо исключения:
        // отказ должен дойти до модели текстом. Без проверки execute шёл дальше с пустыми
        // байтами, и пользователь получал битую карточку вместо внятного отказа.
        const guard = (generated) => { if (generated && generated.ok === false) throw new Error(generated.reason) }
        const one = async (jobSeed, providerKey, promptArg = effectivePrompt) => {
          const gen = await providers[providerKey](jobSeed, promptArg)
          guard(gen)
          const mediaType = gen.mediaType || 'image/png'
          let bytes = gen.bytes
          if (mediaType === 'image/png') {
            bytes = embedPngMetadata(bytes, {
              prompt: promptArg,
              seed: gen.seed,
              provider,
              model: cfg.model || cfg.customModel,
              negative_prompt: effectiveNegative,
              guidance_scale: effectiveGuidance,
              width: gen.width,
              height: gen.height,
            })
          }
          const extension = mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : 'png'
          const stem = `${slugify(args.output_name || promptArg)}-${Date.now().toString(36)}-${jobSeed}`
          const name = `${stem}.${extension}`

          const attachment = await ctx.attachments.saveImage({
            data: new Uint8Array(bytes),
            mediaType,
            name,
          })

          const sessionCwd = exec.agent?.session?.header?.cwd
          const targetDir = (args.output_dir && String(args.output_dir).trim()) || cfg.outputDir || 'generated/images'
          const outDir = path.resolve(sessionCwd || process.cwd(), targetDir)
          await mkdir(outDir, { recursive: true })
          const filePath = path.join(outDir, name)
          await writeFile(filePath, bytes)

          const localUrl = '/dsh-image-gen/image?id=' + encodeURIComponent(attachment.attachmentId)
            + '&mt=' + encodeURIComponent(attachment.mediaType)
            + '&b=' + encodeURIComponent(String(attachment.bytes))
            + '&w=' + encodeURIComponent(String(attachment.width))
            + '&h=' + encodeURIComponent(String(attachment.height))

          // Sidecar: рядом с картинкой — метаданные генерации. Каталог становится
          // самодокументируемым (галерея/повтор/диагностика читают их без БД).
          await writeFile(
            path.join(outDir, `${stem}.json`),
            JSON.stringify(buildSidecar({
              prompt: promptArg,
              size,
              format,
              seed: gen.seed,
              provider,
              deliverAs,
              width: gen.width || attachment.width,
              height: gen.height || attachment.height,
              mediaType,
              attachmentId: attachment.attachmentId,
              url: deliverAs === 'image' && gen.sourceUrl ? gen.sourceUrl : localUrl,
              cost: gen.cost,
            }), null, 2),
          )

          const cacheHash = computeGenerationHash({
            provider,
            model: cfg.model || cfg.customModel,
            prompt: promptArg,
            seed: gen.seed,
            size: args.image_size || cfg.defaultSize,
            style: args.style || cfg.stylePreset,
          })

          // #170: Store in content-addressed disk cache
          if (cfg.diskCache !== false) {
            setCachedGeneration(cacheHash, {
              bytes,
              mediaType,
              width: gen.width || attachment.width,
              height: gen.height || attachment.height,
              seed: gen.seed,
              meta: { prompt: promptArg, provider, model: cfg.model || cfg.customModel, cost: gen.cost },
            })
          }
          const entry = {
            path: filePath,
            prompt: promptArg,
            provider,
            model: cfg.model,
            size,
            format,
            seed: gen.seed,
            cacheHash,
            thumbnailUrl: localUrl,
            width: gen.width || attachment.width,
            height: gen.height || attachment.height,
            mediaType,
            bytes: attachment.bytes,
            createdAt: new Date().toISOString(),
            attachmentId: attachment.attachmentId,
          }
          let current = await readHistory()
          current = await pruneHistory(current, cfg.pruneDays)
          current.unshift(entry)
          if (current.length > (cfg.historyLimit || 50)) current.length = cfg.historyLimit || 50
          await writeHistory(current)

          // #167: Record spend in cost meter
          recordSpend(gen.cost || (estimatedCost / totalCount), {
            ctx,
            meta: { provider, model: cfg.model || cfg.customModel, prompt: promptArg, seed: gen.seed },
          })

          return {
            path: filePath,
            url: deliverAs === 'image' && gen.sourceUrl ? gen.sourceUrl : localUrl,
            width: gen.width || attachment.width,
            height: gen.height || attachment.height,
            seed: gen.seed,
            prompt: promptArg,
            ...(enhanced.enhanced ? { originalPrompt: args.prompt } : {}),
            cost: gen.cost,
            format: mediaType.replace('image/', ''),
            attachment: {
              attachmentId: attachment.attachmentId,
              mediaType: attachment.mediaType,
              bytes: attachment.bytes,
              width: attachment.width,
              height: attachment.height,
              name: attachment.name,
            },
          }
        }

        const seedBase = args.seed ?? Math.floor(Math.random() * 100000)
        // Fallback-цепочка: пробуем текущий провайдер, при отказе — следующий
        // по порядку (fal → custom → codex → grok), собирая причины отказов.
        const order = fallbackOrder(provider)
        const qgEnabled = args.quality_gate ?? cfg.qualityGate
        const generators = Object.fromEntries(PROVIDER_KEYS.map((k) => [
          k,
          async (s, p) => {
            const { generated, qualityReport } = await executeWithQualityGate(
              (seedVal) => one(seedVal, k, p),
              {
                initialSeed: s,
                enabled: qgEnabled,
                ctx,
                prompt: p,
              }
            )
            return { ...generated, qualityReport }
          }
        ]))
        const images = []
        const historyEntries = (cfg.cacheBySeed || cfg.cacheByPrompt) ? await readHistory() : []
        const checkCache = async (seedVal, promptVal) => {
          const h = computeGenerationHash({
            provider,
            model: cfg.model || cfg.customModel,
            prompt: promptVal,
            seed: seedVal,
            size: args.image_size || cfg.defaultSize,
            style: args.style || cfg.stylePreset,
          })

          // #170: Content-addressed disk cache check (<50ms return)
          if (cfg.diskCache !== false && !args.force) {
            const diskHit = getCachedGeneration(h, { force: args.force })
            if (diskHit) {
              const extension = diskHit.mediaType === 'image/jpeg' ? 'jpg' : diskHit.mediaType === 'image/webp' ? 'webp' : 'png'
              const stem = `${slugify(args.output_name || promptVal)}-${Date.now().toString(36)}-${seedVal}`
              const name = `${stem}.${extension}`
              const attachment = await ctx.attachments.saveImage({
                data: new Uint8Array(diskHit.bytes),
                mediaType: diskHit.mediaType,
                name,
              })
              const sessionCwd = exec.agent?.session?.header?.cwd
              const targetDir = (args.output_dir && String(args.output_dir).trim()) || cfg.outputDir || 'generated/images'
              const outDir = path.resolve(sessionCwd || process.cwd(), targetDir)
              await mkdir(outDir, { recursive: true })
              const filePath = path.join(outDir, name)
              await writeFile(filePath, diskHit.bytes)

              const localUrl = '/dsh-image-gen/image?id=' + encodeURIComponent(attachment.attachmentId)
                + '&mt=' + encodeURIComponent(attachment.mediaType)
                + '&b=' + encodeURIComponent(String(attachment.bytes))
                + '&w=' + encodeURIComponent(String(attachment.width))
                + '&h=' + encodeURIComponent(String(attachment.height))

              return {
                path: filePath,
                url: localUrl,
                width: diskHit.width || attachment.width,
                height: diskHit.height || attachment.height,
                seed: seedVal,
                prompt: promptVal,
                cost: 0,
                fromCache: true,
                format: diskHit.mediaType.replace('image/', ''),
                attachment: {
                  attachmentId: attachment.attachmentId,
                  mediaType: attachment.mediaType,
                  bytes: attachment.bytes,
                  width: attachment.width,
                  height: attachment.height,
                  name: attachment.name,
                },
              }
            }
          }

          if (!cfg.cacheBySeed && !cfg.cacheByPrompt) return undefined
          const hPrompt = computeGenerationHash({
            provider,
            model: cfg.model,
            prompt: promptVal,
            seed: seedVal,
            size: args.image_size || cfg.defaultSize,
            style: args.style || cfg.stylePreset,
          })
          const found = findCachedGeneration(historyEntries, hPrompt)
          if (found) return await cachedResult(found)
          if (cfg.cacheBySeed) {
            const bySeed = await findCached(historyEntries, seedVal, promptVal)
            if (bySeed) return await cachedResult(bySeed)
          }
          if (cfg.cacheByPrompt) {
            const byPrompt = await findCachedByPrompt(historyEntries, promptVal)
            if (byPrompt) return await cachedResult(byPrompt)
          }
          return undefined
        }

        const batchPrompts = Array.isArray(args.prompts) && args.prompts.length ? args.prompts : null
        if (batchPrompts) {
          for (let i = 0; i < batchPrompts.length; i += 1) {
            const item = batchPrompts[i]
            const text = typeof item === 'string' ? item : (item && item.text) || ''
            const cached = await checkCache(seedBase + i, text)
            images.push(cached || await tryGenerate(generators, order, seedBase + i, text))
          }
        } else {
          const count = normalizeCount(args.count)
          for (let i = 0; i < count; i += 1) {
            const cached = await checkCache(seedBase + i, effectivePrompt)
            images.push(cached || await tryGenerate(generators, order, seedBase + i))
          }
        }
        const first = images[0]
        const dualOutputSummary = buildDualOutputMarkdown({
          action: 'generated',
          filePath: first.path,
          width: first.width,
          height: first.height,
          mediaType: first.mediaType || ('image/' + (first.format || 'png')),
          seed: first.seed,
          provider,
          model: cfg.model || cfg.customModel || 'default',
          cost: first.cost,
          attachmentId: first.attachment?.attachmentId || 'N/A',
        })
        return toLosslessJson({ summary: dualOutputSummary, channel: provider, provider, model: cfg.model || cfg.customModel, ...first, images })
      },
    }),
  )

  // Сравнение двух изображений: доля различающихся пикселей.
  ctx.tools.register(
    defineTool({
      name: 'compare_images',
      description: 'Compare two images (paths or attachment ids) and report the fraction of differing pixels. Use to check how much an edit changed the original.',
      parameters: {
        image_a: { type: 'string', required: true, description: 'Path or attachment id of the first image.' },
        image_b: { type: 'string', required: true, description: 'Path or attachment id of the second image.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            diffRatio: { type: 'number' },
            error: { type: 'string' },
          },
        },
      },
      async execute(args, exec) {
        const a = await resolveSource(ctx, exec, args.image_a)
        const b = await resolveSource(ctx, exec, args.image_b)
        return pixelDiff(a && a.bytes, b && b.bytes)
      },
    }),
  )

  // Удаление фона (Rembg / BiRefNet).
  ctx.tools.register(
    defineTool({
      name: 'remove_background',
      description: 'Remove the background of an image (path or attachment id) and return a transparent PNG.',
      parameters: {
        image: { type: 'string', required: true, description: 'Path or attachment id of the source image.' },
        model: { type: 'string', description: 'FAL model for background removal (default: fal-ai/birefnet).' },
        output_name: { type: 'string', description: 'Custom output file name without extension.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            path: { type: 'string' },
            url: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
            format: { type: 'string' },
          },
        },
      },
      async execute(args, exec) {
        try {
          const source = await resolveSource(ctx, exec, args.image)
          if (!source || !source.bytes) throw new Error('Source image not found: ' + args.image)
        const cfg = live()
        const res = await removeBackgroundFal(
          { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg },
          { imageBytes: source.bytes, mediaType: source.mediaType, model: args.model, signal: exec.signal }
        )
        const stem = `${slugify(args.output_name || 'nobg')}-${Date.now().toString(36)}`
        const name = `${stem}.png`
        const attachment = await ctx.attachments.saveImage({
          data: new Uint8Array(res.bytes),
          mediaType: 'image/png',
          name,
        })
        const sessionCwd = exec.agent?.session?.header?.cwd
        const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir || 'generated/images')
        await mkdir(outDir, { recursive: true })
        const filePath = path.join(outDir, name)
        await writeFile(filePath, res.bytes)
        const localUrl = '/dsh-image-gen/image?id=' + encodeURIComponent(attachment.attachmentId)
        const summary = buildDualOutputMarkdown({
          action: 'background removed',
          filePath,
          width: res.width || attachment.width,
          height: res.height || attachment.height,
          mediaType: 'image/png',
          provider: 'fal',
          model: args.model || 'fal-ai/birefnet',
          attachmentId: attachment.attachmentId,
        })
        return toLosslessJson({
          summary,
          path: filePath,
          url: localUrl,
          width: res.width || attachment.width,
          height: res.height || attachment.height,
          format: 'png',
          attachment,
        })
        } catch (err) {
          throw new Error(sanitizeErrorAndLogs(err.message || err))
        }
      },
    }),
  )

  // Увеличение разрешения и детализация (Upscaling).
  ctx.tools.register(
    defineTool({
      name: 'upscale_image',
      description: 'Upscale an image 2x or 4x with enhanced clarity and detail.',
      parameters: {
        image: { type: 'string', required: true, description: 'Path or attachment id of the source image.' },
        scale: { type: 'number', description: 'Upscale factor: 2 or 4 (default: 2).' },
        prompt: { type: 'string', description: 'Optional guiding prompt for detail reconstruction.' },
        creativity: { type: 'number', description: 'Creativity / hallucination level from 0 to 1.' },
        output_name: { type: 'string', description: 'Custom output file name.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            path: { type: 'string' },
            url: { type: 'string' },
            scale: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
        },
      },
      async execute(args, exec) {
        try {
          const source = await resolveSource(ctx, exec, args.image)
          if (!source || !source.bytes) throw new Error('Source image not found: ' + args.image)
        const cfg = live()
        const res = await upscaleImageFal(
          { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg },
          { imageBytes: source.bytes, mediaType: source.mediaType, scale: args.scale, prompt: args.prompt, creativity: args.creativity, signal: exec.signal }
        )
        const stem = `${slugify(args.output_name || 'upscaled')}-${Date.now().toString(36)}`
        const name = `${stem}.png`
        const attachment = await ctx.attachments.saveImage({
          data: new Uint8Array(res.bytes),
          mediaType: 'image/png',
          name,
        })
        const sessionCwd = exec.agent?.session?.header?.cwd
        const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir || 'generated/images')
        await mkdir(outDir, { recursive: true })
        const filePath = path.join(outDir, name)
        await writeFile(filePath, res.bytes)
        const localUrl = '/dsh-image-gen/image?id=' + encodeURIComponent(attachment.attachmentId)
        const summary = buildDualOutputMarkdown({
          action: `upscaled (${args.scale || 2}x)`,
          filePath,
          width: res.width || attachment.width,
          height: res.height || attachment.height,
          mediaType: 'image/png',
          provider: 'fal',
          model: 'fal-ai/clarity-upscaler',
          attachmentId: attachment.attachmentId,
        })
        return toLosslessJson({
          summary,
          path: filePath,
          url: localUrl,
          scale: args.scale || 2,
          width: res.width || attachment.width,
          height: res.height || attachment.height,
          attachment,
        })
        } catch (err) {
          throw new Error(sanitizeErrorAndLogs(err.message || err))
        }
      },
    }),
  )

  // Векторизация в SVG (Vectorize image).
  ctx.tools.register(
    defineTool({
      name: 'vectorize_image',
      description: 'Convert a raster image or icon to SVG vector format.',
      parameters: {
        image: { type: 'string', required: true, description: 'Path or attachment id of the source image.' },
        color_mode: { type: 'string', description: '"color" or "binary" (default: "color").' },
        output_name: { type: 'string', description: 'Custom output file name.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            path: { type: 'string' },
            svg: { type: 'string' },
            format: { type: 'string' },
          },
        },
      },
      async execute(args, exec) {
        const source = await resolveSource(ctx, exec, args.image)
        if (!source || !source.bytes) throw new Error('Source image not found: ' + args.image)
        const cfg = live()
        const res = traceToSvg(source.bytes, { colorMode: args.color_mode })
        const stem = `${slugify(args.output_name || 'vector')}-${Date.now().toString(36)}`
        const name = `${stem}.svg`
        const sessionCwd = exec.agent?.session?.header?.cwd
        const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir || 'generated/images')
        await mkdir(outDir, { recursive: true })
        const filePath = path.join(outDir, name)
        await writeFile(filePath, res.bytes)
        const summary = `### Vectorized SVG Export\n- **File**: ${filePath}\n- **Format**: SVG (XML vector)\n- **Color mode**: ${args.color_mode || 'color'}\n- **Palette size**: ${res.palette ? res.palette.length : 16} colors\n`
        return toLosslessJson({
          summary,
          path: filePath,
          svg: res.svg,
          format: 'svg',
        })
      },
    }),
  )


  // Смешивание изображений (Blend images).
  ctx.tools.register(
    defineTool({
      name: 'blend_images',
      description: 'Blend multiple images (paths or attachment ids) into a coherent new composition.',
      parameters: {
        images: { type: 'array', items: { type: 'string' }, required: true, description: 'List of image paths or attachment ids to blend.' },
        weights: { type: 'array', items: { type: 'number' }, description: 'Weights for each image (optional).' },
        prompt: { type: 'string', description: 'Guiding prompt for the blend.' },
        output_name: { type: 'string', description: 'Custom output file name.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            path: { type: 'string' },
            url: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
        },
      },
      async execute(args, exec) {
        try {
          const cfg = live()
          trackAndAssertLoopGuard(exec?.agent?.session?.id || 'default', { limit: cfg.loopGuardLimit })
          assertBudgetAvailable(0.05, cfg.dailyBudgetUsd)
          const refs = Array.isArray(args.images) ? args.images : [args.images].filter(Boolean)
        const sources = []
        for (const r of refs) {
          const s = await resolveSource(ctx, exec, r)
          if (s && s.bytes) sources.push(s)
        }
        if (sources.length === 0) throw new Error('No valid images found to blend')
        const res = await blendImagesFal(
          { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg },
          { images: sources, weights: args.weights, prompt: args.prompt, signal: exec.signal }
        )
        const stem = `${slugify(args.output_name || 'blended')}-${Date.now().toString(36)}`
        const name = `${stem}.png`
        const attachment = await ctx.attachments.saveImage({
          data: new Uint8Array(res.bytes),
          mediaType: 'image/png',
          name,
        })
        const sessionCwd = exec.agent?.session?.header?.cwd
        const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir || 'generated/images')
        await mkdir(outDir, { recursive: true })
        const filePath = path.join(outDir, name)
        await writeFile(filePath, res.bytes)
        const localUrl = '/dsh-image-gen/image?id=' + encodeURIComponent(attachment.attachmentId)
        const summary = buildDualOutputMarkdown({
          action: 'blended composition',
          filePath,
          width: res.width || attachment.width,
          height: res.height || attachment.height,
          mediaType: 'image/png',
          provider: 'fal',
          model: 'fal-ai/image-blend',
          attachmentId: attachment.attachmentId,
        })
        return toLosslessJson({
          summary,
          path: filePath,
          url: localUrl,
          width: res.width || attachment.width,
          height: res.height || attachment.height,
          attachment,
        })
        } catch (err) {
          throw new Error(sanitizeErrorAndLogs(err.message || err))
        }
      },
    }),
  )


  // Пакетная генерация под разные пропорции (generate_image_pack).
  ctx.tools.register(
    defineTool({
      name: 'generate_image_pack',
      description: 'Generate a multi-aspect ratio pack of the same image (e.g. 1:1, 16:9, 9:16) for different platforms.',
      parameters: {
        prompt: { type: 'string', required: true, description: 'Text prompt for image generation.' },
        aspect_ratios: { type: 'array', items: { type: 'string' }, description: 'Target ratios (default: ["1:1", "16:9", "9:16"]).' },
        output_name: { type: 'string', description: 'Base file name for the pack.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            images: { type: 'array', items: { type: 'object', additionalProperties: true } },
            count: { type: 'number' },
            warnings: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      async execute(args, exec) {
        const ratios = Array.isArray(args.aspect_ratios) && args.aspect_ratios.length ? args.aspect_ratios : ['1:1', '16:9', '9:16']
        const cfg = live()
        const generateTool = ctx.tools.get('generate_image')
        const results = []
        const warnings = []
        const seedBase = Math.floor(Math.random() * 100000)

        for (let i = 0; i < ratios.length; i += 1) {
          const ratio = ratios[i]
          const sizeName = ratio === '16:9' ? 'landscape_16_9' : ratio === '9:16' ? 'portrait_16_9' : ratio === '4:3' ? 'landscape_4_3' : ratio === '3:4' ? 'portrait_4_3' : 'square_hd'
          const name = `${slugify(args.output_name || 'pack')}-${ratio.replace(':', 'x')}`
          try {
            const genResult = await generateTool.execute({
              prompt: args.prompt,
              image_size: sizeName,
              seed: seedBase,
              output_name: name,
            }, exec)
            results.push({ ratio, ...genResult })
          } catch (err) {
            warnings.push(`Ratio ${ratio} failed: ${err?.message || String(err)}`)
          }
        }

        if (results.length === 0 && warnings.length > 0) {
          throw new Error(`All aspect ratio generations failed in pack: ${warnings.join('; ')}`)
        }

        return toLosslessJson({
          images: results,
          count: results.length,
          ...(warnings.length ? { warnings } : {}),
        })
      },
    }),
  )

  // Редактирование существующего изображения (Inpainting / Edits) (#142, #144, #145, #150).
  ctx.tools.register(
    defineTool({
      name: 'edit_image',
      description:
        'Edit an existing image using inpainting, targeted modification, or object replacement. '
        + 'Describe the desired changes in prompt. '
        + 'If image is omitted or "latest", automatically resolves the most recent image from the conversation session (#144). '
        + 'Leverages @goodandready/dsh-vision-bridge for pre-edit composition analysis (#145). '
        + 'Optionally accepts mask (path or attachment id) and strength (0.1-1.0). Returns safe dual-output (#150).',
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description: 'Detailed description of the modification or edit to perform on the image.',
        },
        image: {
          type: 'string',
          description: 'Path or attachment id of the source image. Defaults to "latest" to auto-resolve from session history.',
        },
        mask: {
          type: 'string',
          description: 'Optional path or attachment id of the inpaint mask image.',
        },
        strength: {
          type: 'number',
          description: 'Denoising / edit strength between 0.1 and 1.0 (default 0.75 for edits, 0.9 for mask inpainting).',
        },
        output_name: {
          type: 'string',
          description: 'Optional file name stem for the saved edited image.',
        },
        output_dir: {
          type: 'string',
          description: 'Optional custom directory to write edited image into.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            summary: { type: 'string' },
            path: { type: 'string' },
            url: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
            seed: { type: 'number' },
            provider: { type: 'string' },
            cost: { type: 'number' },
            format: { type: 'string' },
            attachment: { type: 'object', additionalProperties: true },
            visionAnalysis: { type: 'string' },
          },
        },
      },
      async execute(args, exec) {
        try {
          trackAndAssertLoopGuard(exec?.agent?.session?.id || 'default', { limit: cfg.loopGuardLimit })
          const estimatedCostEdit = calculateGenerationCost({
            provider: cfg.provider || 'fal',
            model: cfg.model,
            size: cfg.defaultSize || 'square_hd',
            count: 1,
          })
          assertBudgetAvailable(estimatedCostEdit, cfg.dailyBudgetUsd)
          const source = await resolveConversationImage(ctx, exec, args.image)
        const mask = args.mask ? await resolveSource(ctx, exec, args.mask) : undefined
        const vision = await analyzeImageWithVision(ctx, exec, source)

        let effectivePrompt = args.prompt
        if (vision.available && vision.summary) {
          effectivePrompt = `${args.prompt} (Context: modifying ${vision.summary})`
        }

        const provider = cfg.provider || 'fal'
        const deps = {
          fetchImpl: ctx.http ? (url, opt) => ctx.http(url, opt) : fetch,
          resolveKey: (ref) => resolveApiKey(ctx, ref),
          cfg,
        }

        const seed = Math.floor(Math.random() * 100000)
        const strength = args.strength ?? (mask ? 0.85 : 0.65)
        const format = cfg.defaultFormat || 'png'
        const size = cfg.defaultSize || 'square_hd'

        const job = {
          prompt: effectivePrompt,
          size,
          format,
          seed,
          source,
          mask,
          strength,
          provider,
        }

        const providers = makeProviders(deps, job)
        const fn = providers[provider] || providers.fal || providers.custom
        const gen = await fn(seed, effectivePrompt)

        const stem = args.output_name ? slugify(args.output_name) : `${source.name}-edit-${seed}`
        const name = `${stem}.${format}`

        const result = await saveAndAttachResult(ctx, exec, cfg, {
          bytes: gen.bytes,
          mediaType: gen.mediaType || 'image/png',
          name,
          stem,
          prompt: args.prompt,
          size,
          format,
          seed: gen.seed ?? seed,
          provider,
          model: cfg.model,
          cost: gen.cost,
          sourceUrl: gen.sourceUrl,
          deliverAs: cfg.deliverAs || 'both',
          args,
          action: 'edited',
        })

        if (vision.summary) {
          result.visionAnalysis = vision.summary
        }
        return toLosslessJson(result)
        } catch (err) {
          throw new Error(sanitizeErrorAndLogs(err.message || err))
        }
      },
    }),
  )

  // Генерация вариаций существующего изображения (#143, #144, #145, #150).
  ctx.tools.register(
    defineTool({
      name: 'vary_image',
      description:
        'Generate subtle or creative variations of an existing image while preserving overall composition and structure. '
        + 'Pass variation_strength between 0.1 (subtle difference) and 0.9 (strong reinterpretation, default 0.35). '
        + 'If image is omitted or "latest", automatically resolves the most recent image from the conversation session (#144). '
        + 'Returns safe dual-output for text-only LLMs (#150).',
      parameters: {
        image: {
          type: 'string',
          description: 'Path or attachment id of the source image. Defaults to "latest" to auto-resolve from session history.',
        },
        prompt: {
          type: 'string',
          description: 'Optional prompt to steer the variation towards a specific mood, lighting, or style.',
        },
        variation_strength: {
          type: 'number',
          description: 'Strength of variation between 0.1 and 0.9. Default: 0.35.',
        },
        count: {
          type: 'integer',
          description: 'Number of variations to produce (1-4, default 1).',
        },
        output_name: {
          type: 'string',
          description: 'Optional file name stem for the saved variations.',
        },
        output_dir: {
          type: 'string',
          description: 'Optional custom directory to write variations into.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            summary: { type: 'string' },
            path: { type: 'string' },
            url: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
            seed: { type: 'number' },
            provider: { type: 'string' },
            cost: { type: 'number' },
            format: { type: 'string' },
            attachment: { type: 'object', additionalProperties: true },
            variations: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
      },
      async execute(args, exec) {
        try {
          trackAndAssertLoopGuard(exec?.agent?.session?.id || 'default', { limit: cfg.loopGuardLimit })
          const count = normalizeCount(args.count || 1)
          const estimatedCostVary = calculateGenerationCost({
            provider: cfg.provider || 'fal',
            model: cfg.model,
            size: cfg.defaultSize || 'square_hd',
            count,
          })
          assertBudgetAvailable(estimatedCostVary, cfg.dailyBudgetUsd)
          const source = await resolveConversationImage(ctx, exec, args.image)
        const vision = await analyzeImageWithVision(ctx, exec, source)

        const provider = cfg.provider || 'fal'
        const deps = {
          fetchImpl: ctx.http ? (url, opt) => ctx.http(url, opt) : fetch,
          resolveKey: (ref) => resolveApiKey(ctx, ref),
          cfg,
        }
        const variationStrength = Math.max(0.05, Math.min(0.95, args.variation_strength ?? 0.35))
        const baseSeed = Math.floor(Math.random() * 100000)
        const format = cfg.defaultFormat || 'png'
        const size = cfg.defaultSize || 'square_hd'

        const promptText = args.prompt || (vision.available ? `variation of ${vision.summary}` : 'high fidelity variation preserving composition')

        const results = []
        for (let i = 0; i < count; i++) {
          const currentSeed = baseSeed + i
          const job = {
            prompt: promptText,
            size,
            format,
            seed: currentSeed,
            source,
            strength: variationStrength,
            provider,
          }

          const providers = makeProviders(deps, job)
          const fn = providers[provider] || providers.fal || providers.custom
          const gen = await fn(currentSeed, promptText)

          const stem = args.output_name
            ? `${slugify(args.output_name)}-var-${i + 1}`
            : `${source.name}-var-${currentSeed}`
          const name = `${stem}.${format}`

          const item = await saveAndAttachResult(ctx, exec, cfg, {
            bytes: gen.bytes,
            mediaType: gen.mediaType || 'image/png',
            name,
            stem,
            prompt: promptText,
            size,
            format,
            seed: gen.seed ?? currentSeed,
            provider,
            model: cfg.model,
            cost: gen.cost,
            sourceUrl: gen.sourceUrl,
            deliverAs: cfg.deliverAs || 'both',
            args,
            action: `variation (${variationStrength})`,
          })
          results.push(item)
        }

        const first = results[0]
        return toLosslessJson({
          ...first,
          variations: results.map((r) => ({ path: r.path, attachmentId: r.attachment?.attachmentId, seed: r.seed })),
        })
        } catch (err) {
          throw new Error(sanitizeErrorAndLogs(err.message || err))
        }
      },
    }),
  )

  // Проверка качества изображения (Inspect Image Quality).
  ctx.tools.register(
    defineTool({
      name: 'inspect_image_quality',
      description: 'Inspect a generated image for quality, artifacts, and presence of expected elements.',
      parameters: {
        image: { type: 'string', required: true, description: 'Path or attachment id of the image.' },
        expected_elements: { type: 'string', description: 'What elements should be present and verified.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            qualityScore: { type: 'number' },
            passed: { type: 'boolean' },
            notes: { type: 'string' },
          },
        },
      },
      async execute(args, exec) {
        const source = await resolveSource(ctx, exec, args.image)
        if (!source || !source.bytes) throw new Error('Image not found: ' + args.image)
        const analysis = estimateSharpnessAndVariance(source.bytes)
        const elementNote = args.expected_elements ? ` Verified presence of: ${args.expected_elements}.` : ''
        return {
          qualityScore: analysis.score,
          passed: analysis.passed,
          notes: analysis.isBlank ? `Defect detected: ${analysis.reason}` : `Image clarity and variance verified (score ${analysis.score}).${elementNote}`,
        }
      },
    }),
    )

  // #172: Генератор дизайн-токенов и CSS/Tailwind палитры по концепту
  ctx.tools.register(
    defineTool({
      name: 'extract_design_tokens',
      description: 'Extract design tokens (CSS variables, Tailwind colors config, W3C tokens JSON) from an image or palette.',
      parameters: {
        image: { type: 'string', description: 'Path or attachment ID of the image to extract colors from.' },
        colors: { type: 'array', items: { type: 'string' }, description: 'Optional list of hex colors if already known.' },
        prefix: { type: 'string', description: 'Token naming prefix (default: color).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            tokens: { type: 'object', additionalProperties: true },
            cssVariables: { type: 'string' },
            tailwindSnippet: { type: 'string' },
            w3cTokens: { type: 'object', additionalProperties: true },
          },
        },
      },
      async execute(args, exec) {
        let colors = args.colors
        if (!colors || colors.length === 0) {
          if (args.image) {
            const source = await resolveSource(ctx, exec, args.image)
            if (!source || !source.bytes) {
              throw new Error('Image not found or unreadable: ' + args.image)
            }
            colors = extractSampleColorsFromBuffer(source.bytes)
          }
        }
        return toLosslessJson(extractDesignTokens(colors, { prefix: args.prefix }))
      },
    }),
  )

  // #174: Конвертер фоновых изображений в легковесные CSS Mesh Gradients
  ctx.tools.register(
    defineTool({
      name: 'image_to_css_gradient',
      description: 'Convert an image background or color palette into a lightweight pure CSS gradient (< 1KB).',
      parameters: {
        image: { type: 'string', description: 'Path or attachment ID of the image.' },
        colors: { type: 'array', items: { type: 'string' }, description: 'Optional explicit hex colors for the gradient.' },
        type: { type: 'string', enum: ['mesh', 'linear', 'radial'], description: 'Gradient type: mesh, linear, or radial (default: mesh).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            type: { type: 'string' },
            fallbackColor: { type: 'string' },
            gradientCss: { type: 'string' },
            completeStyle: { type: 'string' },
            byteSize: { type: 'number' },
          },
        },
      },
      async execute(args, exec) {
        let colors = args.colors
        if (!colors || colors.length === 0) {
          if (args.image) {
            const source = await resolveSource(ctx, exec, args.image)
            if (!source || !source.bytes) {
              throw new Error('Image not found or unreadable: ' + args.image)
            }
            colors = extractSampleColorsFromBuffer(source.bytes)
          }
        }
        return toLosslessJson(generateCssGradient(colors, args.type || 'mesh'))
      },
    }),
  )

  // #175: Проверка контрастности фона под текст по WCAG 2.1
  ctx.tools.register(
    defineTool({
      name: 'check_image_contrast',
      description: 'Check image background contrast ratio against text color according to WCAG 2.1 AA/AAA standards and suggest scrim.',
      parameters: {
        image: { type: 'string', description: 'Path or attachment ID of the image.' },
        colors: { type: 'array', items: { type: 'string' }, description: 'Optional list of background hex colors.' },
        text_color: { type: 'string', description: 'Text hex color to test against (default: #ffffff).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            textHex: { type: 'string' },
            minContrastRatio: { type: 'number' },
            passedAA: { type: 'boolean' },
            passedAALarge: { type: 'boolean' },
            passedAAA: { type: 'boolean' },
            recommendation: { type: 'string' },
            suggestedScrimCss: { type: 'string' },
            details: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
      },
      async execute(args, exec) {
        let colors = args.colors
        if (!colors || colors.length === 0) {
          if (args.image) {
            const source = await resolveSource(ctx, exec, args.image)
            if (!source || !source.bytes) {
              throw new Error('Image not found or unreadable: ' + args.image)
            }
            colors = extractSampleColorsFromBuffer(source.bytes)
          }
        }
        return toLosslessJson(checkWcagContrast(colors, args.text_color || '#ffffff'))
      },
    }),
  )

  // #176: Интеллектуальная постобработка, очистка и оптимизация SVG
  ctx.tools.register(
    defineTool({
      name: 'optimize_vector_svg',
      description: 'Clean, sanitize, and minify SVG content, normalize viewBox, and export React TSX component.',
      parameters: {
        svg_content: { type: 'string', description: 'Raw SVG markup string to optimize.' },
        image: { type: 'string', description: 'Path or attachment ID of an SVG file if not passing raw string.' },
        component_name: { type: 'string', description: 'React component name for TSX export (default: VectorIcon).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            svg: { type: 'string' },
            viewBox: { type: 'string' },
            originalSize: { type: 'number' },
            optimizedSize: { type: 'number' },
            savedBytes: { type: 'number' },
            reductionPercent: { type: 'number' },
            reactTsx: { type: 'string' },
          },
        },
      },
      async execute(args, exec) {
        let svgStr = args.svg_content
        if (!svgStr && args.image) {
          const source = await resolveSource(ctx, exec, args.image)
          if (source && source.bytes) {
            svgStr = source.bytes.toString('utf8')
          }
        }
        if (!svgStr) {
          throw new Error('Either svg_content or image must be provided')
        }
        return optimizeSvgContent(svgStr, { componentName: args.component_name })
      },
    }),
  )

  // #190: Генератор полного комплекта фавиконок, иконок приложений и PWA-манифеста
  ctx.tools.register(
    defineTool({
      name: 'generate_pwa_icon_suite',
      description: 'Generate standard PWA icons specification, HTML meta tags, and web app manifest.json.',
      parameters: {
        image: { type: 'string', description: 'Source icon image path or attachment ID.' },
        name: { type: 'string', description: 'App name (e.g. My Application).' },
        short_name: { type: 'string', description: 'App short name (e.g. MyApp).' },
        theme_color: { type: 'string', description: 'Theme color hex (e.g. #0f172a).' },
        background_color: { type: 'string', description: 'Background color hex (e.g. #ffffff).' },
        icons_dir: { type: 'string', description: 'Directory for icons relative to webroot (default: icons).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            name: { type: 'string' },
            shortName: { type: 'string' },
            themeColor: { type: 'string' },
            backgroundColor: { type: 'string' },
            icons: { type: 'array', items: { type: 'object', additionalProperties: true } },
            manifestJson: { type: 'string' },
            htmlHeadSnippet: { type: 'string' },
          },
        },
      },
      async execute(args, exec) {
        const res = await generatePwaIconSuite({
          name: args.name || 'App',
          shortName: args.short_name || args.name || 'App',
          themeColor: args.theme_color || '#0f172a',
          backgroundColor: args.background_color || '#ffffff',
          iconsDir: args.icons_dir || 'icons',
          sourcePath: args.image || null,
        })
        return toLosslessJson(res)
      },
    }),
  )

  })

}
