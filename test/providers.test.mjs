import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeProviders,
  falAuthHeader,
  normalizeMediaType,
  PROVIDER_KEYS,
  SIZE_PIXELS,
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

test('оба провайдера объявлены', () => {
  assert.deepEqual(PROVIDER_KEYS, ['fal', 'custom'])
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
