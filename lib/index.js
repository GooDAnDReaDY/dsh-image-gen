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
import os from 'node:os'
import path from 'node:path'
import {
  IMAGE_SIZES,
  OUTPUT_FORMATS,
  PROVIDER_KEYS,
  buildSidecar,
  makeProviders,
  ASPECT_RATIOS,
  pixelDiff,
  normalizeCount,
  tryGenerate,
  fallbackOrder,
  normalizeMediaType,
  embedPngMetadata,
  removeBackgroundFal,
  upscaleImageFal,
  traceToSvg,
  estimateCost,
} from './providers.js'

export { IMAGE_SIZES, OUTPUT_FORMATS, PROVIDER_KEYS, buildSidecar, normalizeMediaType }

export const name = 'dsh-image-gen'

/** Settings namespace the Web card edits. */
const NS = 'dsh-image-gen'

// Плагин раньше назывался dsh-fal-image-gen, и у тех, кто им пользовался, все
// настройки лежат под старым именем. Оно читается как запасное и переносится
// под новое имя один раз — молча, при первом запуске после обновления.
const LEGACY_NS = 'dsh-fal-image-gen'
export const inject = ['tools', 'attachments', 'credentials', 'webServer', 'settings', 'llm']

export const Config = z.object({
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
    .description('provider=custom: credential reference / env var holding the API key. '
      + 'Empty means no authorization header, for gateways that need none.')
    .default('OPENAI_API_KEY'),

  replicateModel: z
    .string()
    .description('provider=replicate: model identifier on Replicate.')
    .default('black-forest-labs/flux-schnell'),
  replicateKeyEnv: z
    .string()
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
  seedreamKeyEnv: z
    .string()
    .description('provider=seedream: credential reference / env var holding the API key.')
    .default('SEEDREAM_API_KEY'),
  seedreamModel: z
    .string()
    .description('provider=seedream: model id, e.g. seedream-4.0.')
    .default('seedream-4.0'),
  geminiKeyEnv: z
    .string()
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
  return { bytes, mediaType: 'image/png' }
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
  try {
    const resolved = await ctx.credentials.resolve(credentialRef(ref))
    if (resolved && resolved.value) return resolved.value
  } catch {
    // fall through to the environment
  }
  const fromEnv = process.env[ref]
  if (fromEnv) return fromEnv
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
  try { require('node:fs').accessSync(entry.path) } catch (e) { return undefined }
  return {
    path: entry.path,
    url: entry.attachmentId ? `/dsh-image-gen/image?id=${encodeURIComponent(entry.attachmentId)}` : '',
    width: 0,
    height: 0,
    seed: entry.seed,
    prompt: entry.prompt,
    format: 'png',
    cached: true,
    attachment: entry.attachmentId ? { attachmentId: entry.attachmentId, mediaType: 'image/png', bytes: 0, width: 0, height: 0, name: '' } : undefined,
  }
}

/** Удалить файлы и записи истории старше pruneDays дней. */
export async function pruneHistory(entries, pruneDays) {
  if (!pruneDays || pruneDays <= 0) return entries
  const cutoff = Date.now() - pruneDays * 86400000
  const kept = []
  for (const e of entries) {
    const created = e.createdAt ? Date.parse(e.createdAt) : NaN
    if (Number.isFinite(created) && created < cutoff) {
      try { require('node:fs').unlinkSync(e.path) } catch (err) { /* файл уже удалён */ }
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
export async function enhancePrompt(ctx, cfg, prompt, signal) {
  if (!cfg.enhancePrompt) return { prompt, enhanced: false }
  if (String(prompt).length >= (cfg.enhanceBelowChars || 200)) return { prompt, enhanced: false }
  try {
    const chunks = ctx.llm.stream({
      ...(signal ? { signal } : {}),
      ...(cfg.enhanceModel ? { model: cfg.enhanceModel } : {}),
      messages: [
        { role: 'system', content: 'You expand a short image-generation prompt into a detailed one. Reply with only the expanded prompt, no commentary.' },
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

  // The Web card edits this namespace; without registering it the card binds to
  // a namespace nobody declared, stays unready and renders nothing — which is
  // why the plugin's settings tab was empty. Reading through getConfig() also
  // means an edit applies to the next call instead of after a restart.
  let getConfig = () => config
  const live = () => Config(structuredClone(getConfig() ?? {})) ?? config

  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(NS, Config, { base: config })
    migrateLegacySettings(sctx, scope)
    getConfig = () => scope.get() ?? config
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
      const exists = (p) => { try { return require('node:fs').existsSync(p) } catch { return false } }
      const entries = await readHistory()
      const withThumbs = filterHistory(entries, exists).map((e) => ({
        ...e,
        thumbnailUrl: e.attachmentId ? `/dsh-image-gen/image?id=${encodeURIComponent(e.attachmentId)}` : '',
      }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(withThumbs))
    },
  }), 'dsh-image-gen: history route')

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
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
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
          enum: ['low', 'medium', 'high'],
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
      },
      output: {
        schema: {
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
          const lines = list.map((img) => `Image generated (${img.width}×${img.height}, ${img.format}, seed ${img.seed}): ${img.path}`)
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
        const enhanced = await enhancePrompt(ctx, cfg, args.prompt, exec.signal)
        const styleSuffix = cfg.stylePreset ? `, ${cfg.stylePreset}` : ''
        const effectivePrompt = enhanced.prompt + styleSuffix
        const providers = makeProviders(
          { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
          { prompt: effectivePrompt, size, format, seed: args.seed, signal: exec.signal, negativePrompt: args.negative_prompt, guidanceScale: args.guidance_scale, source, mask, strength: args.strength, quality: args.quality, style: args.style, aspectPixels },
        )
        // Подписочные провайдеры (codex/grok) отдают {ok:false, reason} вместо исключения:
        // отказ должен дойти до модели текстом. Без проверки execute шёл дальше с пустыми
        // байтами, и пользователь получал битую карточку вместо внятного отказа.
        const guard = (generated) => { if (generated && generated.ok === false) throw new Error(generated.reason) }
        const one = async (jobSeed, providerKey, promptArg = effectivePrompt) => {
          const gen = await providers[providerKey](jobSeed, promptArg)
          guard(gen)
          let bytes = gen.bytes;
          if (mediaType === 'image/png') { bytes = embedPngMetadata(bytes, { prompt: promptArg, seed: gen.seed, provider, model: cfg.model || cfg.customModel }); }
          const mediaType = gen.mediaType
          const extension = mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : 'png'
          const stem = `${slugify(args.output_name || promptArg)}-${Date.now().toString(36)}-${jobSeed}`
          const name = `${stem}.${extension}`

          const attachment = await ctx.attachments.saveImage({
            data: new Uint8Array(bytes),
            mediaType,
            name,
          })

          const sessionCwd = exec.agent?.session?.header?.cwd
          const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir)
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

          const entry = {
            path: filePath,
            prompt: promptArg,
            provider,
            size,
            format,
            seed: gen.seed,
            createdAt: new Date().toISOString(),
            attachmentId: attachment.attachmentId,
          }
          let current = await readHistory()
          current = await pruneHistory(current, cfg.pruneDays)
          current.unshift(entry)
          if (current.length > (cfg.historyLimit || 50)) current.length = cfg.historyLimit || 50
          await writeHistory(current)

          return {
            path: filePath,
            url: deliverAs === 'image' && gen.sourceUrl ? gen.sourceUrl : localUrl,
            width: gen.width || attachment.width,
            height: gen.height || attachment.height,
            seed: gen.seed,
            prompt: promptArg,
            originalPrompt: enhanced.enhanced ? args.prompt : undefined,
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
        const generators = Object.fromEntries(PROVIDER_KEYS.map((k) => [k, (s, p) => one(s, k, p)]))
        const images = []
        const historyEntries = (cfg.cacheBySeed || cfg.cacheByPrompt) ? await readHistory() : []
        const batchPrompts = Array.isArray(args.prompts) && args.prompts.length ? args.prompts : null
        if (batchPrompts) {
          for (let i = 0; i < batchPrompts.length; i += 1) {
            const item = batchPrompts[i]
            const text = typeof item === 'string' ? item : (item && item.text) || ''
            const cached = cfg.cacheBySeed ? await cachedResult(findCached(historyEntries, seedBase + i, text)) : (cfg.cacheByPrompt ? await cachedResult(findCachedByPrompt(historyEntries, text)) : undefined)
            images.push(cached || await tryGenerate(generators, order, seedBase + i, text))
          }
        } else {
          const count = normalizeCount(args.count)
          for (let i = 0; i < count; i += 1) {
            const cached = cfg.cacheBySeed ? await cachedResult(findCached(historyEntries, seedBase + i, effectivePrompt)) : (cfg.cacheByPrompt ? await cachedResult(findCachedByPrompt(historyEntries, effectivePrompt)) : undefined)
            images.push(cached || await tryGenerate(generators, order, seedBase + i))
          }
        }
        const first = images[0]
        return { ...first, images }
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
        const source = await resolveSource(ctx, exec, args.image)
        if (!source || !source.bytes) throw new Error('Source image not found: ' + args.image)
        const cfg = readConfig(ctx)
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
        return {
          path: filePath,
          url: localUrl,
          width: res.width || attachment.width,
          height: res.height || attachment.height,
          format: 'png',
          attachment,
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
        const source = await resolveSource(ctx, exec, args.image)
        if (!source || !source.bytes) throw new Error('Source image not found: ' + args.image)
        const cfg = readConfig(ctx)
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
        return {
          path: filePath,
          url: localUrl,
          scale: args.scale || 2,
          width: res.width || attachment.width,
          height: res.height || attachment.height,
          attachment,
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
        const cfg = readConfig(ctx)
        const res = traceToSvg(source.bytes, { colorMode: args.color_mode })
        const stem = `${slugify(args.output_name || 'vector')}-${Date.now().toString(36)}`
        const name = `${stem}.svg`
        const sessionCwd = exec.agent?.session?.header?.cwd
        const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir || 'generated/images')
        await mkdir(outDir, { recursive: true })
        const filePath = path.join(outDir, name)
        await writeFile(filePath, res.bytes)
        return {
          path: filePath,
          svg: res.svg,
          format: 'svg',
        }
      },
    }),
  )

}
