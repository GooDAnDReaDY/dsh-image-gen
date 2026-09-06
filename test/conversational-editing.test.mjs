import test from 'node:test'
import assert from 'node:assert/strict'
import {
  findLastConversationImage,
  detectMediaType,
  resolveConversationImage,
  analyzeImageWithVision,
  buildDualOutputMarkdown,
} from '../lib/resolve-image.js'
// import buildDualOutputMarkdown directly from resolve-image.js
import { editImageDirect, varyImageDirect } from '../lib/providers.js'

test('findLastConversationImage: извлекает последнее изображение из attachments сессии (#144)', () => {
  const exec = {
    agent: {
      session: {
        deriveMessages: () => [
          { role: 'user', content: 'hello' },
          {
            role: 'assistant',
            attachments: [
              { attachmentId: 'sha256:1111111111111111111111111111111111111111111111111111111111111111', mediaType: 'image/png', name: 'first.png' }
            ]
          },
          { role: 'user', content: 'make changes' },
          {
            role: 'assistant',
            attachments: [
              { attachmentId: 'sha256:2222222222222222222222222222222222222222222222222222222222222222', mediaType: 'image/png', name: 'second.png' }
            ]
          }
        ]
      }
    }
  }

  const found = findLastConversationImage(exec)
  assert.ok(found)
  assert.equal(found.ref, 'sha256:2222222222222222222222222222222222222222222222222222222222222222')
  assert.equal(found.name, 'second.png')
})

test('findLastConversationImage: извлекает изображение из tool_result если вложений нет (#144)', () => {
  const exec = {
    agent: {
      session: {
        deriveMessages: () => [
          {
            role: 'tool',
            content: [
              {
                type: 'tool_result',
                content: 'Image generated: File: `assets/images/concept-banner.png` (1024x1024)'
              }
            ]
          }
        ]
      }
    }
  }

  const found = findLastConversationImage(exec)
  assert.ok(found)
  assert.equal(found.ref, 'assets/images/concept-banner.png')
  assert.equal(found.name, 'concept-banner.png')
})

test('findLastConversationImage: возвращает undefined при пустой истории (#144)', () => {
  const exec = {
    agent: {
      session: {
        deriveMessages: () => [
          { role: 'user', content: 'just text' },
          { role: 'assistant', content: 'plain answer' }
        ]
      }
    }
  }
  const found = findLastConversationImage(exec)
  assert.equal(found, undefined)
})

test('detectMediaType: распознает сигнатуры форматов и расширения (#144)', () => {
  const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00])
  assert.equal(detectMediaType('unknown', pngSig), 'image/png')

  const jpgSig = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46])
  assert.equal(detectMediaType('unknown', jpgSig), 'image/jpeg')

  assert.equal(detectMediaType('photo.webp'), 'image/webp')
  assert.equal(detectMediaType('vector.svg'), 'image/svg+xml')
})

test('resolveConversationImage: авто-резолвит последнее изображение при targetRef = "latest" (#144)', async () => {
  const dummyPng = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00])
  const targetId = 'sha256:3333333333333333333333333333333333333333333333333333333333333333'
  const ctx = {
    attachments: {
      readImage: async (arg) => {
        assert.equal(arg.attachmentId, targetId)
        return {
          data: dummyPng,
          ref: { mediaType: 'image/png' }
        }
      }
    }
  }
  const exec = {
    agent: {
      session: {
        deriveMessages: () => [
          {
            role: 'assistant',
            attachments: [{ attachmentId: targetId, mediaType: 'image/png', name: 'latest-art.png' }]
          }
        ]
      }
    }
  }

  const res = await resolveConversationImage(ctx, exec, 'latest')
  assert.equal(res.ref, targetId)
  assert.equal(res.mediaType, 'image/png')
  assert.equal(Buffer.compare(res.bytes, dummyPng), 0)
})

test('resolveConversationImage: бросает понятную ошибку если предыдущего изображения нет (#144)', async () => {
  const ctx = {}
  const exec = {
    agent: {
      session: {
        deriveMessages: () => []
      }
    }
  }

  await assert.rejects(
    async () => resolveConversationImage(ctx, exec, 'latest'),
    /No previous image found in the active conversation session/
  )
})

test('analyzeImageWithVision: вызывает dsh-vision-bridge если инструмент доступен (#145)', async () => {
  let calledWith = null
  const ctx = {
    tools: {
      get: (name) => {
        if (name === 'inspect_image') {
          return {
            execute: async (args) => {
              calledWith = args
              return { description: 'Minimalist neon skyline with violet and teal palette' }
            }
          }
        }
        return undefined
      }
    }
  }
  const exec = {}
  const source = {
    bytes: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4]),
    mediaType: 'image/png',
    ref: 'sha256:abc'
  }

  const result = await analyzeImageWithVision(ctx, exec, source)
  assert.equal(result.available, true)
  assert.equal(result.summary, 'Minimalist neon skyline with violet and teal palette')
  assert.equal(calledWith.source, 'sha256:abc')
})

test('analyzeImageWithVision: грациозный фоллбек без падения если dsh-vision-bridge отсутствует (#145)', async () => {
  const ctx = {
    tools: {
      get: () => undefined
    }
  }
  const source = {
    bytes: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 5, 10, 15, 20, 25, 30]),
    mediaType: 'image/png',
    ref: 'test.png'
  }

  const result = await analyzeImageWithVision(ctx, {}, source)
  assert.equal(result.available, false)
  assert.match(result.summary, /(Detected visual asset|Low-contrast or uniform canvas)/)
})

test('buildDualOutputMarkdown: возвращает безопасный структурированный текст без base64 (#150)', () => {
  const md = buildDualOutputMarkdown({
    action: 'edited',
    filePath: 'assets/images/cyberpunk-cat-edit.png',
    width: 1024,
    height: 1024,
    mediaType: 'image/png',
    seed: 4242,
    provider: 'fal',
    model: 'fal-ai/flux-pro/v1/inpaint',
    cost: 0.035,
    attachmentId: 'sha256:deadbeef1234',
  })

  assert.match(md, /Image edited successfully/)
  assert.match(md, /cyberpunk-cat-edit\.png/)
  assert.match(md, /1024x1024/)
  assert.match(md, /Seed:\*\* 4242/)
  assert.match(md, /Cost:\*\* \$0\.0350/)
  assert.match(md, /Attachment ID:\*\* `sha256:deadbeef1234`/)
  assert.ok(!md.includes('data:image'))
  assert.ok(!md.includes('base64'))
})

test('editImageDirect: формирует корректный inpainting вызов (#142)', async () => {
  let calledUrl = null
  let calledBody = null
  const deps = {
    fetchImpl: async (url, opts) => {
      calledUrl = url
      calledBody = JSON.parse(opts.body)
      return {
        ok: true,
        json: async () => ({ status_url: 'https://queue.fal.run/status/123' })
      }
    },
    resolveKey: async () => 'test-key',
    cfg: { apiKeyEnv: 'FAL_KEY', baseURL: 'https://queue.fal.run' }
  }

  const sourceBytes = Buffer.from('dummy-source-bytes')
  const maskBytes = Buffer.from('dummy-mask-bytes')

  try {
    await editImageDirect(deps, {
      provider: 'fal',
      prompt: 'replace car with futuristic flyer',
      source: { bytes: sourceBytes, mediaType: 'image/png' },
      mask: { bytes: maskBytes, mediaType: 'image/png' },
      seed: 777,
      strength: 0.85,
    })
  } catch {
    // Poll loop will terminate after first submit check in mock test
  }

  assert.ok(calledUrl)
  assert.match(calledUrl, /fal-ai\/flux-pro\/v1\/inpaint/)
  assert.ok(calledBody.image_url.startsWith('data:image/png;base64,'))
  assert.ok(calledBody.mask_url.startsWith('data:image/png;base64,'))
  assert.equal(calledBody.strength, 0.85)
})

test('varyImageDirect: передает variation strength в генератор (#143)', async () => {
  let calledUrl = null
  let calledBody = null
  const deps = {
    fetchImpl: async (url, opts) => {
      calledUrl = url
      calledBody = JSON.parse(opts.body)
      return {
        ok: true,
        json: async () => ({ status_url: 'https://queue.fal.run/status/456' })
      }
    },
    resolveKey: async () => 'test-key',
    cfg: { apiKeyEnv: 'FAL_KEY', baseURL: 'https://queue.fal.run' }
  }

  const sourceBytes = Buffer.from('dummy-source-bytes')

  try {
    await varyImageDirect(deps, {
      provider: 'fal',
      prompt: 'subtle variation',
      source: { bytes: sourceBytes, mediaType: 'image/png' },
      seed: 888,
      variationStrength: 0.35,
    })
  } catch {
    // Poll loop in mock test
  }

  assert.ok(calledUrl)
  assert.match(calledUrl, /fal-ai\/flux\/dev\/image-to-image/)
  assert.ok(calledBody.image_url.startsWith('data:image/png;base64,'))
  assert.equal(calledBody.strength, 0.35)
})
