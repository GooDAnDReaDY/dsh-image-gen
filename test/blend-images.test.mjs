import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { blendImageBuffers, blendImagesFal } from '../lib/providers.js'

function makeMockDeps(fetchImpl) {
  return {
    fetchImpl,
    resolveKey: async () => 'test-fal-key',
    cfg: { apiKeyEnv: 'FAL_KEY', baseURL: 'https://queue.fal.run' },
  }
}

function makeJsonResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  }
}

function makeBytesResponse(buf) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  }
}

test('blend_images (#381): rejects request with fewer than two images before network call', async () => {
  let called = false
  const fetchImpl = async () => {
    called = true
    return makeJsonResponse({})
  }
  const deps = makeMockDeps(fetchImpl)

  await assert.rejects(
    blendImagesFal(deps, { images: [] }),
    /At least two images are required for blending/
  )
  await assert.rejects(
    blendImagesFal(deps, { images: [{ bytes: Buffer.from('x') }] }),
    /At least two images are required for blending/
  )
  assert.equal(called, false, 'Fetch must never be called for invalid inputs')
})

test('blend_images (#381): blendImageBuffers blends pixels according to weights', async () => {
  // Create 4x4 solid red and solid blue images
  const redPng = await sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer()

  const bluePng = await sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
  }).png().toBuffer()

  // 50/50 blend -> purple (128, 0, 128)
  const blend50 = await blendImageBuffers(
    [{ bytes: redPng }, { bytes: bluePng }],
    [0.5, 0.5]
  )
  assert.equal(blend50.width, 4)
  assert.equal(blend50.height, 4)
  const raw50 = await sharp(blend50.bytes).raw().toBuffer()
  assert.equal(raw50[0], 128, 'Red channel in 50/50 blend')
  assert.equal(raw50[1], 0, 'Green channel in 50/50 blend')
  assert.equal(raw50[2], 128, 'Blue channel in 50/50 blend')

  // 80/20 blend -> mostly red (204, 0, 51)
  const blend80 = await blendImageBuffers(
    [{ bytes: redPng }, { bytes: bluePng }],
    [0.8, 0.2]
  )
  const raw80 = await sharp(blend80.bytes).raw().toBuffer()
  assert.equal(raw80[0], 204, 'Red channel in 80/20 blend')
  assert.equal(raw80[1], 0, 'Green channel in 80/20 blend')
  assert.equal(raw80[2], 51, 'Blue channel in 80/20 blend')
})

test('blend_images (#381): changing second image changes actual FAL payload image_url', async () => {
  const redPng = await sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer()

  const bluePng = await sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
  }).png().toBuffer()

  const greenPng = await sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
  }).png().toBuffer()

  let payload1 = null
  let payload2 = null

  const fetchImpl1 = async (url, init) => {
    if (String(url).endsWith('/image-to-image')) {
      payload1 = JSON.parse(init.body)
      return makeJsonResponse({ request_id: 'r1', status_url: 'https://q/s1', response_url: 'https://q/r1' })
    }
    if (String(url) === 'https://q/s1') return makeJsonResponse({ status: 'COMPLETED', response_url: 'https://q/r1' })
    if (String(url) === 'https://q/r1') return makeJsonResponse({ image: { url: 'https://cdn/1.png', width: 4, height: 4 } })
    return makeBytesResponse(redPng)
  }

  const fetchImpl2 = async (url, init) => {
    if (String(url).endsWith('/image-to-image')) {
      payload2 = JSON.parse(init.body)
      return makeJsonResponse({ request_id: 'r2', status_url: 'https://q/s2', response_url: 'https://q/r2' })
    }
    if (String(url) === 'https://q/s2') return makeJsonResponse({ status: 'COMPLETED', response_url: 'https://q/r2' })
    if (String(url) === 'https://q/r2') return makeJsonResponse({ image: { url: 'https://cdn/2.png', width: 4, height: 4 } })
    return makeBytesResponse(redPng)
  }

  await blendImagesFal(makeMockDeps(fetchImpl1), {
    images: [{ bytes: redPng }, { bytes: bluePng }],
    weights: [0.5, 0.5],
  })

  await blendImagesFal(makeMockDeps(fetchImpl2), {
    images: [{ bytes: redPng }, { bytes: greenPng }],
    weights: [0.5, 0.5],
  })

  assert.ok(payload1 && payload2)
  assert.notEqual(
    payload1.image_url,
    payload2.image_url,
    'Changing second input image must change actual payload image_url'
  )
  assert.equal(payload1.images.length, 2)
  assert.equal(payload2.images.length, 2)
})

test('blend_images (#381): changing weights changes actual FAL payload image_url', async () => {
  const redPng = await sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer()

  const bluePng = await sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
  }).png().toBuffer()

  let payloadA = null
  let payloadB = null

  const fetchImplA = async (url, init) => {
    if (String(url).endsWith('/image-to-image')) {
      payloadA = JSON.parse(init.body)
      return makeJsonResponse({ request_id: 'rA', status_url: 'https://q/sA', response_url: 'https://q/rA' })
    }
    if (String(url) === 'https://q/sA') return makeJsonResponse({ status: 'COMPLETED', response_url: 'https://q/rA' })
    if (String(url) === 'https://q/rA') return makeJsonResponse({ image: { url: 'https://cdn/1.png', width: 4, height: 4 } })
    return makeBytesResponse(redPng)
  }

  const fetchImplB = async (url, init) => {
    if (String(url).endsWith('/image-to-image')) {
      payloadB = JSON.parse(init.body)
      return makeJsonResponse({ request_id: 'rB', status_url: 'https://q/sB', response_url: 'https://q/rB' })
    }
    if (String(url) === 'https://q/sB') return makeJsonResponse({ status: 'COMPLETED', response_url: 'https://q/rB' })
    if (String(url) === 'https://q/rB') return makeJsonResponse({ image: { url: 'https://cdn/2.png', width: 4, height: 4 } })
    return makeBytesResponse(redPng)
  }

  await blendImagesFal(makeMockDeps(fetchImplA), {
    images: [{ bytes: redPng }, { bytes: bluePng }],
    weights: [0.9, 0.1],
  })

  await blendImagesFal(makeMockDeps(fetchImplB), {
    images: [{ bytes: redPng }, { bytes: bluePng }],
    weights: [0.1, 0.9],
  })

  assert.ok(payloadA && payloadB)
  assert.notEqual(
    payloadA.image_url,
    payloadB.image_url,
    'Changing weights must change actual payload image_url'
  )
  assert.deepEqual(payloadA.weights, [0.9, 0.1])
  assert.deepEqual(payloadB.weights, [0.1, 0.9])
})

test('blend_images (#381): weights normalization handles unnormalized positive numbers', async () => {
  const redPng = await sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer()

  const bluePng = await sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
  }).png().toBuffer()

  const res = await blendImageBuffers([{ bytes: redPng }, { bytes: bluePng }], [75, 25])
  assert.deepEqual(res.weights, [0.75, 0.25])
})
