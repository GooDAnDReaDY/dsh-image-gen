import test from 'node:test'
import assert from 'node:assert/strict'
import { extractComfyNodeErrors, saveAttachmentSafe } from '../lib/providers.js'

test('saveAttachmentSafe: falls back gracefully when ctx.attachments is missing or fails', async () => {
  const dummyBytes = Buffer.from('mock_image_bytes')

  // Case 1: ctx without attachments service
  const res1 = await saveAttachmentSafe({}, {
    bytes: dummyBytes,
    mediaType: 'image/png',
    name: 'test_fallback.png',
  })
  assert.equal(res1.localUrl, '')
  assert.equal(res1.attachment.attachmentId, '')
  assert.equal(res1.attachment.bytes, dummyBytes.length)
  assert.equal(res1.attachment.mediaType, 'image/png')
  assert.equal(res1.attachment.name, 'test_fallback.png')

  // Case 2: ctx with faulty saveImage throwing error
  const res2 = await saveAttachmentSafe({
    attachments: {
      saveImage: async () => { throw new Error('Store full or offline') },
    },
  }, {
    bytes: dummyBytes,
    mediaType: 'image/jpeg',
    name: 'test_fail.jpg',
  })
  assert.equal(res2.localUrl, '')
  assert.equal(res2.attachment.attachmentId, '')
  assert.equal(res2.attachment.mediaType, 'image/jpeg')

  // Case 3: ctx with working saveImage
  const res3 = await saveAttachmentSafe({
    attachments: {
      saveImage: async ({ name, mediaType, data }) => ({
        attachmentId: 'sha256:1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
        mediaType,
        bytes: data.length,
        width: 800,
        height: 600,
        name,
      }),
    },
  }, {
    bytes: dummyBytes,
    mediaType: 'image/webp',
    name: 'test_ok.webp',
  })
  assert.ok(res3.localUrl.startsWith('/dsh-image-gen/image?id=sha256%3A1111'))
  assert.equal(res3.attachment.attachmentId, 'sha256:1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff')
  assert.equal(res3.attachment.width, 800)
  assert.equal(res3.attachment.height, 600)
})

test('extractComfyNodeErrors: parses ComfyUI node execution failures correctly', () => {
  // Case 1: Empty or null
  assert.equal(extractComfyNodeErrors(null), '')
  assert.equal(extractComfyNodeErrors({}), '')

  // Case 2: Success entry
  const successEntry = {
    status: {
      status_str: 'success',
      completed: true,
      messages: [],
    },
  }
  assert.equal(extractComfyNodeErrors(successEntry), '')

  // Case 3: Error with execution_error messages
  const errorEntry = {
    status: {
      status_str: 'error',
      completed: false,
      messages: [
        [
          'execution_error',
          {
            node_id: '4',
            node_type: 'KSampler',
            exception_message: 'CUDA out of memory in tensor allocation',
            exception_type: 'torch.cuda.OutOfMemoryError',
          },
        ],
      ],
    },
  }
  const extracted = extractComfyNodeErrors(errorEntry)
  assert.ok(extracted.includes('node 4 (KSampler)'))
  assert.ok(extracted.includes('CUDA out of memory'))

  // Case 4: Error without messages array
  const rawErrorEntry = {
    status: {
      status_str: 'error',
    },
  }
  assert.equal(extractComfyNodeErrors(rawErrorEntry), 'error')
})

test('history concurrency: parallel batch appends retain all unique entries without race (#365)', async () => {
  const fs = await import('node:fs/promises')
  const fsSync = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { appendHistoryEntry, readHistory, historyFile, writeHistory } = await import('../lib/history.js')

  const prevDshHome = process.env.DSH_HOME
  const testHome = path.join(os.tmpdir(), 'dsh_history_race_test_' + Date.now())
  process.env.DSH_HOME = testHome

  try {
    // 1. Initial write
    await writeHistory([{ id: 'init-0', prompt: 'initial image', path: '/test/0.png' }])

    // 2. Fire 8 concurrent appendHistoryEntry calls simulating a batch generation
    const batchPromises = Array.from({ length: 8 }, (_, i) => {
      const idx = i + 1
      return appendHistoryEntry({
        id: `batch-${idx}`,
        attachmentId: `att-${idx}`,
        prompt: `batch prompt ${idx}`,
        path: `/test/${idx}.png`,
        createdAt: new Date().toISOString(),
      }, { pruneDays: 0, historyLimit: 50 })
    })

    await Promise.all(batchPromises)

    // 3. Read back history - all 8 batch items plus init item must be present (total 9)
    const finalHistory = await readHistory()
    assert.equal(finalHistory.length, 9, 'All concurrent entries must be saved without loss')

    const ids = new Set(finalHistory.map((e) => e.id))
    for (let i = 1; i <= 8; i++) {
      assert.ok(ids.has(`batch-${i}`), `History must contain batch-${i}`)
    }
    assert.ok(ids.has('init-0'), 'History must retain initial entry')

    // 4. Verify file permissions (0600 file, 0700 dir)
    const file = historyFile()
    const statFile = fsSync.statSync(file)
    const statDir = fsSync.statSync(path.dirname(file))
    assert.equal(statFile.mode & 0o777, 0o600, 'History file must have 0600 mode')
    assert.equal(statDir.mode & 0o777, 0o700, 'History dir must have 0700 mode')
  } finally {
    if (prevDshHome !== undefined) {
      process.env.DSH_HOME = prevDshHome
    } else {
      delete process.env.DSH_HOME
    }
    try {
      await fs.rm(testHome, { recursive: true, force: true })
    } catch (_err) { /* cleanup */ }
  }
})
