import test from 'node:test'
import assert from 'node:assert/strict'
import {
  offloadHeavyImageData,
  compactSessionPayload,
  renderToolOutput,
  DEFAULT_OFFLOAD_THRESHOLD,
} from '../lib/attachment-helper.js'

test('image-offload-guard #456: leaves lightweight text without data URIs untouched', async () => {
  const text = 'Here is a simple image generation message: prompt="sunset over mountains", seed=42.'
  const res = await offloadHeavyImageData(text)
  assert.equal(res, text)
})

test('image-offload-guard #456: leaves small data URIs below threshold intact', async () => {
  const smallBase64 = Buffer.from('small-data').toString('base64')
  const smallDataUri = `data:image/png;base64,${smallBase64}`
  const text = `Preview: ${smallDataUri}`
  const res = await offloadHeavyImageData(text, { threshold: 1024 })
  assert.equal(res, text)
})

test('image-offload-guard #456: offloads heavy data URIs (> 1024 chars) to attachment service or disk', async () => {
  const heavyPayload = Buffer.alloc(4096, 0x42).toString('base64')
  const heavyDataUri = `data:image/png;base64,${heavyPayload}`
  const text = `Generated visual: ![preview](${heavyDataUri}) with metadata prompt="cyberpunk street"`

  let savedItem = null
  const mockCtx = {
    attachments: {
      saveImage: async ({ data, mediaType, name }) => {
        savedItem = { data, mediaType, name, attachmentId: 'sha256:abcd1234ef5678' }
        return savedItem
      },
    },
  }

  const res = await offloadHeavyImageData(text, { ctx: mockCtx, threshold: 500 })
  assert.ok(!res.includes(heavyDataUri), 'Heavy data URI must be removed from text')
  assert.ok(res.includes('/dsh-image-gen/image?id=sha256%3Aabcd1234ef5678') || res.includes('sha256:abcd1234ef5678'), 'Must contain lightweight image endpoint URL')
  assert.ok(savedItem !== null, 'saveImage must be called')
  assert.equal(savedItem.mediaType, 'image/png')
})

test('image-offload-guard #456: falls back to disk write if ctx.attachments is unavailable', async () => {
  const heavyPayload = Buffer.alloc(2048, 0x5a).toString('base64')
  const heavyDataUri = `data:image/jpeg;base64,${heavyPayload}`
  const text = `Output: ${heavyDataUri}`

  const res = await offloadHeavyImageData(text, { threshold: 500, cwd: '/tmp' })
  assert.ok(!res.includes(heavyDataUri), 'Heavy data URI must be replaced')
  assert.ok(res.includes('file://'), 'Must contain local file:// URL fallback')
})

test('image-offload-guard #456: compactSessionPayload removes heavy binary buffers from tool results and retains metadata', async () => {
  const rawBuffer = Buffer.alloc(1024 * 100, 0x01)
  const toolResult = {
    summary: 'Generated image (1024x1024, png, seed 12345): /path/to/img.png',
    path: '/path/to/img.png',
    url: '/dsh-image-gen/image?id=sha256:112233',
    width: 1024,
    height: 1024,
    seed: 12345,
    prompt: 'a majestic lion in savanna',
    cost: 0.025,
    format: 'png',
    attachment: {
      attachmentId: 'sha256:112233',
      mediaType: 'image/png',
      bytes: rawBuffer, // heavy raw buffer that causes token blowout
      width: 1024,
      height: 1024,
      name: 'lion.png',
    },
  }

  const compacted = await compactSessionPayload(toolResult)
  assert.equal(typeof compacted.attachment.bytes, 'number', 'Attachment bytes must be converted to integer byte length')
  assert.equal(compacted.attachment.bytes, 1024 * 100)
  assert.equal(compacted.attachment.attachmentId, 'sha256:112233')
  assert.equal(compacted.width, 1024)
  assert.equal(compacted.seed, 12345)
  assert.equal(compacted.prompt, 'a majestic lion in savanna')
  assert.equal(compacted.cost, 0.025)
})

test('image-offload-guard #456: renderToolOutput cleanses heavy data URIs from text block and sanitizes attachment block', () => {
  const heavyBase64 = Buffer.alloc(3000, 0x99).toString('base64')
  const heavyDataUri = `data:image/png;base64,${heavyBase64}`
  const value = {
    summary: `Done: ${heavyDataUri}`,
    attachment: {
      attachmentId: 'sha256:998877',
      mediaType: 'image/png',
      bytes: Buffer.alloc(3000),
      width: 512,
      height: 512,
    },
  }

  const blocks = renderToolOutput(value)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].type, 'text')
  assert.ok(!blocks[0].text.includes(heavyBase64), 'Text block must not contain heavy base64 data')
  assert.ok(blocks[0].text.includes('/dsh-image-gen/image?id='), 'Text block replaces base64 with compact route URL')

  assert.equal(blocks[1].type, 'image')
  assert.equal(typeof blocks[1].attachment.bytes, 'number', 'Attachment bytes must be a numeric count, not a buffer')
  assert.equal(blocks[1].attachment.attachmentId, 'sha256:998877')
})

test('image-offload-guard #456: session middleware intercepts message.content with heavy data URIs', async () => {
  const heavyPayload = Buffer.alloc(2000, 0xaa).toString('base64')
  const session = {
    content: `User requested review of data:image/png;base64,${heavyPayload} inline`,
    elements: [
      { type: 'img', attrs: { src: `data:image/png;base64,${heavyPayload}` } },
    ],
  }

  const mockCtx = {
    attachments: {
      saveImage: async () => ({ attachmentId: 'sha256:mock999' }),
    },
  }

  session.content = await offloadHeavyImageData(session.content, { ctx: mockCtx, threshold: 500 })
  session.elements[0].attrs.src = await offloadHeavyImageData(session.elements[0].attrs.src, { ctx: mockCtx, threshold: 500 })

  assert.ok(!session.content.includes(heavyPayload))
  assert.ok(!session.elements[0].attrs.src.includes(heavyPayload))
  assert.ok(session.elements[0].attrs.src.includes('/dsh-image-gen/image?id=sha256%3Amock999'))
})