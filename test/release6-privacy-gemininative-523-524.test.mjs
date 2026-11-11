import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGeminiGenerator } from '../lib/providers/backends/gemini.js'
import { Config, ensureConfig, plainConfig } from '../lib/config-schema.js'

test('Issue #523: Config schema defines geminiBaseURL and googleNative with defaults', () => {
  const cfg = plainConfig(ensureConfig({}))
  assert.equal(cfg.geminiBaseURL, 'https://generativelanguage.googleapis.com')
  assert.equal(cfg.googleNative, false)

  const custom = plainConfig(ensureConfig({
    geminiBaseURL: 'https://relay.example.com/v1beta',
    googleNative: true,
  }))
  assert.equal(custom.geminiBaseURL, 'https://relay.example.com/v1beta')
  assert.equal(custom.googleNative, true)
})

test('Issue #523: Gemini generator dispatches to custom baseURL and passes auth headers', async () => {
  let capturedUrl = ''
  let capturedHeaders = {}
  let capturedBody = null

  const fakePng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d420000000049454e44ae426082', 'hex')
  const fakeBase64 = fakePng.toString('base64')

  const fetchImpl = async (url, opts) => {
    capturedUrl = url
    capturedHeaders = opts.headers
    capturedBody = JSON.parse(opts.body)
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: fakeBase64,
                  },
                },
              ],
            },
          },
        ],
      }),
    }
  }

  const resolveKey = async () => 'test-gemini-secret-key'
  const cfg = {
    geminiKeyEnv: 'GEMINI_API_KEY',
    geminiModel: 'gemini-3.1-flash-image',
    geminiBaseURL: 'https://relay.example.com/v1beta',
    googleNative: true,
  }

  const generator = createGeminiGenerator(
    { fetchImpl, resolveKey, cfg },
    { prompt: 'A glowing futuristic cyber lotus in neon pond', aspectRatio: 'landscape_16_9' }
  )

  const result = await generator()
  assert.ok(result.bytes)
  assert.equal(result.mediaType, 'image/png')
  assert.ok(capturedUrl.startsWith('https://relay.example.com/v1beta/models/gemini-3.1-flash-image:generateContent'))
  assert.ok(capturedUrl.includes('key=test-gemini-secret-key'))
  assert.equal(capturedHeaders['x-goog-api-key'], 'test-gemini-secret-key')
  assert.equal(capturedHeaders['Authorization'], 'Bearer test-gemini-secret-key')
  assert.equal(capturedBody.generationConfig.aspectRatio, undefined) // under imageConfig
  assert.equal(capturedBody.generationConfig.imageConfig.aspectRatio, '16:9')
  assert.deepEqual(capturedBody.generationConfig.responseModalities, ['TEXT', 'IMAGE'])
})

test('Issue #523: Gemini generator parses Vertex AI prediction format and markdown base64 fallback', async () => {
  const fakePng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d420000000049454e44ae426082', 'hex')
  const fakeBase64 = fakePng.toString('base64')

  // 1. Vertex AI predictions format
  const fetchVertex = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      predictions: [
        {
          bytesBase64Encoded: fakeBase64,
        },
      ],
    }),
  })

  const gen1 = createGeminiGenerator(
    { fetchImpl: fetchVertex, resolveKey: async () => 'test-key', cfg: { geminiKeyEnv: 'KEY' } },
    { prompt: 'test vertex' }
  )
  const res1 = await gen1()
  assert.ok(res1.bytes)

  // 2. Markdown data-uri in candidate text
  const fetchMarkdown = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [
              {
                text: `Here is your render: ![result](data:image/png;base64,${fakeBase64})`,
              },
            ],
          },
        },
      ],
    }),
  })

  const gen2 = createGeminiGenerator(
    { fetchImpl: fetchMarkdown, resolveKey: async () => 'test-key', cfg: { geminiKeyEnv: 'KEY' } },
    { prompt: 'test markdown' }
  )
  const res2 = await gen2()
  assert.ok(res2.bytes)
})

test('Issue #523: Gemini generator propagates descriptive errors on HTTP failure', async () => {
  const fetchErr = async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      error: {
        message: 'API key not authorized for model gemini-3.1-flash-image',
      },
    }),
  })

  const gen = createGeminiGenerator(
    { fetchImpl: fetchErr, resolveKey: async () => 'invalid-key', cfg: { geminiKeyEnv: 'KEY' } },
    { prompt: 'error test' }
  )

  await assert.rejects(
    gen(),
    /Gemini failed \(HTTP 403\): API key not authorized/
  )
})

test('Issue #524: Privacy Mode client bundle exports and keydown listener setup', () => {
  const clientSrc = readFileSync(resolve('lib/client.js'), 'utf8')

  // Check state and persistence
  assert.ok(clientSrc.includes('dsh_image_gen_privacy_mode'), 'declares privacy storage key')
  assert.ok(clientSrc.includes('isPrivacyMode'), 'tracks privacy mode state')
  assert.ok(clientSrc.includes('togglePrivacyMode'), 'exports togglePrivacyMode function')
  assert.ok(clientSrc.includes('usePrivacyMode'), 'exports usePrivacyMode React hook')

  // Check Alt+Shift+H shortcut
  assert.ok(clientSrc.includes('e.altKey && e.shiftKey'), 'inspects altKey and shiftKey modifiers')
  assert.ok(clientSrc.includes('KeyH') || clientSrc.includes("'H'"), 'checks H key')

  // Check UI components and slots
  assert.ok(clientSrc.includes('PrivacyModeChip'), 'defines PrivacyModeChip component')
  assert.ok(clientSrc.includes('dsh-image-gen-privacy-chip'), 'registers privacy chip slot in header utilities')
  assert.ok(clientSrc.includes('ig-privacy-mode'), 'defines ig-privacy-mode class')
  assert.ok(clientSrc.includes('filter: blur(28px) grayscale(50%)'), 'applies privacy blur disguise filter')
})

test('Issue #524: Locale parity and privacy keys exist in both en and zh', () => {
  const enSrc = readFileSync(resolve('src/client/110-locale-en.js'), 'utf8')
  const zhSrc = readFileSync(resolve('src/client/120-locale-zh.js'), 'utf8')

  const requiredKeys = [
    'privacy.title',
    'privacy.toggle',
    'privacy.active',
    'privacy.inactive',
    'privacy.revealHint',
    'f.geminiBaseURL',
    'f.googleNative',
  ]

  for (const k of requiredKeys) {
    assert.ok(enSrc.includes(`'${k}'`), `EN locale has ${k}`)
    assert.ok(zhSrc.includes(`'${k}'`), `ZH locale has ${k}`)
  }
})
