import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  workspaceImageName,
  workspaceImageDir,
  containsPath,
  saveImageToWorkspace,
  deleteImageFromWorkspace,
} from '../lib/workspace-save.js'
import { registerWorkspaceSaveTools } from '../lib/tools/workspace-save.js'
import {
  selectedWatermark,
  watermarkCapability,
  applyWatermarkToPayload,
} from '../lib/watermark.js'
import {
  uploadSourceImageToComfyUI,
  interpolateComfyWorkflow,
} from '../lib/comfy-workflow-helpers.js'
import {
  getGalleryDB,
  addGalleryItem,
  getGalleryItems,
  deleteGalleryItem,
  isTombstoned,
  toggleFavorite,
} from '../lib/gallery-store.js'

test('Issue #510: workspaceImageName returns deterministic content-addressed naming', () => {
  const namePng = workspaceImageName('sha256:abcdef0123456789', 'image/png')
  assert.equal(namePng, 'image-abcdef01.png')

  const nameJpg = workspaceImageName('abcdef0123456789', 'image/jpeg')
  assert.equal(nameJpg, 'image-abcdef01.jpg')

  const nameWebp = workspaceImageName('sha256:1234', 'image/webp')
  assert.equal(nameWebp, 'image-12340000.webp')
})

test('Issue #510: workspaceImageDir rejects parent directory traversal', (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-dir-'))
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }))

  const sub = workspaceImageDir(tmpRoot, 'generated/images')
  assert.equal(containsPath(tmpRoot, sub), true)

  assert.throws(() => {
    workspaceImageDir(tmpRoot, '../escaped')
  }, /must stay inside the session workspace/)

  assert.throws(() => {
    workspaceImageDir(tmpRoot, 'foo/../../escaped')
  }, /must stay inside the session workspace/)
})

test('Issue #510: saveImageToWorkspace and deleteImageFromWorkspace lifecycle', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-save-'))
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }))

  const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])
  const saved = await saveImageToWorkspace({
    workspaceRoot: tmpRoot,
    folder: 'assets/output',
    attachmentId: 'sha256:1a2b3c4d5e6f',
    mediaType: 'image/png',
    bytes: fakePng,
  })

  assert.equal(saved.filename, 'image-1a2b3c4d.png')
  assert.equal(fs.existsSync(saved.path), true)
  assert.equal(saved.bytes, fakePng.length)

  // Verify file content matches
  const readBack = fs.readFileSync(saved.path)
  assert.deepEqual(readBack, fakePng)

  // Attempting to delete valid generated image within workspace succeeds
  const deleted = await deleteImageFromWorkspace(saved.path, [tmpRoot])
  assert.equal(deleted, true)
  assert.equal(fs.existsSync(saved.path), false)

  // Attempting to delete non-generated or outside file is rejected
  const userFile = path.join(tmpRoot, 'user-secret.txt')
  fs.writeFileSync(userFile, 'secret')
  const rejected = await deleteImageFromWorkspace(userFile, [tmpRoot])
  assert.equal(rejected, false)
  assert.equal(fs.existsSync(userFile), true)
})

test('Issue #510: save_image_to_workspace tool execution', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-tool-'))
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }))

  const fakePng = Buffer.from([137, 80, 78, 71, 0, 1, 2, 3])
  const mockCtx = {
    effect(fn) { fn() },
    tools: { register(def) { registeredTool = def } },
    attachments: {
      async get(id) {
        if (id === 'att-123') return { data: fakePng, mediaType: 'image/png' }
        return null
      },
    },
  }

  let registeredTool = null
  registerWorkspaceSaveTools(mockCtx, {})
  assert.ok(registeredTool)
  assert.equal(registeredTool.name, 'save_image_to_workspace')

  const res = await registeredTool.execute({
    attachment_id: 'att-123',
    folder: 'images',
  }, {
    agent: { session: { header: { cwd: tmpRoot } } },
  })

  assert.ok(res.path)
  assert.ok(res.filename)
  assert.equal(res.bytes, fakePng.length)
  assert.equal(fs.existsSync(res.path), true)

  const rendered = registeredTool.output.render(null, res)
  assert.ok(Array.isArray(rendered))
  assert.match(rendered[0].text, /Image successfully exported to workspace/)
})

test('Issue #509: Watermark controller capability and payload application', () => {
  assert.equal(selectedWatermark('on'), true)
  assert.equal(selectedWatermark('off'), false)
  assert.equal(selectedWatermark('default', true), true)
  assert.equal(selectedWatermark('default', false), false)

  assert.equal(watermarkCapability('seedream').status, 'supported')
  assert.equal(watermarkCapability('dashscope', 'qwen-image-turbo').status, 'supported')
  assert.equal(watermarkCapability('fal').status, 'unavailable')

  const basePayload = { prompt: 'a beautiful sunset' }
  const withWatermarkOn = applyWatermarkToPayload(basePayload, 'on', 'seedream', 'seedream-4.0')
  assert.equal(withWatermarkOn.watermark, true)

  const withWatermarkOff = applyWatermarkToPayload(basePayload, 'off', 'seedream', 'seedream-4.0')
  assert.equal(withWatermarkOff.watermark, false)

  const untouchedDefault = applyWatermarkToPayload(basePayload, 'default', 'seedream', 'seedream-4.0')
  assert.equal(untouchedDefault.watermark, undefined)

  const unsupported = applyWatermarkToPayload(basePayload, 'off', 'fal', 'flux-dev')
  assert.equal(unsupported.watermark, undefined)
})

test('Issue #511: uploadSourceImageToComfyUI uploads multipart and resolves subfolder', async () => {
  let requestedUrl = ''
  let requestedMethod = ''
  let contentTypeHeader = ''

  const fakeFetch = async (url, opts) => {
    requestedUrl = String(url)
    requestedMethod = opts.method
    return {
      ok: true,
      json: async () => ({
        name: 'generated_image_test.png',
        subfolder: 'clipspace',
        type: 'input',
      }),
    }
  }

  const fakeBytes = Buffer.from([1, 2, 3, 4])
  const result = await uploadSourceImageToComfyUI(
    'http://127.0.0.1:8188',
    { data: fakeBytes, mediaType: 'image/png' },
    fakeFetch
  )

  assert.equal(requestedUrl, 'http://127.0.0.1:8188/upload/image')
  assert.equal(requestedMethod, 'POST')
  assert.equal(result, 'clipspace/generated_image_test.png')
})

test('Issue #511: interpolateComfyWorkflow resolves uploaded image name into LoadImage node', () => {
  const workflow = {
    1: {
      class_type: 'LoadImage',
      inputs: {
        image: 'example.png',
      },
    },
    2: {
      class_type: 'KSampler',
      inputs: {
        seed: '{{seed}}',
        latent_image: ['1', 0],
      },
    },
  }

  const interpolated = interpolateComfyWorkflow(workflow, {
    prompt: 'cat',
    seed: 42,
    image: 'clipspace/uploaded_cat.png',
  })

  assert.equal(interpolated['1'].inputs.image, 'clipspace/uploaded_cat.png')
  assert.equal(interpolated['2'].inputs.seed, 42)
})

test('Issue #508: IndexedDB / Memory Gallery Store manages items, favorites, and tombstones', async () => {
  const item1 = {
    id: 'gal-img-1',
    prompt: 'futuristic flying car',
    provider: 'fal',
    model: 'flux-dev',
    createdAt: 1000,
    isFavorite: false,
    tags: ['sci-fi', 'vehicles'],
  }

  const item2 = {
    id: 'gal-img-2',
    prompt: 'vintage cozy cafe',
    provider: 'seedream',
    model: 'seedream-4.0',
    createdAt: 2000,
    isFavorite: true,
    tags: ['cozy'],
  }

  const added1 = await addGalleryItem(item1)
  const added2 = await addGalleryItem(item2)
  assert.equal(added1, true)
  assert.equal(added2, true)

  const allItems = await getGalleryItems()
  assert.equal(allItems.length, 2)
  assert.equal(allItems[0].id, 'gal-img-2') // sorted by createdAt desc

  const favs = await getGalleryItems({ favoriteOnly: true })
  assert.equal(favs.length, 1)
  assert.equal(favs[0].id, 'gal-img-2')

  // Toggle favorite on item 1
  const newFavState = await toggleFavorite('gal-img-1')
  assert.equal(newFavState, true)

  // Delete item 1 -> creates tombstone
  await deleteGalleryItem('gal-img-1')
  assert.equal(await isTombstoned('gal-img-1'), true)

  const remaining = await getGalleryItems()
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].id, 'gal-img-2')

  // Attempting to resurrect tombstoned item 1 is rejected
  const resurrectAttempt = await addGalleryItem(item1)
  assert.equal(resurrectAttempt, false)
})
