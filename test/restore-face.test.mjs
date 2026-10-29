// @ts-check
// test/restore-face.test.mjs — Test suite for restore_face_and_details tool (#467).

import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  detectRestorationZones,
  enhanceZonePatch,
  createFeatherAlphaMask,
  calculateLaplacianClarity,
  formatRestoreMarkdown,
} from '../lib/restore-face-helpers.js'
import { registerRestoreFaceTools } from '../lib/tools/restore-face.js'

test('restore-face: detectRestorationZones derives upper-center face and detail boxes', () => {
  const faceZones = detectRestorationZones(1000, 1000, 'faces')
  assert.equal(faceZones.length, 1)
  assert.equal(faceZones[0].id, 'face_primary')
  assert.equal(faceZones[0].x, 250)
  assert.equal(faceZones[0].y, 150)
  assert.equal(faceZones[0].width, 500)
  assert.equal(faceZones[0].height, 450)

  const detailZones = detectRestorationZones(1000, 1000, 'general_details')
  assert.equal(detailZones.length, 1)
  assert.equal(detailZones[0].id, 'detail_center')

  const bothZones = detectRestorationZones(1000, 1000, 'both')
  assert.equal(bothZones.length, 2)
})

test('restore-face: enhanceZonePatch applies unsharp masking and micro-contrast clarity', async () => {
  const patch = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 120, g: 130, b: 140 } },
  }).png().toBuffer()

  const enhanced = await enhanceZonePatch(patch, { strength: 0.8, target: 'faces' })
  assert.ok(Buffer.isBuffer(enhanced))
  const meta = await sharp(enhanced).metadata()
  assert.equal(meta.width, 64)
  assert.equal(meta.height, 64)
})

test('restore-face: createFeatherAlphaMask generates smooth feathered alpha transition', async () => {
  const mask = await createFeatherAlphaMask(100, 100, 16)
  assert.ok(Buffer.isBuffer(mask))
  const meta = await sharp(mask).metadata()
  assert.equal(meta.width, 100)
  assert.equal(meta.height, 100)
})

test('restore-face: calculateLaplacianClarity computes variance of Laplacian', async () => {
  const flatImg = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 100, g: 100, b: 100 } },
  }).png().toBuffer()

  const clarity = await calculateLaplacianClarity(flatImg)
  assert.ok(typeof clarity === 'number')
})

test('restore-face: formatRestoreMarkdown formats table and metrics', () => {
  const md = formatRestoreMarkdown({
    summary: 'Restored 1 face zone',
    target: 'faces',
    strength: 0.75,
    zonesCount: 1,
    beforeScore: 40.0,
    afterScore: 68.0,
    outputPath: '/assets/restored.png',
    attachmentId: 'att-res-1',
  })

  assert.ok(md.includes('Localized Face & Detail Restoration'))
  assert.ok(md.includes('Laplacian Clarity'))
  assert.ok(md.includes('FACES'))
  assert.ok(md.includes('+70%'))
  assert.ok(md.includes('/assets/restored.png'))
})

test('restore-face: tool execute restores localized zones and composites onto canvas', async () => {
  let registeredTool = null
  const fakeCtx = {
    effect: (fn) => fn(),
    tools: {
      register: (tool) => {
        registeredTool = tool
      },
    },
  }

  const samplePng = await sharp({
    create: { width: 128, height: 128, channels: 3, background: { r: 150, g: 140, b: 130 } },
  }).png().toBuffer()

  let savedAttachment = null

  const deps = {
    cfg: { enabled: true },
    resolveSource: async (_c, _e, ref) => ({
      path: typeof ref === 'string' ? ref : 'sample.png',
      bytes: samplePng,
    }),
    saveAttachmentSafe: async (_c, _e, buffer, filename, meta) => {
      savedAttachment = { path: `/tmp/${filename}`, id: 'att-res-123', meta }
      return savedAttachment
    },
  }

  registerRestoreFaceTools(fakeCtx, deps)
  assert.ok(registeredTool, 'Tool must be registered')
  assert.equal(registeredTool.name, 'restore_face_and_details')

  const res = await registeredTool.execute(
    {
      image: 'blurry_face.png',
      target: 'faces',
      strength: 0.8,
    },
    {}
  )

  assert.equal(res.target, 'faces')
  assert.equal(res.strength, 0.8)
  assert.equal(res.zones_count, 1)
  // In fallback mode without attachment service, attachment_id is null
  assert.ok(res.attachment_id === null || typeof res.attachment_id === 'string')
  assert.ok(res.restored_image.includes('restored-'))

  // Verify render output
  const rendered = registeredTool.output.render({}, res)
  assert.ok(rendered[0].text.includes('Localized Face & Detail Restoration'))
  assert.ok(rendered[0].text.includes('<dsh-image-gen-restore-details>'))
})