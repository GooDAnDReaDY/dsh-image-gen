// test/progressive-preview.test.mjs — Regression test suite for Progressive Preview and Live Progress (#147, #329, #379)

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createLiveProgressSession,
  publishLiveProgress,
  subscribeLiveProgress,
  completeLiveProgress,
  abortLiveProgress,
  getLiveProgress,
  registerLiveProgressRoutes,
} from '../lib/live-progress.js'
import { createLocalGenerator } from '../lib/providers/backends/local.js'
import { pollStatus } from '../lib/providers/shared-helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

test('live-progress (\#379): session lifecycle, event publishing, and subscriber replay', () => {
  const callId = 'test-call-1'
  const session = createLiveProgressSession(callId)
  assert.equal(session.callId, callId)
  assert.equal(session.done, false)

  const events = []
  const unsubscribe = subscribeLiveProgress(callId, (data) => {
    events.push(data)
  })

  // Initial event replayed immediately
  assert.equal(events.length, 1)
  assert.equal(events[0].callId, callId)
  assert.equal(events[0].stage, 'Starting...')

  // Publish step update
  publishLiveProgress(callId, {
    stage: 'Sampling...',
    step: '5/20',
    progress: 25,
  })

  assert.equal(events.length, 2)
  assert.equal(events[1].progress, 25)
  assert.equal(events[1].step, '5/20')
  assert.equal(events[1].stage, 'Sampling...')

  // Publish draft frame update
  publishLiveProgress(callId, {
    draftUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
  })

  assert.equal(events.length, 3)
  assert.equal(events[2].draftUrl, 'data:image/jpeg;base64,/9j/4AAQSkZJRg==')
  assert.equal(events[2].progress, 25) // preserved previous state

  // Unsubscribe stops receiving events
  unsubscribe()
  publishLiveProgress(callId, { progress: 50 })
  assert.equal(events.length, 3) // no new event

  // Complete session
  completeLiveProgress(callId)
  const snap = getLiveProgress(callId)
  assert.equal(snap.done, true)
  assert.equal(snap.progress, 100)
  assert.equal(snap.stage, 'Complete')
})

test('live-progress (\#379): abortLiveProgress notifies listeners and handles AbortSignal', () => {
  const ac = new AbortController()
  const callId = 'test-call-abort'
  createLiveProgressSession(callId, { signal: ac.signal })

  const events = []
  subscribeLiveProgress(callId, (data) => events.push(data))

  ac.abort()
  const snap = getLiveProgress(callId)
  assert.equal(snap.done, true)
  assert.equal(snap.error, 'Execution aborted')
})

test('live-progress (\#379): FAL status polling reports honest status without fake percentage', async () => {
  const calls = []
  const onProgress = (update) => calls.push(update)

  let pollCount = 0
  const mockFetch = async () => {
    pollCount++
    if (pollCount === 1) {
      return {
        ok: true,
        json: async () => ({ status: 'IN_QUEUE', queue_position: 3 }),
      }
    }
    if (pollCount === 2) {
      return {
        ok: true,
        json: async () => ({ status: 'IN_PROGRESS', progress: 0.6 }),
      }
    }
    return {
      ok: true,
      json: async () => ({ status: 'COMPLETED', response_url: 'http://test/resp' }),
    }
  }

  const res = await pollStatus(mockFetch, 'http://test/status', 'fal-test-key', undefined, 10, 5000, onProgress)
  assert.equal(res.status, 'COMPLETED')

  // Check honest queue reporting
  assert.equal(calls[0].stage, 'In queue (#3)')
  assert.equal(calls[0].progress, undefined) // MUST NOT simulate fake percent in queue

  // Check progress reporting
  assert.equal(calls[1].stage, 'Generating...')
  assert.equal(calls[1].progress, 60)
})

test('live-progress (\#379): ComfyUI generator connects to WebSocket and receives draft frames & progress', async () => {
  const progressEvents = []
  const onProgress = (e) => progressEvents.push(e)

  const fakeJpegBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46])

  // Mock fetch for ComfyUI prompt submit and history with realistic network tick
  const fetchImpl = async (url) => {
    await new Promise((r) => setTimeout(r, 25))
    if (url.endsWith('/prompt')) {
      return {
        ok: true,
        json: async () => ({ prompt_id: 'test-comfy-pid-123' }),
      }
    }
    if (url.includes('/history/')) {
      return {
        ok: true,
        json: async () => ({
          'test-comfy-pid-123': {
            outputs: {
              '9': { images: [{ filename: 'final_001.png', subfolder: '', type: 'output' }] },
            },
          },
        }),
      }
    }
    if (url.includes('/view?')) {
      return {
        ok: true,
        arrayBuffer: async () => Buffer.from('fake-png-data').buffer,
      }
    }
    return { ok: false, status: 404 }
  }

  // Emulate global WebSocket
  const originalWs = globalThis.WebSocket
  class MockWs {
    constructor(url) {
      this.url = url
      setTimeout(() => {
        // Emit queue status
        if (this.onmessage) {
          this.onmessage({ data: JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 2 } } } }) })
        }
        // Emit step progress
        if (this.onmessage) {
          this.onmessage({ data: JSON.stringify({ type: 'progress', data: { value: 10, max: 20 } }) })
        }
        // Emit binary JPEG preview frame
        if (this.onmessage) {
          const header = Buffer.alloc(8)
          header.writeUInt32BE(1, 0)
          header.writeUInt32BE(1, 4)
          this.onmessage({ data: Buffer.concat([header, fakeJpegBytes]) })
        }
      }, 5)
    }
    close() {
      this.closed = true
    }
  }

  try {
    globalThis.WebSocket = MockWs
    const gen = createLocalGenerator(
      { fetchImpl, resolveKey: async () => '', cfg: { localBaseURL: 'http://127.0.0.1:8188', localKind: 'comfyui', timeoutMs: 5000, pollIntervalMs: 50 } },
      { prompt: 'a beautiful sunset', size: '1024x1024', onProgress },
    )

    const result = await gen(12345)
    assert.ok(result.bytes)

    // Verify progress events occurred
    assert.ok(progressEvents.some((e) => e.stage === 'In queue (2 remaining)'))
    assert.ok(progressEvents.some((e) => e.progress === 50 && e.step === '10/20'))
    assert.ok(progressEvents.some((e) => e.draftUrl && e.draftUrl.startsWith('data:image/jpeg;base64,')))
  } finally {
    globalThis.WebSocket = originalWs
  }
})

test('live-progress (\#379): SSE route /dsh-image-gen/live-events delivers event stream and cleans up on close', async () => {
  let registeredRoute = null
  const fakeCtx = {
    effect(fn) { fn() },
    webServer: {
      register(r) {
        registeredRoute = r
      },
    },
  }

  registerLiveProgressRoutes(fakeCtx)
  assert.ok(registeredRoute)
  assert.equal(registeredRoute.path, '/dsh-image-gen/live-events')

  const callId = 'test-sse-call-99'
  const written = []
  let closedHandler = null

  const fakeReq = {
    method: 'GET',
    url: `/dsh-image-gen/live-events?callId=${callId}`,
    headers: { host: '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, handler) {
      if (event === 'close') closedHandler = handler
    },
  }

  let headersWritten = null
  const fakeRes = {
    writeHead(status, headers) {
      headersWritten = { status, headers }
    },
    write(chunk) {
      written.push(chunk)
    },
    end() {},
  }

  await registeredRoute.handler(fakeReq, fakeRes)
  assert.equal(headersWritten.status, 200)
  assert.equal(headersWritten.headers['Content-Type'], 'text/event-stream')
  assert.ok(written.some((w) => w.includes(': connected')))

  // Push an update to session
  publishLiveProgress(callId, { stage: 'Processing...', progress: 40 })
  assert.ok(written.some((w) => w.includes('"progress":40')))

  // Trigger client close
  assert.ok(closedHandler)
  closedHandler()

  // Subsequent updates should not write to closed connection
  const preLen = written.length
  publishLiveProgress(callId, { progress: 80 })
  assert.equal(written.length, preLen)
})

test('live-progress (\#379): CSS includes prefers-reduced-motion for live preview and indeterminate animations', () => {
  const css = fs.readFileSync(path.join(root, 'src', 'client', '10-css.js'), 'utf8')
  assert.match(css, /\.ig-progress-indeterminate/)
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  assert.match(css, /\.ig-progress-fill\{transition:none\s*!important;\s*animation:none\s*!important\}/)
  assert.match(css, /\.ig-progress-indeterminate\{animation:none\s*!important/)
})

test('live-progress (\#379): ProgressiveImagePreview component subscribes with callId and suppresses fake percentage', () => {
  const previewSrc = fs.readFileSync(path.join(root, 'src', 'client', '102-progressive-preview.js'), 'utf8')
  assert.match(previewSrc, /EventSource/)
  assert.match(previewSrc, /\/dsh-image-gen\/live-events\?callId=/)
  assert.match(previewSrc, /es\.close\(\)/)
  assert.match(previewSrc, /ig-progress-indeterminate/)

  const cardSrc = fs.readFileSync(path.join(root, 'src', 'client', '100-image-card.js'), 'utf8')
  assert.match(cardSrc, /callId:\s*block\s*&&\s*\(block\.id\s*\|\|\s*block\.callId\s*\|\|\s*block\.toolCallId/)
})
