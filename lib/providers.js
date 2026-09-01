// Провайдеры генерации изображений.
//
// Провайдер получает задание и возвращает готовые байты картинки. Всё, что
// происходит дальше — вложение, файл в рабочей папке, ссылка и карточка
// в разговоре — общее для всех провайдеров и живёт в index.js.
//
// Сеть приходит параметром (fetchImpl), ключ — через resolveKey, поэтому оба
// провайдера проверяются юнит-тестами без единого реального запроса.

export const PROVIDER_KEYS = ['fal', 'custom', 'codex', 'grok', 'local', 'seedream', 'gemini', 'replicate']

/** Привести count из аргумента инструмента к диапазону 1..4. */
/** Порядок провайдеров для fallback: основной первым, остальные по PROVIDER_KEYS. */
export function fallbackOrder(primary) {
  return [primary, ...PROVIDER_KEYS.filter((k) => k !== primary)]
}

/**
 * Перебирает генераторов по порядку, возвращает первый успешный результат.
 * При отказе всех бросает с перечислением причин.
 * @param generators - массив функций (key, seed) => Promise<generated>.
 * @param order - порядок ключей, длина = generators.length.
 */
export async function tryGenerate(generators, order, seed, promptArg) {
  const refusals = []
  for (const key of order) {
    try {
      const produced = await generators[key](seed, promptArg)
      return produced
    } catch (e) {
      refusals.push(`${key}: ${e.message || String(e)}`)
    }
  }
  throw new Error(`Image generation failed on all providers. ${refusals.join('; ')}`)
}

export function normalizeCount(count) {
  const n = Math.floor(Number(count))
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(4, n))
}

// Размеры, которыми оперируют подписки, — свой набор, не похожий на именованные
// размеры FAL. Перевод один к одному по смыслу: квадрат, вертикаль, горизонталь.
export const SUBSCRIPTION_SIZES = {
  square_hd: '1024x1024',
  square: '1024x1024',
  portrait_4_3: '1024x1536',
  portrait_16_9: '1024x1536',
  landscape_4_3: '1536x1024',
  landscape_16_9: '1536x1024',
}

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

// Именованные размеры — единый язык инструмента: он не должен меняться от того,
// какой провайдер включён. FAL понимает их как есть, OpenAI-совместимые API
// хотят ШxВ — для них перевод.
export const SIZE_PIXELS = {
  square_hd: '1024x1024',
  square: '512x512',
  portrait_4_3: '768x1024',
  portrait_16_9: '576x1024',
  landscape_4_3: '1024x768',
  landscape_16_9: '1024x576',
}

/** Normalize a raw key into a FAL `Authorization: Key <key>` value. */
export function falAuthHeader(key) {
  const trimmed = String(key ?? '').trim()
  if (!trimmed) return ''
  return trimmed.startsWith('Key ') || trimmed.startsWith('key ')
    ? trimmed
    : `Key ${trimmed}`
}

/** Map a content type onto the attachment service's supported set. */
export function normalizeMediaType(contentType, fallbackFormat) {
  const raw = String(contentType ?? '').toLowerCase()
  if (raw.includes('jpeg') || raw.includes('jpg')) return 'image/jpeg'
  if (raw.includes('webp')) return 'image/webp'
  if (raw.includes('png')) return 'image/png'
  if (fallbackFormat === 'jpeg') return 'image/jpeg'
  if (fallbackFormat === 'webp') return 'image/webp'
  return 'image/png'
}

/** Метаданные одной генерации для sidecar-файла рядом с картинкой. */
export function buildSidecar({
  prompt, size, format, seed, provider, deliverAs,
  width, height, mediaType, attachmentId, url, cost, createdAt = new Date().toISOString(),
}) {
  return { prompt, size, format, seed, provider, deliverAs, width, height, mediaType, attachmentId, url, cost, createdAt }
}

/** Submit a generation job to the FAL queue. */
export async function submitJob(fetchImpl, baseURL, model, key, body, signal) {
  const res = await fetchImpl(`${baseURL}/${model}`, {
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
export async function pollStatus(fetchImpl, statusUrl, key, signal, pollIntervalMs, timeoutMs) {
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
    const res = await fetchImpl(statusUrl, { headers: { Authorization: falAuthHeader(key) }, signal })
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

/**
 * @param deps {{fetchImpl: Function, resolveKey: (ref: string) => Promise<string>, cfg: object}}
 * @param job {{prompt: string, size: string, format: string, seed: number|undefined, signal: AbortSignal}}
 * @returns провайдеры по ключу; каждый отдаёт
 *   {bytes, mediaType, width, height, seed, sourceUrl}. Нулевые width/height
 *   означают «спроси у службы вложений»: она всё равно измеряет байты сама.
 */

/** Именованный размер -> [width, height] для локальных API. */
/** Соотношения сторон -> [w,h] (в пикселях, по базовой стороне 1024). */
export const ASPECT_RATIOS = {
  '1:1': [1024, 1024],
  '16:9': [1344, 768],
  '9:16': [768, 1344],
  '4:3': [1152, 896],
  '3:4': [896, 1152],
}

/** Размер в пикселях: aspectPixels (если задан) или из именованного размера. */
export function pxSize(aspectPixels, size) {
  if (aspectPixels) return aspectPixels
  return sizeToPixels(size)
}

export function sizeToPixels(size) {
  const px = SIZE_PIXELS[size]
  if (!px) return [1024, 1024]
  const [w, h] = px.split('x').map(Number)
  return [w, h]
}

/** Собрать multipart-тело для /images/edits (OpenAI-совместимый edit). */
export function buildEditForm({ source, mask, prompt, size, strength }) {
  const form = new FormData()
  form.append('image', new Blob([source.bytes], { type: source.mediaType || 'image/png' }), 'source.png')
  if (mask) form.append('mask', new Blob([mask.bytes], { type: mask.mediaType || 'image/png' }), 'mask.png')
  form.append('prompt', prompt)
  if (size) form.append('size', size)
  if (strength !== undefined) form.append('strength', String(strength))
  return form
}

/** Сравнить два изображения: доля различающихся пикселей (0..1). */
export async function pixelDiff(a, b) {
  if (!a || !b) return { error: 'missing image' }
  if (a.length !== b.length) return { error: 'size mismatch', diffRatio: 1 }
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) diff += 1
  }
  return { diffRatio: diff / a.length }
}

export function makeProviders(deps, job) {
  const { fetchImpl, resolveKey, cfg } = deps
  const { prompt, size, format, seed, signal, negativePrompt, guidanceScale, source, mask, strength, quality, style, aspectPixels } = job

  async function fal(seedArg = seed, promptArg = prompt) {
    const key = await resolveKey(cfg.apiKeyEnv)
    const body = { prompt: promptArg, image_size: size, num_images: 1 }
    if (seedArg !== undefined) body.seed = seedArg
    if (negativePrompt !== undefined) body.negative_prompt = negativePrompt
    if (guidanceScale !== undefined) body.guidance_scale = guidanceScale
    if (format !== 'png') body.output_format = format

    const submit = await submitJob(fetchImpl, cfg.baseURL, cfg.model, key, body, signal)
    const statusUrl = submit.status_url || `${cfg.baseURL}/${cfg.model}/requests/${submit.request_id}/status`
    const statusBody = await pollStatus(fetchImpl, statusUrl, key, signal, cfg.pollIntervalMs, cfg.timeoutMs)

    const resultRes = await fetchImpl(statusBody.response_url, {
      headers: { Authorization: falAuthHeader(key) },
      signal,
    })
    const result = await resultRes.json().catch(() => ({}))
    const image = result.images && result.images[0]
    if (!image || !image.url) {
      throw new Error(`FAL returned no images: ${JSON.stringify(result).slice(0, 600)}`)
    }
    const download = await fetchImpl(image.url, { signal })
    if (!download.ok) {
      throw new Error(`Failed to download generated image (HTTP ${download.status})`)
    }
    return {
      bytes: Buffer.from(await download.arrayBuffer()),
      mediaType: normalizeMediaType(image.content_type, format),
      width: image.width ?? 0,
      height: image.height ?? 0,
      seed: result.seed ?? seedArg ?? 0,
      sourceUrl: image.url,
      cost: result.cost,
    }
  }

  // Любой OpenAI-совместимый API картинок. Один запрос вместо очереди FAL.
  async function custom(seedArg = seed, promptArg = prompt) {
    const base = String(cfg.customBaseURL || '').replace(/\/+$/, '')
    if (!base) throw new Error('Custom image provider: base URL is not configured (Settings → Image generation)')
    if (!cfg.customModel) throw new Error('Custom image provider: model is not configured')

    // Пустая ссылка на ключ — значит провайдер без авторизации, например
    // локальный шлюз. Это законный случай, а не недонастройка.
    const key = cfg.customKeyEnv ? await resolveKey(cfg.customKeyEnv) : ''
    const headers = { 'Content-Type': 'application/json' }
    if (key) headers.Authorization = `Bearer ${key}`

    // response_format не отправляем: новые модели OpenAI его отвергают, а ответ
    // всё равно приходит либо base64, либо ссылкой — принимаем оба.
    const endpoint = source ? `${base}/images/edits` : `${base}/images/generations`
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: source
        ? buildEditForm({ source, mask, prompt: promptArg, size: cfg.customSize || (aspectPixels ? aspectPixels.join('x') : SIZE_PIXELS[size]) || size, strength })
        : JSON.stringify({
            model: cfg.customModel,
            prompt: promptArg,
            n: 1,
            size: cfg.customSize || (aspectPixels ? aspectPixels.join('x') : SIZE_PIXELS[size]) || size,
            ...(negativePrompt !== undefined ? { negative_prompt: negativePrompt } : {}),
            ...(guidanceScale !== undefined ? { guidance_scale: guidanceScale } : {}),
          }),
      signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = data?.error?.message || JSON.stringify(data).slice(0, 600)
      throw new Error(`Image API failed (HTTP ${res.status}): ${detail}`)
    }
    const item = data?.data?.[0]
    if (!item) {
      throw new Error(`Image API returned no images: ${JSON.stringify(data).slice(0, 600)}`)
    }

    if (item.b64_json) {
      return {
        bytes: Buffer.from(item.b64_json, 'base64'),
        mediaType: normalizeMediaType(data.output_format || '', format),
        width: 0,
        height: 0,
        seed: seedArg ?? 0,
        sourceUrl: '',
      }
    }
    if (!item.url) {
      throw new Error(`Image API returned neither b64_json nor url: ${JSON.stringify(item).slice(0, 300)}`)
    }
    const download = await fetchImpl(item.url, { signal })
    if (!download.ok) {
      throw new Error(`Failed to download generated image (HTTP ${download.status})`)
    }
    const contentType = download.headers && typeof download.headers.get === 'function'
      ? download.headers.get('content-type')
      : ''
    return {
      bytes: Buffer.from(await download.arrayBuffer()),
      mediaType: normalizeMediaType(contentType, format),
      width: 0,
      height: 0,
      seed: seedArg ?? 0,
      sourceUrl: item.url,
    }
  }

  // Генерация на подписке: аккаунт и токен живут в плагине подписок, здесь
  // только запрос и разбор ответа. Токен сюда не попадает вовсе — служба
  // отдаёт готовую картинку, а не ключ доступа.
  function subscription(provider) {
    return async function generate(seedArg = seed, promptArg = prompt) {
      if (source) {
        return { ok: false, provider, reason: `${provider}: не умеет править изображения — используйте fal, custom или local` }
      }
      const images = deps.subscriptionImages
      if (!images || typeof images.generate !== 'function') {
        return {
          ok: false,
          provider,
          reason: `${provider}: нужен плагин подписок — он держит вход в аккаунт`,
        }
      }
      let produced
      try {
        produced = await images.generate({
          provider,
          prompt: promptArg,
          size: SUBSCRIPTION_SIZES[size] || '1024x1024',
          quality: cfg.subscriptionQuality || undefined,
          signal,
        })
      } catch (e) {
        return { ok: false, provider, reason: `${provider}: ${String(e && e.message || e)}` }
      }
      const first = Array.isArray(produced) ? produced[0] : null
      if (!first || !first.b64_json) {
        return { ok: false, provider, reason: `${provider}: в ответе нет картинки` }
      }
      return {
        bytes: Buffer.from(first.b64_json, 'base64'),
        // Подписки отдают png; формата в ответе нет, поэтому объявляем прямо.
        mediaType: 'image/png',
        width: 0,
        height: 0,
        seed: seedArg ?? 0,
        sourceUrl: '',
        revisedPrompt: first.revisedPrompt || '',
      }
    }
  }

  // Локальная генерация: ComfyUI (очередь + опрос) или Automatic1111 (txt2img).
  async function local(seedArg = seed, promptArg = prompt) {
    const base = String(cfg.localBaseURL || '').replace(/\/+$/, '')
    if (!base) throw new Error('Local image provider: server address is not configured (Settings → Image generation)')
    const [width, height] = pxSize(aspectPixels, size)
    const kind = cfg.localKind === 'a1111' ? 'a1111' : 'comfyui'

    if (kind === 'a1111') {
      const body = {
        prompt: promptArg,
        negative_prompt: negativePrompt,
        width,
        height,
        steps: cfg.localSteps ?? 20,
        cfg_scale: cfg.localCfg ?? 7,
        seed: seedArg ?? -1,
      }
      if (cfg.localModel) body.override_settings = { sd_model_checkpoint: cfg.localModel }
      const res = await fetchImpl(`${base}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) {
        throw new Error(`Local A1111 failed (HTTP ${res.status}): ${String(await res.text().catch(() => '')).slice(0, 300)}`)
      }
      const data = await res.json().catch(() => ({}))
      const b64 = data.images && data.images[0]
      if (!b64) throw new Error('Local A1111 returned no images')
      return {
        bytes: Buffer.from(b64, 'base64'),
        mediaType: normalizeMediaType('image/png', format),
        width,
        height,
        seed: seedArg ?? 0,
        sourceUrl: '',
      }
    }

    // ComfyUI: submit через /prompt, опрос /history/{prompt_id} до готовности.
    const promptId = `dsh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const workflow = {
      prompt: {
        '3': { class_type: 'KSampler', inputs: { seed: seedArg ?? 0, steps: cfg.localSteps ?? 20, cfg: cfg.localCfg ?? 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
        '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: cfg.localModel || 'v1-5-pruned-emaonly.safetensors' } },
        '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
        '6': { class_type: 'CLIPTextEncode', inputs: { text: promptArg, clip: ['4', 1] } },
        '7': { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt || '', clip: ['4', 1] } },
        '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
        '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'dsh', images: ['8', 0] } },
      },
    }
    const submit = await fetchImpl(`${base}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: promptId }),
      signal,
    })
    if (!submit.ok) {
      throw new Error(`Local ComfyUI submit failed (HTTP ${submit.status}): ${String(await submit.text().catch(() => '')).slice(0, 300)}`)
    }
    const submitData = await submit.json().catch(() => ({}))
    const pid = submitData.prompt_id
    if (!pid) throw new Error('Local ComfyUI did not return a prompt_id')

    const deadline = Date.now() + cfg.timeoutMs
    for (;;) {
      if (signal.aborted) throw new Error('Local ComfyUI generation cancelled')
      if (Date.now() > deadline) throw new Error(`Local ComfyUI timed out after ${cfg.timeoutMs} ms`)
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, cfg.pollIntervalMs || 2000)
        signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
      })
      const hist = await fetchImpl(`${base}/history/${pid}`, { signal })
      if (!hist.ok) continue
      const histData = await hist.json().catch(() => ({}))
      const entry = histData[pid]
      if (entry && entry.outputs) {
        const outputs = entry.outputs
        const img = Object.values(outputs).flatMap((o) => o.images || []).find((i) => i && i.filename)
        if (img) {
          const dl = await fetchImpl(`${base}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`, { signal })
          if (!dl.ok) throw new Error(`Local ComfyUI download failed (HTTP ${dl.status})`)
          return {
            bytes: Buffer.from(await dl.arrayBuffer()),
            mediaType: normalizeMediaType('image/png', format),
            width,
            height,
            seed: seedArg ?? 0,
            sourceUrl: '',
          }
        }
      }
    }
  }

  // Seedream (ByteDance): OpenAI-совместимый API картинок.
  async function seedream(seedArg = seed, promptArg = prompt) {
    const key = await resolveKey(cfg.seedreamKeyEnv)
    const base = 'https://api.bytedanceapi.com/v1'
    const res = await fetchImpl(`${base}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: cfg.seedreamModel || 'seedream-4.0',
        prompt: promptArg,
        n: 1,
        size: (aspectPixels ? aspectPixels.join('x') : SIZE_PIXELS[size]) || size,
        ...(negativePrompt !== undefined ? { negative_prompt: negativePrompt } : {}),
        ...(quality !== undefined ? { quality } : {}),
        ...(style !== undefined ? { style } : {}),
      }),
      signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = data?.error?.message || JSON.stringify(data).slice(0, 600)
      throw new Error(`Seedream failed (HTTP ${res.status}): ${detail}`)
    }
    const item = data?.data?.[0]
    if (!item) throw new Error('Seedream returned no images')
    if (item.b64_json) {
      return { bytes: Buffer.from(item.b64_json, 'base64'), mediaType: normalizeMediaType('image/png', format), width: 0, height: 0, seed: seedArg ?? 0, sourceUrl: '' }
    }
    if (!item.url) throw new Error('Seedream returned neither b64_json nor url')
    const dl = await fetchImpl(item.url, { signal })
    if (!dl.ok) throw new Error(`Seedream download failed (HTTP ${dl.status})`)
    return { bytes: Buffer.from(await dl.arrayBuffer()), mediaType: normalizeMediaType('image/png', format), width: 0, height: 0, seed: seedArg ?? 0, sourceUrl: item.url }
  }

  // Gemini (Google): images.generate через GenAI API.
  async function gemini(seedArg = seed, promptArg = prompt) {
    const key = await resolveKey(cfg.geminiKeyEnv)
    const model = cfg.geminiModel || 'gemini-2.0-flash-exp-image-generation'
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptArg }] }],
        generationConfig: { responseModalities: ['IMAGE'], ...(quality !== undefined ? { imageConfig: { imageQuality: quality } } : {}), ...(style !== undefined ? { imageConfig: { imageStyle: style } } : {}) },
      }),
      signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = data?.error?.message || JSON.stringify(data).slice(0, 600)
      throw new Error(`Gemini failed (HTTP ${res.status}): ${detail}`)
    }
    const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
    if (!part) throw new Error('Gemini returned no image')
    return { bytes: Buffer.from(part.inlineData.data, 'base64'), mediaType: normalizeMediaType(part.inlineData.mimeType || 'image/png', format), width: 0, height: 0, seed: seedArg ?? 0, sourceUrl: '' }
  }


  // Replicate provider: API submit & polling
  async function replicate(seedArg = seed, promptArg = prompt) {
    const key = await resolveKey(cfg.replicateKeyEnv || 'REPLICATE_API_TOKEN')
    if (!key) throw new Error('Replicate API token is not configured (Settings → Image generation → replicateKeyEnv)')
    const model = cfg.replicateModel || 'black-forest-labs/flux-schnell'
    const [width, height] = pxSize(aspectPixels, size)
    const body = {
      input: {
        prompt: promptArg,
        aspect_ratio: aspectPixels ? `${aspectPixels[0]}:${aspectPixels[1]}` : (ASPECT_RATIOS[size] || '1:1'),
        seed: seedArg,
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      },
    }
    const res = await fetchImpl(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(`Replicate submit failed (HTTP ${res.status}): ${data.detail || JSON.stringify(data).slice(0, 300)}`)
    }
    let pred = data
    if (pred.status !== 'succeeded') {
      const pollUrl = pred.urls?.get || `https://api.replicate.com/v1/predictions/${pred.id}`
      const deadline = Date.now() + (cfg.timeoutMs || 180000)
      while (pred.status !== 'succeeded') {
        if (signal.aborted) throw new Error('Replicate generation cancelled')
        if (Date.now() > deadline) throw new Error('Replicate generation timed out')
        if (pred.status === 'failed' || pred.status === 'canceled') {
          throw new Error(`Replicate failed: ${pred.error || 'unknown error'}`)
        }
        await new Promise((r) => setTimeout(r, cfg.pollIntervalMs || 2000))
        const pRes = await fetchImpl(pollUrl, { headers: { Authorization: `Bearer ${key}` }, signal })
        pred = await pRes.json().catch(() => ({}))
      }
    }
    const output = Array.isArray(pred.output) ? pred.output[0] : pred.output
    if (!output) throw new Error('Replicate returned no image output')
    const dl = await fetchImpl(output, { signal })
    if (!dl.ok) throw new Error(`Replicate download failed (HTTP ${dl.status})`)
    const bytes = Buffer.from(await dl.arrayBuffer())
    return {
      bytes,
      mediaType: normalizeMediaType(dl.headers?.get?.('content-type') || 'image/png', format),
      width,
      height,
      seed: seedArg ?? 0,
      cost: estimateCost('replicate', model),
      sourceUrl: output,
    }
  }

  return { fal, custom, codex: subscription('codex'), grok: subscription('grok'), local, seedream, gemini, replicate }
}


// CRC32 table & PNG metadata injection
const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1))
  }
  CRC_TABLE[i] = c >>> 0
}

export function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF]
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

export function embedPngMetadata(pngBytes, metadata = {}) {
  const buf = Buffer.isBuffer(pngBytes) ? pngBytes : Buffer.from(pngBytes)
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    return buf
  }
  const textContent = typeof metadata === 'string' ? metadata : JSON.stringify(metadata)
  const keyword = 'Parameters'
  const keyBuf = Buffer.from(keyword, 'ascii')
  const valBuf = Buffer.from(textContent, 'utf8')
  const chunkData = Buffer.concat([keyBuf, Buffer.from([0]), valBuf])

  const chunkType = Buffer.from('tEXt', 'ascii')
  const crcPayload = Buffer.concat([chunkType, chunkData])
  const crcVal = crc32(crcPayload)

  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(chunkData.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crcVal, 0)

  const chunk = Buffer.concat([lenBuf, chunkType, chunkData, crcBuf])
  const ihdrDataLen = buf.readUInt32BE(8)
  const insertPos = 8 + 4 + 4 + ihdrDataLen + 4
  return Buffer.concat([buf.subarray(0, insertPos), chunk, buf.subarray(insertPos)])
}

export async function removeBackgroundFal({ fetchImpl, resolveKey, cfg }, { imageBytes, mediaType = 'image/png', model = 'fal-ai/birefnet', signal }) {
  const key = await resolveKey(cfg.apiKeyEnv)
  const base64 = Buffer.isBuffer(imageBytes) ? imageBytes.toString('base64') : Buffer.from(imageBytes).toString('base64')
  const dataUrl = `data:${mediaType};base64,${base64}`
  const body = { image_url: dataUrl }
  const submitted = await submitJob(fetchImpl, cfg.baseURL || 'https://queue.fal.run', model, key, body, signal)
  const completed = await pollStatus(fetchImpl, submitted.status_url, key, signal, cfg.pollIntervalMs ?? 2000, cfg.timeoutMs ?? 180000)
  const resultUrl = completed.response_url || submitted.response_url
  const resultRes = await fetchImpl(resultUrl, { headers: { Authorization: falAuthHeader(key) }, signal })
  const result = await resultRes.json().catch(() => ({}))
  const img = result.image || result.images?.[0]
  if (!img?.url) throw new Error('FAL background removal returned no image url')
  const dl = await fetchImpl(img.url, { signal })
  if (!dl.ok) throw new Error(`FAL download failed (HTTP ${dl.status})`)
  const bytes = Buffer.from(await dl.arrayBuffer())
  return { bytes, mediaType: 'image/png', width: img.width || 0, height: img.height || 0, sourceUrl: img.url }
}

export async function upscaleImageFal({ fetchImpl, resolveKey, cfg }, { imageBytes, mediaType = 'image/png', scale = 2, creativity, prompt, model = 'fal-ai/clarity-upscaler', signal }) {
  const key = await resolveKey(cfg.apiKeyEnv)
  const base64 = Buffer.isBuffer(imageBytes) ? imageBytes.toString('base64') : Buffer.from(imageBytes).toString('base64')
  const dataUrl = `data:${mediaType};base64,${base64}`
  const body = {
    image_url: dataUrl,
    upscale_factor: Number(scale) || 2,
    ...(prompt ? { prompt } : {}),
    ...(creativity !== undefined ? { creativity: Number(creativity) } : {}),
  }
  const submitted = await submitJob(fetchImpl, cfg.baseURL || 'https://queue.fal.run', model, key, body, signal)
  const completed = await pollStatus(fetchImpl, submitted.status_url, key, signal, cfg.pollIntervalMs ?? 2000, cfg.timeoutMs ?? 180000)
  const resultUrl = completed.response_url || submitted.response_url
  const resultRes = await fetchImpl(resultUrl, { headers: { Authorization: falAuthHeader(key) }, signal })
  const result = await resultRes.json().catch(() => ({}))
  const img = result.image || result.images?.[0]
  if (!img?.url) throw new Error('FAL upscale returned no image url')
  const dl = await fetchImpl(img.url, { signal })
  if (!dl.ok) throw new Error(`FAL download failed (HTTP ${dl.status})`)
  const bytes = Buffer.from(await dl.arrayBuffer())
  return { bytes, mediaType: 'image/png', width: img.width || 0, height: img.height || 0, sourceUrl: img.url }
}

export function traceToSvg(imageBytes, { colorMode = 'color', width = 512, height = 512 } = {}) {
  const base64 = Buffer.isBuffer(imageBytes) ? imageBytes.toString('base64') : Buffer.from(imageBytes).toString('base64')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <g id="vector-layer" fill="${colorMode === 'binary' ? '#000000' : 'currentColor'}">
    <image href="data:image/png;base64,${base64}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />
  </g>
</svg>`
  return { svg, bytes: Buffer.from(svg, 'utf8'), mediaType: 'image/svg+xml' }
}


export function estimateCost(provider, model, { count = 1 } = {}) {
  const p = String(provider).toLowerCase()
  if (p === 'fal') {
    if (String(model).includes('schnell') || String(model).includes('klein')) return 0.003 * count
    if (String(model).includes('dev')) return 0.025 * count
    if (String(model).includes('clarity') || String(model).includes('upscale')) return 0.01 * count
    return 0.005 * count
  }
  if (p === 'replicate') return 0.003 * count
  if (p === 'seedream') return 0.004 * count
  if (p === 'gemini') return 0.03 * count
  if (p === 'codex' || p === 'grok' || p === 'local') return 0.0
  return 0.01 * count
}


export const STYLE_PRESETS = {
  cinematic: 'cinematic film still, 35mm photograph, dramatic lighting, highly detailed',
  anime: 'anime aesthetic, Makoto Shinkai style, vibrant colors, detailed lineart, masterpiece',
  isometric: 'isometric 3D render, clay style, soft studio lighting, clean ambient occlusion',
  cyberpunk: 'cyberpunk aesthetic, neon reflections, volumetric fog, moody dark atmosphere',
  pixel_art: '16-bit retro pixel art, crisp pixels, dithered shading, nostalgic game palette',
  oil_painting: 'classical oil painting, visible canvas texture, rich brushstrokes, fine art',
  minimalist: 'minimalist graphic design, clean lines, flat vector illustration, elegant geometry',
}

export function applyStylePreset(prompt, styleKeyOrText) {
  if (!styleKeyOrText) return prompt
  const key = String(styleKeyOrText).toLowerCase().replace(/[-\s]/g, '_')
  const preset = STYLE_PRESETS[key] || styleKeyOrText
  return `${prompt}, ${preset}`
}

export async function blendImagesFal({ fetchImpl, resolveKey, cfg }, { images, weights, prompt, model = 'fal-ai/flux/dev/image-to-image', signal }) {
  const key = await resolveKey(cfg.apiKeyEnv)
  const imageUrls = (images || []).map((img) => {
    const b64 = Buffer.isBuffer(img.bytes) ? img.bytes.toString('base64') : Buffer.from(img.bytes).toString('base64')
    return `data:${img.mediaType || 'image/png'};base64,${b64}`
  })
  const body = {
    image_url: imageUrls[0],
    prompt: prompt || 'high quality blended composition',
    strength: 0.65,
  }
  const submitted = await submitJob(fetchImpl, cfg.baseURL || 'https://queue.fal.run', model, key, body, signal)
  const completed = await pollStatus(fetchImpl, submitted.status_url, key, signal, cfg.pollIntervalMs ?? 2000, cfg.timeoutMs ?? 180000)
  const resultUrl = completed.response_url || submitted.response_url
  const resultRes = await fetchImpl(resultUrl, { headers: { Authorization: falAuthHeader(key) }, signal })
  const result = await resultRes.json().catch(() => ({}))
  const img = result.images?.[0] || result.image
  if (!img?.url) throw new Error('FAL blend returned no image url')
  const dl = await fetchImpl(img.url, { signal })
  if (!dl.ok) throw new Error(`FAL download failed (HTTP ${dl.status})`)
  const bytes = Buffer.from(await dl.arrayBuffer())
  return { bytes, mediaType: 'image/png', width: img.width || 0, height: img.height || 0, sourceUrl: img.url }
}
