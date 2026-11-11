import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import {
  extractComfyMetadataFromPng,
  injectLorasIntoComfyWorkflow,
  buildDefaultComfyWorkflow,
} from '../lib/comfy-workflow-helpers.js'
import {
  getProviderCooldown,
  setProviderCooldown,
  clearProviderCooldown,
  clearAllProviderCooldowns,
  resolveFallbackChain,
  executeWithFallback,
} from '../lib/fallback-router.js'
import { createFalGenerator } from '../lib/providers/backends/fal.js'

function buildMockPngWithChunks(chunks) {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const parts = [sig]

  // Minimal IHDR chunk (13 bytes)
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(1, 0) // width = 1
  ihdrData.writeUInt32BE(1, 4) // height = 1
  ihdrData[8] = 8              // bit depth
  ihdrData[9] = 2              // color type truecolor
  const ihdrLen = Buffer.alloc(4)
  ihdrLen.writeUInt32BE(13, 0)
  const ihdrType = Buffer.from('IHDR')
  const ihdrCrc = Buffer.alloc(4)
  parts.push(ihdrLen, ihdrType, ihdrData, ihdrCrc)

  // Append user chunks (tEXt or iTXt)
  for (const c of chunks) {
    let chunkData
    if (c.type === 'tEXt') {
      const keyBuf = Buffer.from(c.keyword, 'latin1')
      const textBuf = Buffer.from(c.text, 'utf8')
      chunkData = Buffer.concat([keyBuf, Buffer.from([0]), textBuf])
    } else if (c.type === 'iTXt') {
      const keyBuf = Buffer.from(c.keyword, 'utf8')
      const textBuf = c.compressed ? zlib.deflateSync(Buffer.from(c.text, 'utf8')) : Buffer.from(c.text, 'utf8')
      const header = Buffer.from([0, c.compressed ? 1 : 0, 0, 0, 0])
      chunkData = Buffer.concat([keyBuf, header, textBuf])
    }
    const lenBuf = Buffer.alloc(4)
    lenBuf.writeUInt32BE(chunkData.length, 0)
    const typeBuf = Buffer.from(c.type)
    const crcBuf = Buffer.alloc(4)
    parts.push(lenBuf, typeBuf, chunkData, crcBuf)
  }

  // IEND chunk
  const iendLen = Buffer.alloc(4)
  const iendType = Buffer.from('IEND')
  const iendCrc = Buffer.alloc(4)
  parts.push(iendLen, iendType, iendCrc)

  return Buffer.concat(parts)
}

test('Issue #525: extractComfyMetadataFromPng extracts tEXt and iTXt workflow chunks', () => {
  const mockPromptGraph = {
    '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 25, model: ['4', 0] } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'flux1-dev.safetensors' } },
  }
  const mockWorkflowGraph = {
    nodes: [{ id: 3, type: 'KSampler' }, { id: 4, type: 'CheckpointLoaderSimple' }],
  }

  const pngBuffer = buildMockPngWithChunks([
    { type: 'tEXt', keyword: 'prompt', text: JSON.stringify(mockPromptGraph) },
    { type: 'iTXt', keyword: 'workflow', text: JSON.stringify(mockWorkflowGraph), compressed: true },
  ])

  const extracted = extractComfyMetadataFromPng(pngBuffer)
  assert.ok(extracted.prompt)
  assert.equal(extracted.prompt['3'].class_type, 'KSampler')
  assert.equal(extracted.prompt['4'].inputs.ckpt_name, 'flux1-dev.safetensors')
  assert.ok(extracted.workflow)
  assert.equal(extracted.workflow.nodes.length, 2)
  assert.equal(extracted.raw.prompt, JSON.stringify(mockPromptGraph))
})

test('Issue #525: extractComfyMetadataFromPng handles non-PNG and empty chunks safely', () => {
  assert.throws(
    () => extractComfyMetadataFromPng(Buffer.from('not a png file')),
    /Provided buffer is not a valid PNG image/
  )

  const emptyPng = buildMockPngWithChunks([])
  const res = extractComfyMetadataFromPng(emptyPng)
  assert.equal(res.prompt, null)
  assert.equal(res.workflow, null)
  assert.deepEqual(res.raw, {})
})

test('Issue #528: Provider cooldowns track expiration and prioritize healthy providers', () => {
  clearAllProviderCooldowns()

  assert.equal(getProviderCooldown('fal'), 0)
  setProviderCooldown('fal', 5000)
  assert.ok(getProviderCooldown('fal') > 0)

  // resolveFallbackChain should sort 'fal' after healthy alternatives
  const chain = resolveFallbackChain('replicate', ['fal', 'seedream', 'local'])
  assert.equal(chain[0], 'replicate')
  const falIndex = chain.indexOf('fal')
  const seedreamIndex = chain.indexOf('seedream')
  assert.ok(falIndex > seedreamIndex, 'cooling fal must appear after healthy seedream')

  clearProviderCooldown('fal')
  assert.equal(getProviderCooldown('fal'), 0)
})

test('Issue #528: executeWithFallback sets cooldown on 429/503 and attaches fallback provenance', async () => {
  clearAllProviderCooldowns()

  const fakeImage = { bytes: Buffer.from('mock image bytes'), mediaType: 'image/png' }

  // Primary throws 429 Too Many Requests, secondary succeeds
  const generators = {
    fal: async () => {
      const err = new Error('HTTP 429 Too Many Requests: Rate limit exceeded')
      throw err
    },
    replicate: async () => {
      return fakeImage
    },
  }

  const result = await executeWithFallback(generators, ['fal', 'replicate'], 1234, 'cyberpunk city')
  assert.ok(result._fallback)
  assert.equal(result._fallback.triggered, true)
  assert.equal(result._fallback.generatedByFallback, true)
  assert.equal(result._fallback.primaryProvider, 'fal')
  assert.equal(result._fallback.actualProvider, 'replicate')
  assert.equal(result._fallback.attempts.length, 2)
  assert.equal(result._fallback.attempts[0].provider, 'fal')
  assert.equal(result._fallback.attempts[0].success, false)
  assert.equal(result._fallback.attempts[1].provider, 'replicate')
  assert.equal(result._fallback.attempts[1].success, true)

  // Verify fal is now in cooldown
  assert.ok(getProviderCooldown('fal') > 0, 'fal must be in cooldown after 429')
  clearAllProviderCooldowns()
})

test('Issue #529: injectLorasIntoComfyWorkflow dynamically creates LoraLoader nodes', () => {
  const baseGraph = buildDefaultComfyWorkflow({
    prompt: 'photograph of an astronaut',
    negativePrompt: '',
    seed: 10,
    width: 1024,
    height: 1024,
    model: 'sd_xl_base_1.0.safetensors',
  })

  const loras = [
    { path: 'hyper-flux-8step-lora.safetensors', scale: 0.85 },
    { path: 'film-grain-aesthetic.safetensors', scale: 0.5 },
  ]

  const updatedGraph = injectLorasIntoComfyWorkflow(baseGraph, loras)

  const loraNodes = Object.entries(updatedGraph).filter(([, n]) => n.class_type === 'LoraLoader')
  assert.equal(loraNodes.length, 2, 'Must inject exactly 2 LoraLoader nodes')

  assert.equal(loraNodes[0][1].inputs.lora_name, 'hyper-flux-8step-lora.safetensors')
  assert.equal(loraNodes[0][1].inputs.strength_model, 0.85)
  assert.equal(loraNodes[1][1].inputs.lora_name, 'film-grain-aesthetic.safetensors')
  assert.equal(loraNodes[1][1].inputs.strength_model, 0.5)

  const posClipNode = updatedGraph['6']
  assert.ok(posClipNode.inputs.clip[0] !== '4', 'CLIPTextEncode must now receive clip from LoraLoader chain')
})

test('Issue #529: createFalGenerator serializes loras parameter in payload', async () => {
  let capturedBody = null

  const fakePng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d420000000049454e44ae426082', 'hex')

  const fetchImpl = async (url, opts) => {
    if (opts && opts.body) {
      capturedBody = JSON.parse(opts.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          request_id: 'mock-fal-req-456',
          status_url: 'https://queue.fal.run/mock-status',
          response_url: 'https://queue.fal.run/mock-response',
        }),
      }
    }
    // Poll status or fetch image
    if (url.includes('mock-status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'COMPLETED', response_url: 'https://queue.fal.run/mock-response' }),
      }
    }
    if (url.includes('mock-response')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          images: [{ url: 'https://fal.media/files/mock.png', content_type: 'image/png', width: 1024, height: 1024 }],
        }),
      }
    }
    // Image fetch
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => fakePng.buffer.slice(fakePng.byteOffset, fakePng.byteOffset + fakePng.byteLength),
    }
  }

  const resolveKey = async () => 'test-fal-key'
  const cfg = { apiKeyEnv: 'FAL_API_KEY', model: 'fal-ai/flux/dev' }

  const job = {
    prompt: 'A sleek retro vehicle',
    loras: [
      { path: 'https://fal.ai/models/lora1', scale: 0.75 },
      { path: 'https://fal.ai/models/lora2', scale: 1.2 },
    ],
  }

  const generator = createFalGenerator({ fetchImpl, resolveKey, cfg }, job)
  const res = await generator()
  assert.ok(res.bytes)

  assert.ok(Array.isArray(capturedBody.loras))
  assert.equal(capturedBody.loras.length, 2)
  assert.equal(capturedBody.loras[0].path, 'https://fal.ai/models/lora1')
  assert.equal(capturedBody.loras[0].scale, 0.75)
  assert.equal(capturedBody.loras[1].scale, 1.2)
})
