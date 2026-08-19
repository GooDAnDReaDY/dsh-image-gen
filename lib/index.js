// dsh-fal-image-gen: a `generate_image` tool backed by the FAL queue API.
//
// Flow (FAL REST queue protocol):
//   1. POST   {baseURL}/{model}            -> { request_id, status_url, ... }
//   2. GET    status_url (poll)            -> { status: IN_QUEUE|IN_PROGRESS|COMPLETED|ERROR, response_url }
//   3. GET    response_url                 -> { images: [{ url, width, height, content_type }], seed, ... }
//   4. GET    image url                    -> image bytes
//   5. Save bytes through ctx.attachments (renders in the conversation) and
//      write a durable copy under <workspace>/<outputDir>.
//
// The API key is resolved per call through the credentials service (Settings ->
// Credentials, or $DSH_HOME/.credentials.yaml) under the configured reference
// (default FAL_API_KEY), falling back to the process environment.

import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const name = 'dsh-fal-image-gen'

/** Settings namespace the Web card edits. */
const NS = 'dsh-fal-image-gen'
export const inject = ['tools', 'attachments', 'credentials', 'webServer', 'settings']

/** Image sizes accepted by fal-ai/flux-2/klein (and most FAL flux models). */
export const IMAGE_SIZES = [
  'square_hd',
  'square',
  'portrait_4_3',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_16_9',
]

/** Output formats accepted by the model. */
export const OUTPUT_FORMATS = ['png', 'jpeg', 'webp']

export const Config = z.object({
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
  outputDir: z
    .string()
    .description('Where generated images are saved. A relative path resolves against the session working directory; an absolute path is used as given.')
    .default('generated/fal'),
})

/** Normalize a raw key into a FAL `Authorization: Key <key>` value. */
export function falAuthHeader(key) {
  const trimmed = String(key ?? '').trim()
  if (!trimmed) return ''
  return trimmed.startsWith('Key ') || trimmed.startsWith('key ')
    ? trimmed
    : `Key ${trimmed}`
}

/** Map a FAL content type onto the attachment service's supported set. */
export function normalizeMediaType(contentType, fallbackFormat) {
  const raw = String(contentType ?? '').toLowerCase()
  if (raw.includes('jpeg') || raw.includes('jpg')) return 'image/jpeg'
  if (raw.includes('webp')) return 'image/webp'
  if (raw.includes('png')) return 'image/png'
  if (fallbackFormat === 'jpeg') return 'image/jpeg'
  if (fallbackFormat === 'webp') return 'image/webp'
  return 'image/png'
}

/** Keep a file stem safe for the filesystem. */
export function slugify(input) {
  const stem = String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return stem || 'image'
}

/** Resolve the FAL API key for one call (credentials service first, then env). */
export async function resolveApiKey(ctx, ref) {
  try {
    const resolved = await ctx.credentials.resolve(credentialRef(ref))
    if (resolved && resolved.value) return resolved.value
  } catch {
    // fall through to the environment
  }
  const fromEnv = process.env[ref]
  if (fromEnv) return fromEnv
  throw new Error(
    `FAL API key not configured: set credential/env "${ref}" (Web: Settings → Credentials, or add "${ref}: <key>" to $DSH_HOME/.credentials.yaml)`,
  )
}

/** Submit a generation job to the FAL queue. */
export async function submitJob(baseURL, model, key, body, signal) {
  const res = await fetch(`${baseURL}/${model}`, {
    method: 'POST',
    headers: {
      Authorization: falAuthHeader(key),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.request_id) {
    const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data).slice(0, 600)
    throw new Error(`FAL submit failed (HTTP ${res.status}): ${detail}`)
  }
  return data
}

/** Poll the FAL status endpoint until completion, failure, timeout, or abort. */
export async function pollStatus(statusUrl, key, signal, pollIntervalMs, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (signal.aborted) throw new Error('FAL generation cancelled')
    if (Date.now() > deadline) throw new Error(`FAL generation timed out after ${timeoutMs} ms`)
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, pollIntervalMs)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })
    if (signal.aborted) throw new Error('FAL generation cancelled')
    const res = await fetch(statusUrl, { headers: { Authorization: falAuthHeader(key) }, signal })
    const data = await res.json().catch(() => ({}))
    const status = data.status
    if (status === 'COMPLETED') return data
    if (status === 'ERROR' || data.error || data.detail) {
      throw new Error(`FAL generation failed: ${JSON.stringify(data).slice(0, 600)}`)
    }
    if (status !== 'IN_QUEUE' && status !== 'IN_PROGRESS') {
      throw new Error(`Unexpected FAL status "${status}": ${JSON.stringify(data).slice(0, 300)}`)
    }
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
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-fal-image-gen/image',
    handler: async (req, res) => {
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
    },
  }), 'dsh-fal-image-gen: image route')

  ctx.tools.register(
    defineTool({
      name: 'generate_image',
      description:
        'Generate an image with the configured FAL model (default fal-ai/flux-2/klein/9b). '
        + 'Submits the prompt to the FAL queue API, waits for completion, saves the image to the '
        + 'session workspace (generated/fal/ by default) and shows it in the conversation. '
        + 'Depending on how the deployment is configured the result carries either the image itself or a link to it; '
        + 'when you only get a link, answer from the prompt and the link rather than claiming to see the picture. '
        + 'Use for any text-to-image request.',
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
          },
        },
        render(args, value) {
          const summary = `Image generated (${value.width}×${value.height}, ${value.format}, seed ${value.seed}): ${value.path}`
          // "link": the result stays text-only, so a chat model without vision
          // reads it fine; the card turns the link back into a picture.
          // "image": the picture travels in the result itself, which only a
          // vision-capable model — or dsh-vision-bridge — can handle.
          if (live().deliverAs !== 'image') {
            return [{ type: 'text', text: value.url ? `${summary}\n${value.url}` : summary }]
          }
          const blocks = [{ type: 'text', text: summary }]
          if (value.attachment) blocks.push({ type: 'image', attachment: value.attachment })
          return blocks
        },
      },
      isConcurrencySafe: () => false,
      timeoutMs: config.timeoutMs + 30000,
      async execute(args, exec) {
        const key = await resolveApiKey(ctx, live().apiKeyEnv)

        const cfg = live()
        const deliverAs = cfg.deliverAs
        const size = args.image_size ?? cfg.defaultSize
        if (!IMAGE_SIZES.includes(size)) {
          throw new Error(`Invalid image_size "${size}". One of: ${IMAGE_SIZES.join(', ')}`)
        }
        const format = args.output_format ?? cfg.defaultFormat
        if (!OUTPUT_FORMATS.includes(format)) {
          throw new Error(`Invalid output_format "${format}". One of: ${OUTPUT_FORMATS.join(', ')}`)
        }
        const body = { prompt: args.prompt, image_size: size, num_images: 1 }
        if (args.seed !== undefined) body.seed = args.seed
        if (format !== 'png') body.output_format = format

        const submit = await submitJob(cfg.baseURL, cfg.model, key, body, exec.signal)
        const statusUrl = submit.status_url || `${cfg.baseURL}/${cfg.model}/requests/${submit.request_id}/status`

        const statusBody = await pollStatus(
          statusUrl,
          key,
          exec.signal,
          cfg.pollIntervalMs,
          cfg.timeoutMs,
        )

        const resultRes = await fetch(statusBody.response_url, {
          headers: { Authorization: falAuthHeader(key) },
          signal: exec.signal,
        })
        const result = await resultRes.json().catch(() => ({}))
        const image = result.images && result.images[0]
        if (!image || !image.url) {
          throw new Error(`FAL returned no images: ${JSON.stringify(result).slice(0, 600)}`)
        }

        const download = await fetch(image.url, { signal: exec.signal })
        if (!download.ok) {
          throw new Error(`Failed to download generated image (HTTP ${download.status})`)
        }
        const bytes = Buffer.from(await download.arrayBuffer())

        const mediaType = normalizeMediaType(image.content_type, format)
        const extension = mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : 'png'
        const stem = `${slugify(args.output_name || args.prompt)}-${Date.now().toString(36)}`
        const name = `${stem}.${extension}`

        const attachment = await ctx.attachments.saveImage({
          data: new Uint8Array(bytes),
          mediaType,
          name,
        })

        // Relative outputDir belongs to the session's workspace, not to the
        // directory the harness happens to be started from.
        const sessionCwd = exec.agent?.session?.header?.cwd
        const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir)
        await mkdir(outDir, { recursive: true })
        const filePath = path.join(outDir, name)
        await writeFile(filePath, bytes)

        // The plugin's own route outlives the fal.media link, and the card
        // needs the reference anyway to verify the bytes.
        const localUrl = '/dsh-fal-image-gen/image?id=' + encodeURIComponent(attachment.attachmentId)
          + '&mt=' + encodeURIComponent(attachment.mediaType)
          + '&b=' + encodeURIComponent(String(attachment.bytes))
          + '&w=' + encodeURIComponent(String(attachment.width))
          + '&h=' + encodeURIComponent(String(attachment.height))

        return {
          path: filePath,
          url: deliverAs === 'image' ? image.url : localUrl,
          width: image.width ?? attachment.width,
          height: image.height ?? attachment.height,
          seed: result.seed ?? args.seed ?? 0,
          prompt: args.prompt,
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
      },
    }),
  )
}
