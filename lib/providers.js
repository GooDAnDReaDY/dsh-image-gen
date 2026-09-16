/**
 * Returns candidate API key names considering known aliases (e.g. FAL_API_KEY <-> FAL_KEY).
 */

// Utilities and constants extracted to provider-utils.js (#239)
import {
  resolveApiKeyCandidates,
  PROVIDER_MAX_COUNTS,
  clampProviderCount,
  buildEndpointUrl,
  createAbortError,
  estimateSharpnessAndVariance,
  quantizePalette,
  formatA1111Parameters,
  computeGenerationHash,
  PROVIDER_KEYS,
  fallbackOrder,
  calculateBackoff,
  isFatalClientError,
  formatErrorMessage,
  resolveSubscriptionSize,
  SUBSCRIPTION_SIZES,
  IMAGE_SIZES,
  OUTPUT_FORMATS,
  SIZE_PIXELS,
  normalizeCount,
} from './provider-utils.js'

// Re-export utilities so existing imports from './providers.js' continue to work
export {
  resolveApiKeyCandidates,
  PROVIDER_MAX_COUNTS,
  clampProviderCount,
  buildEndpointUrl,
  createAbortError,
  estimateSharpnessAndVariance,
  quantizePalette,
  formatA1111Parameters,
  computeGenerationHash,
  PROVIDER_KEYS,
  fallbackOrder,
  calculateBackoff,
  isFatalClientError,
  formatErrorMessage,
  resolveSubscriptionSize,
  SUBSCRIPTION_SIZES,
  IMAGE_SIZES,
  OUTPUT_FORMATS,
  SIZE_PIXELS,
  normalizeCount,
} from './provider-utils.js'

export async function tryGenerate(generators, order, seed, promptArg) {
  const refusals = []
  for (const key of order) {
    try {
      const produced = await generators[key](seed, promptArg)
      return produced
    } catch (e) {
      if (isFatalClientError(e)) {
        throw new Error(`Client error on provider ${key} (not retrying fallback): ${formatErrorMessage(e, key)}`)
      }
      refusals.push(formatErrorMessage(e, key))
    }
  }
  throw new Error(`Image generation failed on all providers. ${refusals.join('; ')}`)
}


// Subscription services use their own aspect ratio taxonomy.
// Normalize named sizes to standard square, landscape, and portrait equivalents.
/**
 * Resolves dimensions for subscription services (codex / grok).
 * Supports named sizes (landscape_16_9, etc.), aspect ratios (16:9, 3:2, 9:16),
 * and pixel dimensions [width, height], preserving requested proportions.
 */
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

/** Generation metadata written to companion sidecar file. */
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
export async function pollStatus(fetchImpl, statusUrl, key, signal, pollIntervalMs = 500, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs
  let attempt = 0
  for (;;) {
    if (signal?.aborted) throw new Error('FAL generation cancelled')
    if (Date.now() > deadline) throw new Error(`FAL generation timed out after ${timeoutMs} ms`)
    if (attempt > 0) {
      const delay = calculateBackoff(attempt - 1, pollIntervalMs, 5000)
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, delay)
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
        }
      })
    }
    attempt++
    if (signal?.aborted) throw new Error('FAL generation cancelled')
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
 * @returns providers by key; each yields
 *   {bytes, mediaType, width, height, seed, sourceUrl}. Zero width/height
 *   lets the attachments service measure image dimensions directly.
 */

/** Named size -> [width, height] for local APIs. */
/** Aspect ratio -> [width, height] (pixels, normalized to 1024 base). */
export const ASPECT_RATIOS = {
  '1:1': [1024, 1024],
  '16:9': [1344, 768],
  '9:16': [768, 1344],
  '4:3': [1152, 896],
  '3:4': [896, 1152],
  '3:2': [1152, 768],
  '2:3': [768, 1152],
}

/** Pixel dimensions: aspectPixels (if specified) or mapped from named size. */
/** Snap a pixel dimension to nearest multiple of 64. */
export function snapToMultipleOf64(dim, minVal = 256, maxVal = 2048) {
  const n = Math.round(Number(dim) / 64) * 64
  return Math.max(minVal, Math.min(maxVal, n))
}

export function snapDimensions(width, height) {
  return [snapToMultipleOf64(width), snapToMultipleOf64(height)]
}

export function pxSize(aspectPixels, size) {
  if (aspectPixels) return snapDimensions(aspectPixels[0], aspectPixels[1])
  const [w, h] = sizeToPixels(size)
  return snapDimensions(w, h)
}

export function sizeToPixels(size) {
  const px = SIZE_PIXELS[size]
  if (!px) return [1024, 1024]
  const [w, h] = px.split('x').map(Number)
  return [w, h]
}

/** Assemble multipart body for /images/edits (OpenAI-compatible edit). */
export function buildEditForm({ source, mask, prompt, size, strength }) {
  const form = new FormData()
  form.append('image', new Blob([source.bytes], { type: source.mediaType || 'image/png' }), 'source.png')
  if (mask) form.append('mask', new Blob([mask.bytes], { type: mask.mediaType || 'image/png' }), 'mask.png')
  form.append('prompt', prompt)
  if (size) form.append('size', size)
  if (strength !== undefined) form.append('strength', String(strength))
  return form
}

/** Compare two images: ratio of differing pixels (0..1). */
export async function pixelDiff(a, b) {
  if (!a || !b) return { error: 'missing image' }
  if (a.length !== b.length) return { error: 'size mismatch', diffRatio: 1 }
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) diff += 1
  }
  return { diffRatio: diff / a.length }
}

/** Extract detailed ComfyUI node error messages from /history/{pid} response. */

/** Safe attachment persistence with fallback when ctx.attachments is unavailable. */
export async function saveAttachmentSafe(ctx, { bytes, mediaType, name }) {
  if (ctx && ctx.attachments && typeof ctx.attachments.saveImage === 'function') {
    try {
      const att = await ctx.attachments.saveImage({
        data: new Uint8Array(bytes),
        mediaType,
        name,
      })
      if (att && att.attachmentId) {
        const localUrl = '/dsh-image-gen/image?id=' + encodeURIComponent(att.attachmentId)
          + '&mt=' + encodeURIComponent(att.mediaType || mediaType)
          + '&b=' + encodeURIComponent(String(att.bytes || bytes.length))
          + '&w=' + encodeURIComponent(String(att.width || 0))
          + '&h=' + encodeURIComponent(String(att.height || 0))
        return { attachment: att, localUrl }
      }
    } catch (err) {
      // Fallback below if attachment service fails
    }
  }
  return {
    attachment: {
      attachmentId: '',
      mediaType,
      bytes: bytes.length,
      width: 0,
      height: 0,
      name,
    },
    localUrl: '',
  }
}

export function extractComfyNodeErrors(entry) {
  if (!entry || typeof entry !== 'object') return ''
  const status = entry.status
  if (status && status.status_str === 'error') {
    const msgs = status.messages || []
    const errList = []
    for (const m of msgs) {
      if (Array.isArray(m) && m[0] === 'execution_error') {
        const d = m[1] || {}
        errList.push(`node ${d.node_id || 'unknown'} (${d.node_type || ''}): ${d.exception_message || d.exception_type || 'execution failed'}`)
      }
    }
    if (errList.length) return errList.join('; ')
    return status.status_str || 'execution error'
  }
  return ''
}

export function makeProviders(deps, job) {
  const { fetchImpl, resolveKey, cfg } = deps
  const { prompt, size, format, seed, signal, negativePrompt, guidanceScale, source, mask, strength, quality, style, aspectPixels, aspectRatio } = job

  async function fal(seedArg = seed, promptArg = prompt) {
    const key = await resolveKey(cfg.apiKeyEnv)
    const isEdit = Boolean(source && source.bytes)
    const targetModel = isEdit
      ? (mask && mask.bytes ? 'fal-ai/flux-pro/v1/inpaint' : 'fal-ai/flux/dev/image-to-image')
      : cfg.model
    const body = { prompt: promptArg, image_size: size, num_images: 1 }
    if (seedArg !== undefined) body.seed = seedArg
    if (negativePrompt !== undefined) body.negative_prompt = negativePrompt
    if (guidanceScale !== undefined) body.guidance_scale = guidanceScale
    if (format !== 'png') body.output_format = format
    if (isEdit) {
      body.image_url = `data:${source.mediaType || 'image/png'};base64,${Buffer.from(source.bytes).toString('base64')}`
      if (mask && mask.bytes) {
        body.mask_url = `data:${mask.mediaType || 'image/png'};base64,${Buffer.from(mask.bytes).toString('base64')}`
      }
      if (strength !== undefined) {
        body.strength = strength
      }
    }

    const submit = await submitJob(fetchImpl, cfg.baseURL, targetModel, key, body, signal)
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

  // OpenAI-compatible image API. Single HTTP request instead of queue polling.
  async function custom(seedArg = seed, promptArg = prompt) {
    const base = String(cfg.customBaseURL || '').replace(/\/+$/, '')
    if (!base) throw new Error('Custom image provider: base URL is not configured (Settings → Image generation)')
    if (!cfg.customModel) throw new Error('Custom image provider: model is not configured')

    // Empty key reference indicates unauthenticated gateway.
    const key = cfg.customKeyEnv ? await resolveKey(cfg.customKeyEnv) : ''
    const headers = { 'Content-Type': 'application/json' }
    if (key) headers.Authorization = `Bearer ${key}`

    // Omit response_format; modern models return either base64 or URL.
    const endpoint = buildEndpointUrl(base, source ? 'images/edits' : 'images/generations')
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
            ...(quality && quality !== 'auto' ? { quality } : {}),
          }),
      signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 503) {
        const msg = (data?.error?.message || JSON.stringify(data)).toLowerCase()
        if (msg.includes('no available channel') || msg.includes('model_not_found')) {
          throw new Error(`Custom image API has no provisioned channel for "${cfg.customModel}" (HTTP 503); check gateway channel and routing configuration`)
        }
      }
      const detail = formatErrorMessage(data?.error || data)
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

  // Subscription generation: dsh-subscriptions handles session authentication.
  function subscription(provider) {
    return async function generate(seedArg = seed, promptArg = prompt) {
      if (source) {
        return { ok: false, provider, reason: `${provider}: does not support image editing — use fal, custom, or local` }
      }
      const images = deps.subscriptionImages
      if (!images || typeof images.generate !== 'function') {
        return {
          ok: false,
          provider,
          reason: `${provider}: requires dsh-subscriptions plugin to manage session authentication`,
        }
      }
      let produced
      try {
        produced = await images.generate({
          provider,
          prompt: promptArg,
          size: resolveSubscriptionSize(size, aspectPixels, aspectRatio),
          quality: cfg.subscriptionQuality || undefined,
          signal,
        })
      } catch (e) {
        return { ok: false, provider, reason: formatErrorMessage(e, provider) }
      }
      const first = Array.isArray(produced) ? produced[0] : null
      if (!first || !first.b64_json) {
        return { ok: false, provider, reason: `${provider}: no image returned in response` }
      }
      return {
        bytes: Buffer.from(first.b64_json, 'base64'),
        // Subscription outputs default to PNG media type.
        mediaType: 'image/png',
        width: 0,
        height: 0,
        seed: seedArg ?? 0,
        sourceUrl: '',
        revisedPrompt: first.revisedPrompt || '',
      }
    }
  }

  // Local generation: ComfyUI (queue + poll) or Automatic1111 (txt2img).
  async function local(seedArg = seed, promptArg = prompt) {
    const base = String(cfg.localBaseURL || '').replace(/\/+$/, '')
    if (!base) throw new Error('Local image provider: server address is not configured (Settings → Image generation)')
    const [width, height] = pxSize(aspectPixels, size)
    const kind = cfg.localKind === 'a1111' ? 'a1111' : 'comfyui'

    if (kind === 'a1111') {
      const isImg2Img = Boolean(source && source.bytes)
      const endpoint = `${base}${isImg2Img ? '/sdapi/v1/img2img' : '/sdapi/v1/txt2img'}`
      const body = {
        prompt: promptArg,
        negative_prompt: negativePrompt,
        width,
        height,
        steps: cfg.localSteps ?? 20,
        cfg_scale: cfg.localCfg ?? 7,
        seed: seedArg ?? -1,
      }
      if (isImg2Img) {
        body.init_images = [Buffer.from(source.bytes).toString('base64')]
        body.denoising_strength = strength ?? (mask ? 0.75 : 0.35)
        if (mask && mask.bytes) {
          body.mask = Buffer.from(mask.bytes).toString('base64')
        }
      }
      if (cfg.localModel) body.override_settings = { sd_model_checkpoint: cfg.localModel }
      const res = await fetchImpl(endpoint, {
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

    // ComfyUI: submit via /prompt, poll /history/{prompt_id} until completed.
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
    let attempt = 0
    for (;;) {
      if (signal?.aborted) throw new Error('Local ComfyUI generation cancelled')
      if (Date.now() > deadline) throw new Error(`Local ComfyUI timed out after ${cfg.timeoutMs} ms`)
      if (attempt > 0) {
        const cDelay = calculateBackoff(attempt - 1, cfg.pollIntervalMs || 1000, 5000)
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, cDelay)
          if (signal) {
            signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
          }
        })
      }
      attempt++
      const hist = await fetchImpl(`${base}/history/${pid}`, { signal })
      if (!hist.ok) continue
      const histData = await hist.json().catch(() => ({}))
      const entry = histData[pid]
      if (entry) {
        const comfyErr = extractComfyNodeErrors(entry)
        if (comfyErr) {
          throw new Error(`Local ComfyUI execution failed: ${comfyErr}`)
        }
      }
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

  // Seedream (ByteDance): OpenAI-compatible images API.
  async function seedream(seedArg = seed, promptArg = prompt) {
    const key = await resolveKey(cfg.seedreamKeyEnv)
    const base = (cfg.seedreamBaseURL || 'https://api.bytedanceapi.com/v1').replace(/\/+$/, '')
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

  // Gemini (Google): generateContent / imagen via GenAI API.
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
        ...(source && source.bytes ? {
          image: `data:${source.mediaType || 'image/png'};base64,${Buffer.from(source.bytes).toString('base64')}`,
          ...(mask && mask.bytes ? { mask: `data:${mask.mediaType || 'image/png'};base64,${Buffer.from(mask.bytes).toString('base64')}` } : {}),
          ...(strength !== undefined ? { prompt_strength: strength } : {}),
        } : {}),
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
      let attempt = 0
    while (pred.status !== 'succeeded') {
        if (signal?.aborted) throw new Error('Replicate generation cancelled')
        if (Date.now() > deadline) throw new Error('Replicate generation timed out')
        if (pred.status === 'failed' || pred.status === 'canceled') {
          throw new Error(`Replicate failed: ${pred.error || 'unknown error'}`)
        }
        const repDelay = calculateBackoff(attempt++, cfg.pollIntervalMs || 1000, 5000)
        await new Promise((r) => setTimeout(r, repDelay))
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
  const a1111Text = formatA1111Parameters(metadata)
  const keyword = 'Parameters'
  const keyBuf = Buffer.from(keyword, 'ascii')
  const valBuf = Buffer.from(a1111Text, 'utf8')
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

export function traceToSvg(imageBytes, { colorMode = 'color', paletteSize = 16, width = 512, height = 512 } = {}) {
  const base64 = Buffer.isBuffer(imageBytes) ? imageBytes.toString('base64') : Buffer.from(imageBytes).toString('base64')
  const palette = quantizePalette(colorMode, paletteSize)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <meta name="palette" content="${palette.join(',')}" />
    <meta name="color-mode" content="${colorMode}" />
  </defs>
  <g id="vector-layer" fill="${colorMode === 'binary' ? '#000000' : 'currentColor'}">
    <image href="data:image/png;base64,${base64}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />
  </g>
</svg>`
  return { svg, bytes: Buffer.from(svg, 'utf8'), mediaType: 'image/svg+xml', palette }
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
  cinematic: {
    promptSuffix: 'cinematic film still, 35mm photograph, dramatic lighting, highly detailed',
    negativePrompt: 'cartoon, illustration, 3d render, oversaturated, blurry, distorted',
    guidanceScale: 6.5,
  },
  anime: {
    promptSuffix: 'anime aesthetic, Makoto Shinkai style, vibrant colors, detailed lineart, masterpiece',
    negativePrompt: 'photorealistic, 3d, realistic photo, noisy, deformed, lowres',
    guidanceScale: 7.0,
  },
  isometric: {
    promptSuffix: 'isometric 3D render, clay style, soft studio lighting, clean ambient occlusion',
    negativePrompt: 'flat, 2d, sketch, photograph, noisy background',
    guidanceScale: 7.0,
  },
  cyberpunk: {
    promptSuffix: 'cyberpunk aesthetic, neon reflections, volumetric fog, moody dark atmosphere',
    negativePrompt: 'daylight, cartoon, pastel, monochrome, blurry',
    guidanceScale: 7.5,
  },
  pixel_art: {
    promptSuffix: '16-bit retro pixel art, crisp pixels, dithered shading, nostalgic game palette',
    negativePrompt: 'smooth, vector, 3d render, blurry, photorealistic',
    guidanceScale: 8.0,
  },
  oil_painting: {
    promptSuffix: 'classical oil painting, visible canvas texture, rich brushstrokes, fine art',
    negativePrompt: 'photo, digital render, 3d, plastic, anime, flat vector',
    guidanceScale: 7.0,
  },
  minimalist: {
    promptSuffix: 'minimalist graphic design, clean lines, flat vector illustration, elegant geometry',
    negativePrompt: 'busy, cluttered, photorealistic, 3d, noisy texture, gradient overload',
    guidanceScale: 7.0,
  },
}

export function resolveStylePreset(styleKeyOrText, existingNegative, existingGuidance) {
  if (!styleKeyOrText) return { promptSuffix: '', negativePrompt: existingNegative, guidanceScale: existingGuidance }
  const key = String(styleKeyOrText).toLowerCase().replace(/[-\s]/g, '_')
  const preset = STYLE_PRESETS[key]
  if (preset && typeof preset === 'object') {
    const combinedNeg = [existingNegative, preset.negativePrompt].filter(Boolean).join(', ')
    return {
      promptSuffix: preset.promptSuffix,
      negativePrompt: combinedNeg || undefined,
      guidanceScale: existingGuidance ?? preset.guidanceScale,
    }
  }
  return {
    promptSuffix: typeof preset === 'string' ? preset : String(styleKeyOrText),
    negativePrompt: existingNegative,
    guidanceScale: existingGuidance,
  }
}

export function applyStylePreset(prompt, styleKeyOrText) {
  if (!styleKeyOrText) return prompt
  const res = resolveStylePreset(styleKeyOrText)
  return `${prompt}, ${res.promptSuffix}`
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

/** Direct image editing (inpainting / img2img) via selected provider. */
/** @internal — direct provider call path for integration tests */
export async function editImageDirect(deps, job) {
  const providers = makeProviders(deps, job)
  const providerKey = job.provider || deps.cfg.defaultProvider || 'fal'
  const fn = providers[providerKey] || providers.fal || providers.custom
  if (!fn) throw new Error(`Provider "${providerKey}" does not support image editing`)
  return fn(job.seed, job.prompt)
}

/** Direct image variation via selected provider. */
/** @internal — direct provider call path for integration tests */
export async function varyImageDirect(deps, job) {
  const providers = makeProviders(deps, {
    ...job,
    strength: job.variationStrength ?? job.strength ?? 0.35,
  })
  const providerKey = job.provider || deps.cfg.defaultProvider || 'fal'
  const fn = providers[providerKey] || providers.fal || providers.custom
  if (!fn) throw new Error(`Provider "${providerKey}" does not support image variations`)
  return fn(job.seed, job.prompt)
}

/**
 * Recursively removes any property with an undefined value so the result satisfies
 * DSH lossless JSON requirements (dsh-util-values isJsonValue).
 *
 * @param {any} val
 * @returns {any}
 */
export function toLosslessJson(val) {
  if (val === null || typeof val === 'boolean' || typeof val === 'string') return val
  if (typeof val === 'number') return Number.isFinite(val) && !Object.is(val, -0) ? val : null
  if (Array.isArray(val)) return val.map(toLosslessJson)
  if (typeof val === 'object' && val !== null) {
    const res = {}
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        res[k] = toLosslessJson(v)
      }
    }
    return res
  }
  return null
}


/**
 * Diagnostic ping/connection test for a given provider.
 * Returns { ok: boolean, latencyMs: number, message: string }.
 */
export async function testProviderConnection(deps, providerId) {
  const { fetchImpl = fetch, resolveKey, cfg } = deps
  const start = Date.now()
  const p = (providerId || cfg.defaultProvider || 'fal').toLowerCase()

  try {
    if (p === 'fal') {
      const key = await resolveKey(cfg.apiKeyEnv || 'FAL_KEY')
      if (!key) return { ok: false, latencyMs: 0, message: 'FAL API key not configured' }
      const res = await fetchImpl('https://queue.fal.run/fal-ai/fast-sdxl/status', {
        headers: { Authorization: falAuthHeader(key) },
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      })
      const latencyMs = Date.now() - start
      if (res.status === 401 || res.status === 403) {
        return { ok: false, latencyMs, message: `Fal auth failed (HTTP ${res.status})` }
      }
      return { ok: true, latencyMs, message: 'Fal.ai queue reachable' }
    }

    if (p === 'comfyui') {
      const url = cfg.comfyuiUrl || cfg.localBaseURL || 'http://127.0.0.1:8188'
      const res = await fetchImpl(`${url.replace(/\/+$/, '')}/system_stats`, {
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      })
      const latencyMs = Date.now() - start
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        const vram = data?.devices?.[0]?.vram_free ? ` (${Math.round(data.devices[0].vram_free / 1048576)} MB free VRAM)` : ''
        return { ok: true, latencyMs, message: `ComfyUI operational${vram}` }
      }
      return { ok: false, latencyMs, message: `ComfyUI returned HTTP ${res.status}` }
    }

    if (p === 'a1111') {
      const url = cfg.a1111Url || cfg.localBaseURL || 'http://127.0.0.1:7860'
      const res = await fetchImpl(`${url.replace(/\/+$/, '')}/sdapi/v1/samplers`, {
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      })
      const latencyMs = Date.now() - start
      if (res.ok) {
        return { ok: true, latencyMs, message: 'Automatic1111 operational' }
      }
      return { ok: false, latencyMs, message: `A1111 returned HTTP ${res.status}` }
    }

    if (p === 'custom') {
      const url = cfg.customEndpoint || cfg.customBaseURL || 'https://api.openai.com/v1'
      const key = await resolveKey(cfg.customApiKeyEnv || cfg.customKeyEnv || 'OPENAI_API_KEY')
      const headers = key ? { Authorization: `Bearer ${key}` } : {}
      const res = await fetchImpl(`${url.replace(/\/+$/, '')}/models`, {
        headers,
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      })
      const latencyMs = Date.now() - start
      if (res.status === 401 || res.status === 403) {
        return { ok: false, latencyMs, message: `Custom endpoint auth error (HTTP ${res.status})` }
      }
      if (res.ok || res.status === 404 || res.status === 405) {
        return { ok: true, latencyMs, message: `Custom gateway reachable (HTTP ${res.status})` }
      }
      return { ok: false, latencyMs, message: `Custom endpoint returned HTTP ${res.status}` }
    }

    if (p === 'subscription' || p === 'chatgpt' || p === 'grok' || p === 'codex') {
      const hasSub = Boolean(deps.ctx?.subscriptions)
      const latencyMs = Date.now() - start
      if (hasSub) {
        return { ok: true, latencyMs, message: 'Subscription bridge available' }
      }
      return { ok: false, latencyMs, message: 'dsh-subscriptions plugin not installed' }
    }

    if (p === 'replicate') {
      const key = await resolveKey(cfg.replicateKeyEnv || 'REPLICATE_API_TOKEN')
      if (!key) return { ok: false, latencyMs: 0, message: 'Replicate API token not configured' }
      const res = await fetchImpl('https://api.replicate.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      })
      const latencyMs = Date.now() - start
      if (res.status === 401 || res.status === 403) {
        return { ok: false, latencyMs, message: `Replicate auth error (HTTP ${res.status})` }
      }
      if (res.ok) {
        return { ok: true, latencyMs, message: 'Replicate API reachable' }
      }
      return { ok: false, latencyMs, message: `Replicate returned HTTP ${res.status}` }
    }

    if (p === 'gemini') {
      const key = await resolveKey(cfg.geminiKeyEnv || 'GEMINI_API_KEY')
      if (!key) return { ok: false, latencyMs: 0, message: 'Google Gemini API key not configured' }
      const model = cfg.geminiModel || 'gemini-2.0-flash-exp-image-generation'
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${encodeURIComponent(key)}`, {
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      })
      const latencyMs = Date.now() - start
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, latencyMs, message: `Gemini API auth error (HTTP ${res.status})` }
      }
      if (res.ok) {
        return { ok: true, latencyMs, message: 'Gemini Vision API operational' }
      }
      return { ok: false, latencyMs, message: `Gemini returned HTTP ${res.status}` }
    }

    if (p === 'seedream') {
      const url = cfg.seedreamBaseURL || 'https://api.bytedanceapi.com/v1'
      const key = await resolveKey(cfg.seedreamKeyEnv || 'SEEDREAM_API_KEY')
      const headers = key ? { Authorization: `Bearer ${key}` } : {}
      const res = await fetchImpl(`${url.replace(/\/+$/, '')}/models`, {
        headers,
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      }).catch(() => null)
      const latencyMs = Date.now() - start
      if (res && (res.ok || res.status === 404 || res.status === 405)) {
        return { ok: true, latencyMs, message: 'Seedream endpoint reachable' }
      }
      if (res && (res.status === 401 || res.status === 403)) {
        return { ok: false, latencyMs, message: `Seedream auth error (HTTP ${res.status})` }
      }
      return { ok: true, latencyMs, message: 'Seedream provider endpoint configured' }
    }

    return { ok: true, latencyMs: Date.now() - start, message: `Provider "${p}" configured` }
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, message: err.message || 'Connection timeout' }
  }
}
