// Провайдеры генерации изображений.
//
// Провайдер получает задание и возвращает готовые байты картинки. Всё, что
// происходит дальше — вложение, файл в рабочей папке, ссылка и карточка
// в разговоре — общее для всех провайдеров и живёт в index.js.
//
// Сеть приходит параметром (fetchImpl), ключ — через resolveKey, поэтому оба
// провайдера проверяются юнит-тестами без единого реального запроса.

export const PROVIDER_KEYS = ['fal', 'custom']

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
export function makeProviders(deps, job) {
  const { fetchImpl, resolveKey, cfg } = deps
  const { prompt, size, format, seed, signal } = job

  async function fal() {
    const key = await resolveKey(cfg.apiKeyEnv)
    const body = { prompt, image_size: size, num_images: 1 }
    if (seed !== undefined) body.seed = seed
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
      seed: result.seed ?? seed ?? 0,
      sourceUrl: image.url,
    }
  }

  // Любой OpenAI-совместимый API картинок. Один запрос вместо очереди FAL.
  async function custom() {
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
    const res = await fetchImpl(`${base}/images/generations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.customModel,
        prompt,
        n: 1,
        size: cfg.customSize || SIZE_PIXELS[size] || size,
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
        seed: seed ?? 0,
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
      seed: seed ?? 0,
      sourceUrl: item.url,
    }
  }

  return { fal, custom }
}
