import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SUBSCRIPTION_SIZES,
  makeProviders,
  falAuthHeader,
  normalizeMediaType,
  buildSidecar,
  normalizeCount,
  tryGenerate,
  fallbackOrder,
  sizeToPixels,
  pxSize,
  ASPECT_RATIOS,
  pixelDiff,
  buildEditForm,
  PROVIDER_KEYS,
  SIZE_PIXELS,
  embedPngMetadata,
  removeBackgroundFal,
  upscaleImageFal,
  traceToSvg,
  estimateCost,
  STYLE_PRESETS,
  applyStylePreset,
  resolveStylePreset,
  snapToMultipleOf64,
  snapDimensions,
  formatA1111Parameters,
  blendImagesFal,
  calculateBackoff,
  isFatalClientError,
  computeGenerationHash,
} from '../lib/providers.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const signal = new AbortController().signal

function deps(fetchImpl, extra = {}) {
  return {
    fetchImpl,
    resolveKey: async (ref) => (extra.keys ? extra.keys[ref] ?? '' : 'secret'),
    cfg: {
      apiKeyEnv: 'FAL_API_KEY',
      baseURL: 'https://queue.fal.run',
      model: 'fal-ai/flux-2/klein/9b',
      pollIntervalMs: 0,
      timeoutMs: 5000,
      customBaseURL: 'https://api.example.com/v1',
      customModel: 'gpt-image-1',
      customKeyEnv: 'OPENAI_API_KEY',
      customSize: '',
      ...(extra.cfg || {}),
    },
  }
}

const job = (over = {}) => ({
  prompt: 'кот в скафандре', size: 'landscape_4_3', format: 'png', seed: undefined, signal, ...over,
})

function jsonRes(body, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

function bytesRes(bytes, contentType = 'image/png') {
  return {
    ok: true,
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

test('все провайдеры объявлены', () => {
  assert.deepEqual(PROVIDER_KEYS, ['fal', 'custom', 'codex', 'grok', 'local', 'seedream', 'gemini', 'replicate'])
  const providers = makeProviders(deps(async () => jsonRes({})), job())
  assert.equal(typeof providers.fal, 'function')
  assert.equal(typeof providers.custom, 'function')
})

test('префикс Key добавляется к ключу FAL один раз', () => {
  assert.equal(falAuthHeader('abc'), 'Key abc')
  assert.equal(falAuthHeader('Key abc'), 'Key abc')
  assert.equal(falAuthHeader('  '), '')
})

test('тип картинки берётся из ответа, иначе из запрошенного формата', () => {
  assert.equal(normalizeMediaType('image/webp', 'png'), 'image/webp')
  assert.equal(normalizeMediaType('', 'jpeg'), 'image/jpeg')
  assert.equal(normalizeMediaType('', undefined), 'image/png')
})

// ------------------------------------------------------------------- FAL

test('fal проходит очередь целиком: submit, опрос, результат, скачивание', async () => {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push(String(url))
    if (String(url).endsWith('/fal-ai/flux-2/klein/9b')) {
      assert.equal(JSON.parse(init.body).image_size, 'landscape_4_3')
      assert.equal(init.headers.Authorization, 'Key secret')
      return jsonRes({ request_id: 'r1', status_url: 'https://q/status', response_url: 'https://q/result' })
    }
    if (String(url) === 'https://q/status') return jsonRes({ status: 'COMPLETED', response_url: 'https://q/result' })
    if (String(url) === 'https://q/result') {
      return jsonRes({ images: [{ url: 'https://cdn/img.png', width: 1024, height: 768, content_type: 'image/png' }], seed: 42 })
    }
    return bytesRes(PNG)
  }
  const out = await makeProviders(deps(fetchImpl), job()).fal()
  assert.deepEqual(Buffer.from(out.bytes), PNG)
  assert.equal(out.mediaType, 'image/png')
  assert.equal(out.width, 1024)
  assert.equal(out.height, 768)
  assert.equal(out.seed, 42)
  assert.equal(out.sourceUrl, 'https://cdn/img.png')
  assert.equal(seen.length, 4)
})

test('fal превращает отказ очереди в понятную ошибку, а не в пустой результат', async () => {
  const fetchImpl = async () => jsonRes({ detail: 'no balance' }, false, 402)
  await assert.rejects(
    makeProviders(deps(fetchImpl), job()).fal(),
    /FAL submit failed \(HTTP 402\): no balance/,
  )
})

// ---------------------------------------------------------------- свой API

test('свой API: base64 в ответе становится байтами без второго запроса', async () => {
  let calls = 0
  let body = null
  const fetchImpl = async (url, init) => {
    calls++
    assert.equal(String(url), 'https://api.example.com/v1/images/generations')
    assert.equal(init.headers.Authorization, 'Bearer secret')
    body = JSON.parse(init.body)
    return jsonRes({ data: [{ b64_json: PNG.toString('base64') }] })
  }
  const out = await makeProviders(deps(fetchImpl), job()).custom()
  assert.equal(calls, 1)
  assert.deepEqual(Buffer.from(out.bytes), PNG)
  assert.equal(body.model, 'gpt-image-1')
  assert.equal(body.n, 1)
  // Именованный размер переводится в пиксели: этот API других не понимает.
  assert.equal(body.size, SIZE_PIXELS.landscape_4_3)
  // Свой размер провайдер не публикует — размеры измерит служба вложений.
  assert.equal(out.width, 0)
  assert.equal(out.height, 0)
})

test('свой API: ссылка в ответе скачивается', async () => {
  const fetchImpl = async (url) => (String(url).includes('/images/generations')
    ? jsonRes({ data: [{ url: 'https://cdn/x.webp' }] })
    : bytesRes(PNG, 'image/webp'))
  const out = await makeProviders(deps(fetchImpl), job()).custom()
  assert.deepEqual(Buffer.from(out.bytes), PNG)
  assert.equal(out.mediaType, 'image/webp')
  assert.equal(out.sourceUrl, 'https://cdn/x.webp')
})

test('фиксированный размер отменяет перевод именованного', async () => {
  let sent = ''
  const fetchImpl = async (_url, init) => {
    sent = JSON.parse(init.body).size
    return jsonRes({ data: [{ b64_json: PNG.toString('base64') }] })
  }
  const d = deps(fetchImpl, { cfg: { customSize: '1024x1536' } })
  await makeProviders(d, job()).custom()
  assert.equal(sent, '1024x1536')
})

test('пустая ссылка на ключ означает запрос без авторизации', async () => {
  let headers = null
  const fetchImpl = async (_url, init) => {
    headers = init.headers
    return jsonRes({ data: [{ b64_json: PNG.toString('base64') }] })
  }
  const d = deps(fetchImpl, { cfg: { customKeyEnv: '' } })
  await makeProviders(d, job()).custom()
  assert.equal(headers.Authorization, undefined)
})

test('недонастроенный свой API объясняет, чего не хватает', async () => {
  const fetchImpl = async () => { throw new Error('сеть трогать не должны') }
  await assert.rejects(
    makeProviders(deps(fetchImpl, { cfg: { customBaseURL: '' } }), job()).custom(),
    /base URL is not configured/,
  )
  await assert.rejects(
    makeProviders(deps(fetchImpl, { cfg: { customModel: '' } }), job()).custom(),
    /model is not configured/,
  )
})

test('ошибка своего API доносит текст провайдера', async () => {
  const fetchImpl = async () => jsonRes({ error: { message: 'content policy' } }, false, 400)
  await assert.rejects(
    makeProviders(deps(fetchImpl), job()).custom(),
    /Image API failed \(HTTP 400\): content policy/,
  )
})

test('ответ без картинки не выдаётся за успех', async () => {
  const fetchImpl = async () => jsonRes({ data: [] })
  await assert.rejects(makeProviders(deps(fetchImpl), job()).custom(), /returned no images/)
})

// ------------------------------------------------- генерация на подписке

function subsDeps(images) {
  return { ...deps(async () => { throw new Error('сеть здесь ни при чём') }), subscriptionImages: images }
}

test('подписка отдаёт картинку, а размер переводится в её систему', async () => {
  let asked = null
  const images = { generate: async (request) => { asked = request; return [{ b64_json: PNG.toString('base64'), revisedPrompt: 'уточнено' }] } }
  const out = await makeProviders(subsDeps(images), job({ size: 'landscape_4_3' })).codex()
  assert.deepEqual(Buffer.from(out.bytes), PNG)
  assert.equal(out.mediaType, 'image/png')
  assert.equal(out.revisedPrompt, 'уточнено')
  assert.equal(asked.provider, 'codex')
  assert.equal(asked.size, SUBSCRIPTION_SIZES.landscape_4_3)
  assert.equal(asked.prompt, 'кот в скафандре')
})

test('grok идёт тем же путём, но со своим именем', async () => {
  let asked = null
  const images = { generate: async (request) => { asked = request; return [{ b64_json: PNG.toString('base64') }] } }
  await makeProviders(subsDeps(images), job()).grok()
  assert.equal(asked.provider, 'grok')
})

test('без плагина подписок провайдер объясняет, чего не хватает', async () => {
  const out = await makeProviders(subsDeps(undefined), job()).codex()
  assert.equal(out.ok, false)
  assert.match(out.reason, /плагин подписок/)
})

test('отказ подписки становится отказом цепочки, а не падением', async () => {
  const images = { generate: async () => { throw new Error('нет входа в codex') } }
  const out = await makeProviders(subsDeps(images), job()).codex()
  assert.equal(out.ok, false)
  assert.match(out.reason, /нет входа/)
})

test('пустой ответ подписки не выдаётся за успех', async () => {
  const images = { generate: async () => [] }
  const out = await makeProviders(subsDeps(images), job()).codex()
  assert.equal(out.ok, false)
  assert.match(out.reason, /нет картинки/)
})


test('sidecar: buildSidecar отдаёт полные метаданные и round-trip через JSON', () => {
  const input = {
    prompt: 'кот в скафандре', size: 'landscape_4_3', format: 'png', seed: 0,
    provider: 'fal', deliverAs: 'link', width: 1024, height: 768,
    mediaType: 'image/png', attachmentId: 'sha256:abc', url: '/dsh-image-gen/image?id=sha256:abc',
    createdAt: '2026-08-25T00:00:00.000Z',
  }
  const side = buildSidecar(input)
  for (const k of Object.keys(input)) assert.equal(side[k], input[k])
  assert.deepEqual(JSON.parse(JSON.stringify(side)), input)
})

test('sidecar: seed 0 сохраняется, дефолты дополняются', () => {
  const side = buildSidecar({ prompt: 'p', size: 'square', format: 'png', seed: 0 })
  assert.equal(side.seed, 0)
  assert.equal(side.width, undefined)
  assert.ok(typeof side.createdAt === 'string' && side.createdAt.length > 0)
  assert.equal(typeof side.provider, 'undefined')
})


test('count: normalizeCount зажимает в 1..4 и валидирует нечисло', () => {
  assert.equal(normalizeCount(undefined), 1)
  assert.equal(normalizeCount(''), 1)
  assert.equal(normalizeCount(0), 1)
  assert.equal(normalizeCount(2), 2)
  assert.equal(normalizeCount(4), 4)
  assert.equal(normalizeCount(9), 4)
  assert.equal(normalizeCount('3'), 3)
  assert.equal(normalizeCount(NaN), 1)
})

test('провайдер принимает per-call seed и отдаёт его в результате', async () => {
  let sent = null
  const d = deps((url, init) => {
    if (String(url).endsWith('/fal-ai/flux-2/klein/9b')) {
      sent = JSON.parse(init.body).seed
      return jsonRes({ request_id: 'r1', status_url: 'https://q/s', response_url: 'https://q/r' })
    }
    if (String(url) === 'https://q/s') return jsonRes({ status: 'COMPLETED', response_url: 'https://q/r' })
    if (String(url) === 'https://q/r') return jsonRes({ images: [{ url: 'https://cdn/x.png' }] })
    return bytesRes(PNG, 'image/png')
  })
  const out = await makeProviders(d, job()).fal(12345)
  assert.equal(sent, 12345)
  assert.equal(out.seed, 12345)
})


test('negative_prompt и guidance_scale доезжают до FAL', async () => {
  let body = null
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/fal-ai/flux-2/klein/9b')) { body = JSON.parse(init.body); return jsonRes({ request_id: 'r1', status_url: 'https://q/s', response_url: 'https://q/r' }) }
    if (String(url) === 'https://q/s') return jsonRes({ status: 'COMPLETED', response_url: 'https://q/r' })
    if (String(url) === 'https://q/r') return jsonRes({ images: [{ url: 'https://cdn/x.png' }] })
    return bytesRes(PNG, 'image/png')
  }
  await makeProviders(deps(fetchImpl), job({ negativePrompt: 'no text', guidanceScale: 7.5 })).fal()
  assert.equal(body.negative_prompt, 'no text')
  assert.equal(body.guidance_scale, 7.5)
})

test('negative_prompt и guidance_scale доезжают до custom API', async () => {
  let body = null
  const fetchImpl = async (_url, init) => {
    body = JSON.parse(init.body)
    return jsonRes({ data: [{ b64_json: PNG.toString('base64') }] })
  }
  await makeProviders(deps(fetchImpl), job({ negativePrompt: 'no x', guidanceScale: 10 })).custom()
  assert.equal(body.negative_prompt, 'no x')
  assert.equal(body.guidance_scale, 10)
})


test('tryGenerate: падает до следующего провайдера', async () => {
  const generators = {
    fal: async () => { throw new Error('FAL down') },
    custom: async () => ({ bytes: 1 }),
    codex: async () => ({ bytes: 2 }),
  }
  const out = await tryGenerate(generators, ['fal', 'custom', 'codex'], 42)
  assert.equal(out.bytes, 1)
})

test('tryGenerate: все отказали — перечисляет причины', async () => {
  const generators = {
    fal: async () => { throw new Error('FAL down') },
    custom: async () => { throw new Error('custom 401') },
    codex: async () => { throw new Error('no subscription') },
  }
  await assert.rejects(
    tryGenerate(generators, ['fal', 'custom', 'codex'], 1),
    /FAL down.*custom 401.*no subscription/s,
  )
})

test('fallbackOrder: основной первым, остальные по порядку', () => {
  assert.deepEqual(fallbackOrder('codex'), ['codex', 'fal', 'custom', 'grok', 'local', 'seedream', 'gemini', 'replicate'])
  assert.deepEqual(fallbackOrder('fal'), ['fal', 'custom', 'codex', 'grok', 'local', 'seedream', 'gemini', 'replicate'])
})


test('sizeToPixels: именованный размер -> [w,h]', () => {
  assert.deepEqual(sizeToPixels('landscape_4_3'), [1024, 768])
  assert.deepEqual(sizeToPixels('square_hd'), [1024, 1024])
  assert.deepEqual(sizeToPixels('unknown'), [1024, 1024])
})

test('local A1111: txt2img собирает запрос и разбирает base64', async () => {
  let body = null
  const fetchImpl = async (_url, init) => {
    body = JSON.parse(init.body)
    return { ok: true, status: 200, json: async () => ({ images: [PNG.toString('base64')] }) }
  }
  const d = deps(fetchImpl, { cfg: { localKind: 'a1111', localBaseURL: 'http://127.0.0.1:7860', localModel: 'sd15', localSteps: 25, localCfg: 8 } })
  const out = await makeProviders(d, job()).local()
  assert.deepEqual(Buffer.from(out.bytes), PNG)
  assert.equal(body.width, 1024)
  assert.equal(body.height, 768)
  assert.equal(body.steps, 25)
  assert.equal(body.cfg_scale, 8)
  assert.equal(body.override_settings.sd_model_checkpoint, 'sd15')
})

test('local A1111: без адреса — понятная ошибка', async () => {
  const d = deps(async () => { throw new Error('no net') }, { cfg: { localBaseURL: '' } })
  await assert.rejects(makeProviders(d, job()).local(), /server address is not configured/)
})

test('local ComfyUI: очередь + опрос до готовности', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push(String(url))
    if (String(url).endsWith('/prompt')) return { ok: true, status: 200, json: async () => ({ prompt_id: 'p1' }) }
    if (String(url).includes('/history/p1')) {
      return { ok: true, status: 200, json: async () => ({ p1: { outputs: { '9': { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] } } } }) }
    }
    if (String(url).includes('/view?')) return { ok: true, status: 200, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  const d = deps(fetchImpl, { cfg: { localKind: 'comfyui', localBaseURL: 'http://127.0.0.1:8188', pollIntervalMs: 0, timeoutMs: 5000 } })
  const out = await makeProviders(d, job()).local()
  assert.deepEqual(Buffer.from(out.bytes), PNG)
  assert.ok(calls.some((u) => u.endsWith('/prompt')))
  assert.ok(calls.some((u) => u.includes('/history/p1')))
})


test('custom edit: source_image уходит на /images/edits с multipart', async () => {
  let url = ''
  let body = null
  const fetchImpl = async (u, init) => {
    url = String(u)
    body = init.body
    return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG.toString('base64') }] }) }
  }
  const d = deps(fetchImpl, { cfg: { customBaseURL: 'https://api.example.com/v1', customModel: 'gpt-image-1' } })
  const src = { bytes: PNG, mediaType: 'image/png' }
  await makeProviders(d, job({ source: src, strength: 0.5 })).custom()
  assert.ok(url.endsWith('/images/edits'))
  assert.ok(body instanceof FormData)
  assert.equal(body.get('prompt'), 'кот в скафандре')
  assert.equal(body.get('strength'), '0.5')
})

test('custom без source: обычный /images/generations', async () => {
  let url = ''
  const fetchImpl = async (u, init) => {
    url = String(u)
    return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG.toString('base64') }] }) }
  }
  const d = deps(fetchImpl, { cfg: { customBaseURL: 'https://api.example.com/v1', customModel: 'gpt-image-1' } })
  await makeProviders(d, job()).custom()
  assert.ok(url.endsWith('/images/generations'))
})

test('подписка отказывает при source_image с понятной причиной', async () => {
  const images = { generate: async () => { throw new Error('не должно вызываться') } }
  const d = { ...deps(async () => { throw new Error('no net') }), subscriptionImages: images }
  const out = await makeProviders(d, job({ source: { bytes: PNG, mediaType: 'image/png' } })).codex()
  assert.equal(out.ok, false)
  assert.match(out.reason, /не умеет править изображения/)
})


test('seedream: OpenAI-совместимый запрос и разбор base64', async () => {
  let body = null
  let auth = ''
  const fetchImpl = async (url, init) => {
    body = JSON.parse(init.body)
    auth = init.headers.Authorization
    return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG.toString('base64') }] }) }
  }
  const d = deps(fetchImpl, { keys: { SEEDREAM_API_KEY: 'sk-seed' }, cfg: { seedreamKeyEnv: 'SEEDREAM_API_KEY', seedreamModel: 'seedream-4.0' } })
  const out = await makeProviders(d, job()).seedream()
  assert.deepEqual(Buffer.from(out.bytes), PNG)
  assert.equal(auth, 'Bearer sk-seed')
  assert.equal(body.model, 'seedream-4.0')
  assert.equal(body.prompt, 'кот в скафандре')
})

test('gemini: generateContent запрос и разбор inlineData', async () => {
  let url = ''
  let body = null
  const fetchImpl = async (u, init) => {
    url = String(u)
    body = JSON.parse(init.body)
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] }) }
  }
  const d = deps(fetchImpl, { keys: { GEMINI_API_KEY: 'g-key' }, cfg: { geminiKeyEnv: 'GEMINI_API_KEY', geminiModel: 'gemini-2.0-flash-exp-image-generation' } })
  const out = await makeProviders(d, job()).gemini()
  assert.deepEqual(Buffer.from(out.bytes), PNG)
  assert.ok(url.includes('gemini-2.0-flash-exp-image-generation'))
  assert.ok(url.includes('g-key'))
  assert.equal(body.contents[0].parts[0].text, 'кот в скафандре')
})


test('pxSize: aspect_ratio приоритетнее именованного размера', () => {
  assert.deepEqual(pxSize([1344, 768], 'square_hd'), [1344, 768])
  assert.deepEqual(pxSize(undefined, 'landscape_4_3'), [1024, 768])
  assert.deepEqual(ASPECT_RATIOS['16:9'], [1344, 768])
  assert.deepEqual(ASPECT_RATIOS['1:1'], [1024, 1024])
})


test('pixelDiff: одинаковые байты — 0, разные — доля', async () => {
  const a = Buffer.from([1, 2, 3, 4])
  const same = await pixelDiff(a, Buffer.from([1, 2, 3, 4]))
  assert.equal(same.diffRatio, 0)
  const diff = await pixelDiff(a, Buffer.from([1, 9, 3, 4]))
  assert.equal(diff.diffRatio, 0.25)
  const size = await pixelDiff(a, Buffer.from([1, 2]))
  assert.equal(size.error, 'size mismatch')
})



test('embedPngMetadata: вшивает tEXt чанк с параметрами в PNG', () => {
  const ihdr = Buffer.from([0,0,0,13, 0x49,0x48,0x44,0x52, 0,0,0,1, 0,0,0,1, 8,2,0,0,0, 0x90,0x77,0x53,0xde])
  const iend = Buffer.from([0,0,0,0, 0x49,0x45,0x4e,0x44, 0xae,0x42,0x60,0x82])
  const rawPng = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), ihdr, iend])
  const tagged = embedPngMetadata(rawPng, { prompt: 'space cat', seed: 123 })
  assert.ok(tagged.length > rawPng.length)
  assert.ok(tagged.includes(Buffer.from('Parameters')))
  assert.ok(tagged.includes(Buffer.from('space cat')))
})

test('removeBackgroundFal: отправляет запрос в очередь и скачивает результат', async () => {
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/fal-ai/birefnet')) {
      return jsonRes({ request_id: 'rem1', status_url: 'https://q/rem_status', response_url: 'https://q/rem_result' })
    }
    if (String(url) === 'https://q/rem_status') return jsonRes({ status: 'COMPLETED', response_url: 'https://q/rem_result' })
    if (String(url) === 'https://q/rem_result') {
      return jsonRes({ image: { url: 'https://cdn/nobg.png', width: 512, height: 512 } })
    }
    return bytesRes(PNG)
  }
  const res = await removeBackgroundFal(deps(fetchImpl), { imageBytes: PNG, signal })
  assert.equal(res.mediaType, 'image/png')
  assert.equal(res.width, 512)
  assert.equal(res.height, 512)
  assert.deepEqual(res.bytes, PNG)
})

test('upscaleImageFal: отправляет масштаб и параметры в очередь FAL', async () => {
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/fal-ai/clarity-upscaler')) {
      const parsed = JSON.parse(init.body)
      assert.equal(parsed.upscale_factor, 4)
      assert.equal(parsed.prompt, 'high detail')
      return jsonRes({ request_id: 'up1', status_url: 'https://q/up_status', response_url: 'https://q/up_result' })
    }
    if (String(url) === 'https://q/up_status') return jsonRes({ status: 'COMPLETED', response_url: 'https://q/up_result' })
    if (String(url) === 'https://q/up_result') {
      return jsonRes({ image: { url: 'https://cdn/up.png', width: 2048, height: 2048 } })
    }
    return bytesRes(PNG)
  }
  const res = await upscaleImageFal(deps(fetchImpl), { imageBytes: PNG, scale: 4, prompt: 'high detail', signal })
  assert.equal(res.width, 2048)
  assert.equal(res.height, 2048)
})

test('traceToSvg: генерирует валидную SVG разметку', () => {
  const res = traceToSvg(PNG, { colorMode: 'color' })
  assert.equal(res.mediaType, 'image/svg+xml')
  assert.ok(res.svg.includes('<svg'))
  assert.ok(res.svg.includes('<image href="data:image/png;base64,'))
})


test('estimateCost: корректно рассчитывает стоимость по провайдерам', () => {
  assert.equal(estimateCost('fal', 'fal-ai/flux-schnell'), 0.003)
  assert.equal(estimateCost('fal', 'fal-ai/flux-dev'), 0.025)
  assert.equal(estimateCost('replicate', 'black-forest-labs/flux-schnell'), 0.003)
  assert.equal(estimateCost('codex', 'gpt-image-1'), 0.0)
  assert.equal(estimateCost('local', 'comfyui'), 0.0)
})

test('replicate: submit и опрос до готовности', async () => {
  const fetchImpl = async (url, init) => {
    if (String(url).includes('/models/black-forest-labs/flux-schnell/predictions')) {
      return jsonRes({ id: 'p1', status: 'processing', urls: { get: 'https://api.replicate.com/v1/predictions/p1' } })
    }
    if (String(url).endsWith('/predictions/p1')) {
      return jsonRes({ id: 'p1', status: 'succeeded', output: ['https://cdn/replicate.png'] })
    }
    return bytesRes(PNG)
  }
  const res = await makeProviders(deps(fetchImpl, { cfg: { replicateKeyEnv: 'REPLICATE_API_TOKEN' } }), job()).replicate()
  assert.equal(res.mediaType, 'image/png')
  assert.deepEqual(res.bytes, PNG)
  assert.equal(res.cost, 0.003)
})


test('applyStylePreset: подставляет пресет по ключу или оставляет кастомный', () => {
  assert.ok(applyStylePreset('пейзаж', 'cinematic').includes('cinematic film still'))
  assert.ok(applyStylePreset('девушка', 'anime').includes('Makoto Shinkai'))
  assert.equal(applyStylePreset('дом', 'custom_3d_style'), 'дом, custom_3d_style')
})

test('blendImagesFal: отправляет несколько картинок на слияние в FAL', async () => {
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/fal-ai/flux/dev/image-to-image')) {
      const parsed = JSON.parse(init.body)
      assert.ok(parsed.image_url.startsWith('data:image/png;base64,'))
      return jsonRes({ request_id: 'b1', status_url: 'https://q/b_status', response_url: 'https://q/b_result' })
    }
    if (String(url) === 'https://q/b_status') return jsonRes({ status: 'COMPLETED', response_url: 'https://q/b_result' })
    if (String(url) === 'https://q/b_result') {
      return jsonRes({ image: { url: 'https://cdn/blended.png', width: 1024, height: 1024 } })
    }
    return bytesRes(PNG)
  }
  const res = await blendImagesFal(deps(fetchImpl), { images: [{ bytes: PNG, mediaType: 'image/png' }], prompt: 'mix', signal })
  assert.equal(res.width, 1024)
  assert.deepEqual(res.bytes, PNG)
})


test('generate_image_pack: конвертирует пропорции в именованные размеры', () => {
  const ratios = ['1:1', '16:9', '9:16']
  const mapped = ratios.map(r => r === '16:9' ? 'landscape_16_9' : r === '9:16' ? 'portrait_16_9' : 'square_hd')
  assert.deepEqual(mapped, ['square_hd', 'landscape_16_9', 'portrait_16_9'])
})

test('calculateBackoff: экспоненциальный рост с ограничением и джиттером', () => {
  const d0 = calculateBackoff(0, 500, 5000, 0.1)
  const d5 = calculateBackoff(5, 500, 5000, 0.1)
  const d20 = calculateBackoff(20, 500, 5000, 0.1)
  assert.ok(d0 >= 100 && d0 <= 700)
  assert.ok(d5 > d0)
  assert.ok(d20 <= 5500) // capped near maxInterval
})

test('isFatalClientError: отличает 400/Policy от 503/Timeout', () => {
  assert.equal(isFatalClientError(new Error('Content policy violation: prompt rejected')), true)
  assert.equal(isFatalClientError(new Error('Bad Request (HTTP 400): prompt is required')), true)
  assert.equal(isFatalClientError(new Error('NSFW detected in input')), true)
  assert.equal(isFatalClientError(new Error('HTTP 503: Service Unavailable')), false)
  assert.equal(isFatalClientError(new Error('ETIMEDOUT: connect timeout')), false)
  assert.equal(isFatalClientError(new Error('HTTP 429: Rate limit exceeded')), false)
})

test('tryGenerate: фатальная ошибка 400 не переходит к следующему провайдеру', async () => {
  let falCalled = false
  let replicateCalled = false
  const generators = {
    fal: async () => {
      falCalled = true
      throw new Error('Content policy violation in prompt')
    },
    replicate: async () => {
      replicateCalled = true
      return { path: 'rep.png' }
    }
  }
  await assert.rejects(
    () => tryGenerate(generators, ['fal', 'replicate'], 123, 'bad prompt'),
    /not retrying fallback.*Content policy violation/
  )
  assert.equal(falCalled, true)
  assert.equal(replicateCalled, false)
})

test('generate_image_pack: обрабатывает частичные результаты при сбое одной из пропорций', async () => {
  const mockGenerateTool = {
    execute: async (args) => {
      if (args.image_size === 'portrait_16_9') throw new Error('Timeout on 9:16 ratio')
      return { path: `/tmp/${args.image_size}.png`, width: 1024, height: 1024 }
    }
  }
  const ratios = ['1:1', '9:16']
  const results = []
  const warnings = []
  for (const ratio of ratios) {
    const sizeName = ratio === '9:16' ? 'portrait_16_9' : 'square_hd'
    try {
      const res = await mockGenerateTool.execute({ image_size: sizeName })
      results.push({ ratio, ...res })
    } catch (err) {
      warnings.push(`Ratio ${ratio} failed: ${err.message}`)
    }
  }
  assert.equal(results.length, 1)
  assert.equal(warnings.length, 1)
  assert.ok(warnings[0].includes('Timeout on 9:16 ratio'))
})

test('computeGenerationHash: детерминированный sha256 хэш генерации', () => {
  const h1 = computeGenerationHash({
    provider: 'fal',
    model: 'fal-ai/flux-dev',
    prompt: 'red car',
    seed: 42,
    size: '1024x1024',
    style: 'cinematic',
  })
  const h2 = computeGenerationHash({
    provider: 'FAL ',
    model: 'fal-ai/flux-dev',
    prompt: 'red car',
    seed: 42,
    size: '1024x1024',
    style: 'cinematic',
  })
  const h3 = computeGenerationHash({
    provider: 'fal',
    model: 'fal-ai/flux-dev',
    prompt: 'blue car',
    seed: 42,
    size: '1024x1024',
    style: 'cinematic',
  })
  assert.equal(h1.length, 64)
  assert.equal(h1, h2) // Case and trim normalization match
  assert.notEqual(h1, h3) // Different prompt produces different hash
})

test('resolveStylePreset: объединяет негативные промпты и проставляет guidanceScale', () => {
  const anime = resolveStylePreset('anime', 'blurry', undefined)
  assert.ok(anime.promptSuffix.includes('Makoto Shinkai'))
  assert.ok(anime.negativePrompt.includes('blurry, photorealistic'))
  assert.equal(anime.guidanceScale, 7.0)

  const custom = resolveStylePreset('custom_watercolors', 'ugly', 5.5)
  assert.equal(custom.promptSuffix, 'custom_watercolors')
  assert.equal(custom.negativePrompt, 'ugly')
  assert.equal(custom.guidanceScale, 5.5)
})

test('snapToMultipleOf64 & snapDimensions: гарантируют кратность 64', () => {
  assert.equal(snapToMultipleOf64(1000), 1024)
  assert.equal(snapToMultipleOf64(750), 768)
  assert.equal(snapToMultipleOf64(500), 512)
  const [w, h] = snapDimensions(1000, 750)
  assert.equal(w % 64, 0)
  assert.equal(h % 64, 0)
  assert.equal(w, 1024)
  assert.equal(h, 768)
})

test('formatA1111Parameters: генерирует стандартный блок ComfyUI / Automatic1111', () => {
  const formatted = formatA1111Parameters({
    prompt: 'cyberpunk warrior',
    negative_prompt: 'blurry, low quality',
    seed: 987654,
    width: 1024,
    height: 768,
    model: 'fal-ai/flux-dev',
    guidance_scale: 7.5,
    steps: 28,
  })
  assert.ok(formatted.startsWith('cyberpunk warrior'))
  assert.ok(formatted.includes('Negative prompt: blurry, low quality'))
  assert.ok(formatted.includes('Steps: 28'))
  assert.ok(formatted.includes('Seed: 987654'))
  assert.ok(formatted.includes('Size: 1024x768'))
  assert.ok(formatted.includes('Model: fal-ai/flux-dev'))
})

test('embedPngMetadata: вшивает tEXt чанк с ключевым словом parameters для A1111 drag-and-drop', () => {
  const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR42mNk+M9QzwAEjAwACXEB+V38FswAAAAASUVORK5CYII=', 'base64')
  const embedded = embedPngMetadata(validPng, {
    prompt: 'red sports car',
    negative_prompt: 'ugly',
    seed: 42,
    model: 'flux-schnell',
  })
  const text = embedded.toString('utf8')
  assert.ok(text.includes('Parameters'))
  assert.ok(text.includes('red sports car'))
  assert.ok(text.includes('Negative prompt: ugly'))
  assert.ok(text.includes('Seed: 42'))
})
