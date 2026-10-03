// test/anchor-face-identity-375.test.mjs
// Regression test suite for Issue #375:
// Face & reference anchors deliver bytes and enforce provider capabilities.

import test from 'node:test'
import assert from 'node:assert/strict'

import { registerAnchorTools } from '../lib/tools/anchor.js'
import {
  getSessionAnchor,
  clearAllAnchors,
  setSessionAnchor,
} from '../lib/anchor-helpers.js'
import { prepareGenerationPrompt } from '../lib/generation-helpers.js'
import { interpolateComfyWorkflow } from '../lib/comfy-workflow-helpers.js'
import { makeProviders } from '../lib/providers.js'
import { createFalGenerator } from '../lib/providers/backends/fal.js'
import { createGeminiGenerator } from '../lib/providers/backends/gemini.js'
import { createReplicateGenerator } from '../lib/providers/backends/replicate.js'
import { createCustomGenerator } from '../lib/providers/backends/custom.js'
import { createSeedreamGenerator } from '../lib/providers/backends/seedream.js'
import { createSubscriptionGenerator } from '../lib/providers/backends/subscription.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==', 'base64')

test('Issue #375: set_style_anchor accepts mode: "face" and alias anchor_type: "face"', async () => {
  clearAllAnchors()
  const registeredTools = []
  const mockCtx = {
    effect: (fn) => fn(),
    tools: {
      register: (tool) => { registeredTools.push(tool) },
    },
  }
  const mockDeps = {
    live: () => ({ enabled: true }),
    resolveSource: async () => ({ bytes: Buffer.from('face-data'), mediaType: 'image/png' }),
  }

  registerAnchorTools(mockCtx, mockDeps)
  const tool = registeredTools.find((t) => t.name === 'set_style_anchor')
  assert.ok(tool, 'set_style_anchor tool must be registered')

  // 1. Test mode: 'face'
  const resFace = await tool.execute(
    { image: 'https://example.com/portrait.jpg', mode: 'face' },
    { agent: { session: { id: 'sess-face-1' } } },
  )
  assert.equal(resFace.ok, true)
  assert.equal(resFace.anchor.mode, 'face')
  assert.equal(resFace.anchor.label, 'Face Identity Anchor')
  assert.equal(resFace.anchor.strength, 0.75)
  assert.ok(resFace.summary.includes('face mode'))

  // 2. Test alias anchor_type: 'face'
  const resAlias = await tool.execute(
    { image: 'https://example.com/portrait-alias.jpg', anchor_type: 'face', label: 'Agent Zero' },
    { agent: { session: { id: 'sess-face-alias' } } },
  )
  assert.equal(resAlias.ok, true)
  assert.equal(resAlias.anchor.mode, 'face')
  assert.equal(resAlias.anchor.label, 'Agent Zero')
  assert.equal(resAlias.anchor.strength, 0.75)

  // 3. Test mode: 'character'
  const resChar = await tool.execute(
    { image: 'https://example.com/char.jpg', mode: 'character' },
    { agent: { session: { id: 'sess-char' } } },
  )
  assert.equal(resChar.anchor.mode, 'character')
  assert.equal(resChar.anchor.strength, 0.75)

  // 4. Test mode: 'style'
  const resStyle = await tool.execute(
    { image: 'https://example.com/art.jpg', mode: 'style' },
    { agent: { session: { id: 'sess-style' } } },
  )
  assert.equal(resStyle.anchor.mode, 'style')
  assert.equal(resStyle.anchor.strength, 0.65)
})

test('Issue #375: set_style_anchor enforces session isolation and clear', async () => {
  clearAllAnchors()
  const registeredTools = []
  const mockCtx = {
    effect: (fn) => fn(),
    tools: {
      register: (tool) => { registeredTools.push(tool) },
    },
  }
  const mockDeps = {
    live: () => ({ enabled: true }),
    resolveSource: async () => ({ bytes: Buffer.from('img'), mediaType: 'image/png' }),
  }
  registerAnchorTools(mockCtx, mockDeps)
  const tool = registeredTools.find((t) => t.name === 'set_style_anchor')

  await tool.execute(
    { image: 'https://example.com/face-a.png', mode: 'face', label: 'User A' },
    { agent: { session: { id: 'sess-a' } } },
  )
  await tool.execute(
    { image: 'https://example.com/face-b.png', mode: 'face', label: 'User B' },
    { agent: { session: { id: 'sess-b' } } },
  )

  const anchorA = getSessionAnchor('sess-a')
  const anchorB = getSessionAnchor('sess-b')
  assert.equal(anchorA.label, 'User A')
  assert.equal(anchorB.label, 'User B')

  // Clear session A
  const resClear = await tool.execute({ clear: true }, { agent: { session: { id: 'sess-a' } } })
  assert.equal(resClear.ok, true)
  assert.equal(resClear.action, 'cleared')
  assert.equal(getSessionAnchor('sess-a'), null)
  assert.equal(getSessionAnchor('sess-b')?.label, 'User B')
})

test('Issue #375: prepareGenerationPrompt resolves faceReference and refImage with directives', async () => {
  clearAllAnchors()
  const mockCtx = {}
  const mockCfg = { style: 'photographic' }
  const mockExec = { signal: null }

  // 1. Explicit face_reference in args
  const resolved1 = await prepareGenerationPrompt({
    ctx: mockCtx,
    cfg: mockCfg,
    args: { prompt: 'detective in noir alley', face_reference: 'https://example.com/face.jpg', face_strength: 0.8 },
    exec: mockExec,
    sessionId: 'session-explicit',
    provider: 'fal',
    resolveSource: async (_c, _e, ref) => ({ bytes: Buffer.from('mock-face-bytes'), mediaType: 'image/jpeg', url: ref }),
  })

  assert.ok(resolved1.resolvedFaceRef, 'resolvedFaceRef must be present')
  assert.equal(Buffer.isBuffer(resolved1.resolvedFaceRef.bytes), true)
  assert.ok(resolved1.effectivePrompt.includes('FaceID facial identity match'))
  assert.ok(resolved1.effectivePrompt.includes('strength: 0.8'))

  // 2. Active anchor in session with mode: 'face'
  setSessionAnchor('session-anchor-face', {
    image: 'https://example.com/anchor-face.png',
    mode: 'face',
    label: 'Elena Rostova',
    strength: 0.85,
  })

  const resolved2 = await prepareGenerationPrompt({
    ctx: mockCtx,
    cfg: mockCfg,
    args: { prompt: 'sitting in cafe' },
    exec: mockExec,
    sessionId: 'session-anchor-face',
    provider: 'fal',
    resolveSource: async (_c, _e, ref) => ({ bytes: Buffer.from('anchor-face-bytes'), mediaType: 'image/png', url: ref }),
  })

  assert.ok(resolved2.resolvedFaceRef, 'resolvedFaceRef must be extracted from activeAnchor')
  assert.ok(resolved2.effectivePrompt.includes('FaceID facial identity match of Elena Rostova'))
  assert.ok(resolved2.effectivePrompt.includes('strength: 0.85'))

  // 3. Style reference image
  setSessionAnchor('session-anchor-style', {
    image: 'https://example.com/watercolor.png',
    mode: 'style',
    label: 'Watercolor Dreams',
    strength: 0.65,
  })

  const resolved3 = await prepareGenerationPrompt({
    ctx: mockCtx,
    cfg: mockCfg,
    args: { prompt: 'mountain peak' },
    exec: mockExec,
    sessionId: 'session-anchor-style',
    provider: 'fal',
    resolveSource: async (_c, _e, ref) => ({ bytes: Buffer.from('style-bytes'), mediaType: 'image/png', url: ref }),
  })

  assert.ok(resolved3.resolvedRefImage, 'resolvedRefImage must be extracted from style anchor')
  assert.ok(resolved3.effectivePrompt.includes('visual style anchor: Watercolor Dreams'))
})

test('Issue #375: interpolateComfyWorkflow interpolates face and reference placeholders', () => {
  const template = {
    1: {
      class_type: 'ApplyIPAdapterFaceID',
      inputs: {
        image: '{{face_image}}',
        weight: '{{face_weight}}',
      },
    },
    2: {
      class_type: 'ApplyIPAdapterStyle',
      inputs: {
        image: '{{reference_image}}',
        weight: '{{reference_weight}}',
      },
    },
  }

  const result = interpolateComfyWorkflow(template, {
    faceImage: 'BASE64_FACE_MOCK',
    faceWeight: 0.85,
    referenceImage: 'BASE64_REF_MOCK',
    referenceWeight: 0.6,
  })

  assert.equal(result[1].inputs.image, 'BASE64_FACE_MOCK')
  assert.equal(result[1].inputs.weight, 0.85)
  assert.equal(result[2].inputs.image, 'BASE64_REF_MOCK')
  assert.equal(result[2].inputs.weight, 0.6)
})

test('Issue #375: FAL, Gemini and Replicate generators forward face reference payloads', async () => {
  const faceBytes = Buffer.from('fake-face-bytes')
  const faceRef = { bytes: faceBytes, mediaType: 'image/jpeg', url: 'https://example.com/face.jpg' }

  // 1. FAL
  let capturedFalBody = null
  const falDeps = {
    fetchImpl: async (url, opts) => {
      const u = String(url)
      if (opts?.body) {
        capturedFalBody = JSON.parse(opts.body)
      }
      if (u.includes('requests/')) {
        return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED', response_url: 'https://queue.fal.run/res' }) }
      }
      if (u === 'https://queue.fal.run/res') {
        return { ok: true, status: 200, json: async () => ({ images: [{ url: 'https://cdn/img.png', width: 1024, height: 1024 }] }) }
      }
      if (u === 'https://cdn/img.png') {
        return { ok: true, status: 200, arrayBuffer: async () => PNG.buffer }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ request_id: 'req_123', status_url: 'https://queue.fal.run/requests/req_123/status', response_url: 'https://queue.fal.run/res' }),
      }
    },
    resolveKey: async () => 'mock-fal-key',
    cfg: { apiKeyEnv: 'FAL_KEY', model: 'fal-ai/flux-lora/face-to-many' },
  }
  const falGen = createFalGenerator(falDeps, {
    prompt: 'test prompt',
    size: '1024x1024',
    format: 'png',
    faceReference: faceRef,
    faceStrength: 0.85,
  })
  await falGen()
  assert.ok(capturedFalBody, 'FAL fetch must be called')
  assert.ok(capturedFalBody.face_image_url.startsWith('data:image/jpeg;base64,'))
  assert.ok(capturedFalBody.reference_image_url.startsWith('data:image/jpeg;base64,'))
  assert.equal(capturedFalBody.id_weight, 0.85)
  assert.equal(capturedFalBody.reference_weight, 0.85)

  // Verify non-identity model rejection before network (#375)
  const nonIdFalGen = createFalGenerator({ ...falDeps, cfg: { apiKeyEnv: 'FAL_KEY', model: 'fal-ai/flux/dev' } }, {
    prompt: 'test prompt',
    size: '1024x1024',
    format: 'png',
    faceReference: faceRef,
  })
  await assert.rejects(
    () => nonIdFalGen(),
    /does not support face identity anchors/
  )

  // 2. Gemini
  let capturedGeminiBody = null
  const geminiDeps = {
    fetchImpl: async (_url, opts) => {
      capturedGeminiBody = JSON.parse(opts.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }],
        }),
      }
    },
    resolveKey: async () => 'mock-gemini-key',
    cfg: { geminiKeyEnv: 'GEMINI_API_KEY', geminiModel: 'gemini-3.1-flash-image' },
  }
  const geminiGen = createGeminiGenerator(geminiDeps, {
    prompt: 'test prompt',
    format: 'png',
    faceReference: faceRef,
    faceStrength: 0.85,
  })
  await geminiGen()
  assert.ok(capturedGeminiBody, 'Gemini fetch must be called')
  const inlinePart = capturedGeminiBody.contents[0].parts.find((p) => p.inlineData)
  assert.ok(inlinePart, 'Gemini payload must include inlineData for faceReference')
  assert.equal(inlinePart.inlineData.mimeType, 'image/jpeg')
  assert.equal(inlinePart.inlineData.data, faceBytes.toString('base64'))

  // 3. Replicate
  let capturedReplicateBody = null
  const replicateDeps = {
    fetchImpl: async (url, opts) => {
      const u = String(url)
      if (opts?.body) {
        capturedReplicateBody = JSON.parse(opts.body)
      }
      if (u.includes('/predictions/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'succeeded', output: ['https://replicate.delivery/out.png'] }),
        }
      }
      if (u === 'https://replicate.delivery/out.png') {
        return { ok: true, status: 200, arrayBuffer: async () => PNG.buffer }
      }
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: 'rep_123',
          urls: { get: 'https://api.replicate.com/v1/predictions/rep_123' },
        }),
      }
    },
    resolveKey: async () => 'mock-replicate-key',
    cfg: { replicateKeyEnv: 'REPLICATE_API_TOKEN', replicateModel: 'stability-ai/sdxl' },
  }
  const replicateGen = createReplicateGenerator(replicateDeps, {
    prompt: 'test prompt',
    size: '1024x1024',
    faceReference: faceRef,
    faceStrength: 0.8,
  })
  await replicateGen()
  assert.ok(capturedReplicateBody, 'Replicate fetch must be called')
  assert.ok(capturedReplicateBody.input.face_image.startsWith('data:image/jpeg;base64,'))
  assert.equal(capturedReplicateBody.input.id_weight, 0.8)
})

test('Issue #375: Unsupported providers reject faceReference before billing or network call', async () => {
  const faceRef = { bytes: Buffer.from('face'), mediaType: 'image/png' }
  const mockDeps = {
    fetchImpl: async () => { throw new Error('Network should not be called!') },
    resolveKey: async () => 'mock-key',
    cfg: {},
  }

  // 1. Custom (OpenAI)
  const customGen = createCustomGenerator(mockDeps, {
    prompt: 'portrait',
    faceReference: faceRef,
  })
  await assert.rejects(
    async () => { await customGen() },
    /does not support facial identity references \(FaceID\)/,
    'Custom provider must reject faceReference before fetch',
  )

  // 2. Seedream
  const seedreamGen = createSeedreamGenerator(mockDeps, {
    prompt: 'portrait',
    faceReference: faceRef,
  })
  await assert.rejects(
    async () => { await seedreamGen() },
    /does not support facial identity references \(FaceID\)/,
    'Seedream must reject faceReference before fetch',
  )

  // 3. Subscription
  const subFactory = createSubscriptionGenerator(mockDeps, {
    prompt: 'portrait',
    faceReference: faceRef,
  })
  const subResult = await subFactory('chatgpt')()
  assert.equal(subResult.ok, false)
  assert.ok(subResult.reason.includes('does not support facial identity references (FaceID)'))
})
