// @ts-check
// test/async-generation.test.mjs — tests for async_generate_image tool (#460).
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import {
  defaultTaskRegistry,
  TASK_STATUSES,
} from '../lib/async-task-manager.js'
import { registerAsyncGenerationTools } from '../lib/tools/async-generation.js'

const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==',
  'base64',
)

test('async-task-manager: manages task lifecycle and exponential backoff polling (#460)', async () => {
  defaultTaskRegistry.clear()

  const task = defaultTaskRegistry.createTask({
    prompt: 'Neon cybernetic landscape',
  })
  assert.equal(task.status, TASK_STATUSES.QUEUED)
  assert.equal(task.progress, 0)

  // Run mock background task that completes after 50ms
  defaultTaskRegistry.runBackgroundTask(task.id, async (onProgress) => {
    onProgress({ progress: 50, stage: 'Denoising' })
    await new Promise((r) => setTimeout(r, 40))
    return { path: '/tmp/art.png', url: 'https://cdn/art.png' }
  })

  const completed = await defaultTaskRegistry.pollTaskWithBackoff(task.id, {
    timeoutMs: 5000,
    initialIntervalMs: 15,
    maxIntervalMs: 50,
  })

  assert.equal(completed.status, TASK_STATUSES.COMPLETED)
  assert.equal(completed.progress, 100)
  assert.equal(completed.result.path, '/tmp/art.png')
})

test('async_generate_image: tool registers with schema and renders output (#460)', () => {
  let registeredTool = null
  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) { registeredTool = def },
    },
  }

  registerAsyncGenerationTools(ctx, {
    live: () => ({ enabled: true }),
    saveAndAttachResult: async () => {},
    slugify: (s) => s,
    resolveApiKey: async () => 'test-key',
  })

  assert.ok(registeredTool, 'async_generate_image must be registered')
  assert.equal(registeredTool.name, 'async_generate_image')
  assert.ok(registeredTool.parameters.properties.prompt)
  assert.ok(registeredTool.parameters.properties.task_id)
  assert.ok(registeredTool.parameters.properties.wait)
  assert.ok(typeof registeredTool.output.render === 'function')

  const rendered = registeredTool.output.render(null, {
    summary: 'Async image generation enqueued',
    taskId: 'task_123',
    status: 'queued',
  })
  assert.ok(Array.isArray(rendered))
  assert.ok(rendered.length >= 1)
})

test('async_generate_image: wait=false returns task_id immediately (#460)', async () => {
  defaultTaskRegistry.clear()
  let registeredTool = null
  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) { registeredTool = def },
    },
    logger: { debug() {}, warn() {}, info() {} },
  }

  registerAsyncGenerationTools(ctx, {
    live: () => ({ enabled: true, provider: 'fal' }),
    saveAndAttachResult: async () => {},
    slugify: (s) => s,
    resolveApiKey: async () => 'test-key',
  })

  const execCtx = {
    signal: new AbortController().signal,
    agent: { session: { id: 'sess-async' } },
  }

  const result = await registeredTool.execute(
    {
      prompt: 'Minimalist architecture in foggy morning light',
      wait: false,
    },
    execCtx,
  )

  assert.ok(result.taskId, 'Must return taskId immediately')
  assert.equal(result.status, 'queued')
  assert.ok(result.summary.includes(result.taskId))
})

test('async_generate_image: wait=true polls and returns final completed artifact (#460)', async () => {
  defaultTaskRegistry.clear()
  let registeredTool = null
  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) { registeredTool = def },
    },
    logger: { debug() {}, warn() {}, info() {} },
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'async-test-'))
  let attachedMeta = null

  const deps = {
    live: () => ({ enabled: true, provider: 'fal', outputDir: tmpDir }),
    saveAndAttachResult: async (_ctx, _exec, _cfg, meta) => {
      attachedMeta = meta
      return {
        path: path.join(tmpDir, meta.name),
        url: `file://${path.join(tmpDir, meta.name)}`,
        attachment: { attachmentId: 'att-async', url: 'https://test-cdn.local/art.png' },
      }
    },
    slugify: (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey: async () => 'test-api-key',
  }

  registerAsyncGenerationTools(ctx, deps)

  // Mock global fetch for fal provider
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('requests/')) {
      return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED', response_url: 'https://cdn/art.png' }) }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => TEST_PNG.buffer.slice(TEST_PNG.byteOffset, TEST_PNG.byteOffset + TEST_PNG.byteLength),
      json: async () => ({
        request_id: 'req-async-1',
        status_url: 'https://queue.fal.run/requests/req-async-1/status',
        response_url: 'https://cdn/art.png',
        images: [{ url: 'https://cdn/art.png', width: 512, height: 512 }],
        seed: 888,
      }),
    }
  }

  const execCtx = {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: tmpDir }, id: 'sess-async-full' } },
  }

  try {
    const result = await registeredTool.execute(
      {
        prompt: 'Futuristic solar observatory on Mars crater rim',
        wait: true,
        timeout_seconds: 10,
      },
      execCtx,
    )

    assert.equal(result.status, 'completed')
    assert.equal(result.progress, 100)
    assert.ok(result.taskId)
    assert.ok(attachedMeta, 'saveAndAttachResult must be invoked')
    assert.equal(attachedMeta.action, 'generated_async')
    assert.ok(attachedMeta.prompt.includes('Futuristic solar observatory'))
  } finally {
    globalThis.fetch = origFetch
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
})

