import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import http from 'node:http'

const root = resolve(process.cwd())

function loadFetchWithTimeout() {
  const runtimeSrc = readFileSync(join(root, 'src/client/00-runtime.js'), 'utf8')
  // Extract fetchWithTimeout function definition from 00-runtime.js
  const startIdx = runtimeSrc.indexOf('async function fetchWithTimeout(')
  assert.ok(startIdx !== -1, 'fetchWithTimeout must be defined in 00-runtime.js')
  const endMarker = 'const fetchJson = fetchWithTimeout'
  const endIdx = runtimeSrc.indexOf(endMarker, startIdx)
  assert.ok(endIdx !== -1, 'const fetchJson = fetchWithTimeout marker must be found')

  const fnSrc = runtimeSrc.slice(startIdx, endIdx).trim()
  const factory = new Function(`${fnSrc}\nreturn fetchWithTimeout;`)
  return factory()
}

test('behavior: fetchWithTimeout aborts never-resolving fetch when no signal is passed (#444)', async () => {
  const fetchWithTimeout = loadFetchWithTimeout()
  let serverReqReceived = false

  const server = http.createServer((req, res) => {
    serverReqReceived = true
    // Never write response or finish to simulate hung server
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/hung-request`

  const start = Date.now()
  try {
    await assert.rejects(
      async () => {
        await fetchWithTimeout(url, { timeoutMs: 250 })
      },
      (err) => {
        const msg = String(err?.message || err)
        const name = err?.name
        // AbortError or Request timeout
        return name === 'AbortError' || name === 'TimeoutError' || msg.includes('timeout') || msg.includes('aborted')
      }
    )
    const elapsed = Date.now() - start
    assert.ok(elapsed < 2000, `Expected timeout in <2s, took ${elapsed}ms`)
    assert.ok(serverReqReceived, 'Server should have received the request before timeout')
  } finally {
    server.close()
  }
})

test('behavior: fetchWithTimeout applies timeout when caller provides external signal (#444)', async () => {
  const fetchWithTimeout = loadFetchWithTimeout()

  const server = http.createServer((req, res) => {
    // Never resolve
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/hung-with-caller-signal`

  const callerCtrl = new AbortController()
  const start = Date.now()

  try {
    await assert.rejects(
      async () => {
        await fetchWithTimeout(url, { timeoutMs: 100, signal: callerCtrl.signal })
      },
      (err) => {
        const msg = String(err?.message || err)
        const name = err?.name
        return name === 'AbortError' || name === 'TimeoutError' || msg.includes('timeout') || msg.includes('aborted')
      }
    )
    const elapsed = Date.now() - start
    assert.ok(elapsed < 2000, `Expected timeout in <2s with caller signal, took ${elapsed}ms`)
  } finally {
    server.close()
  }
})

test('behavior: fetchWithTimeout respects caller cancellation before timeout (#444)', async () => {
  const fetchWithTimeout = loadFetchWithTimeout()

  const server = http.createServer((req, res) => {
    // Never resolve
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/hung-manual-abort`

  const callerCtrl = new AbortController()
  setTimeout(() => callerCtrl.abort(new Error('user cancelled')), 30)

  const start = Date.now()
  try {
    await assert.rejects(
      async () => {
        await fetchWithTimeout(url, { timeoutMs: 1000, signal: callerCtrl.signal })
      },
      (err) => {
        const msg = String(err?.message || err)
        return msg.includes('user cancelled') || err?.name === 'AbortError'
      }
    )
    const elapsed = Date.now() - start
    assert.ok(elapsed < 500, `Expected immediate cancellation in <500ms, took ${elapsed}ms`)
  } finally {
    server.close()
  }
})

test('behavior: fetchWithTimeout returns raw response on successful completion (#444)', async () => {
  const fetchWithTimeout = loadFetchWithTimeout()

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', value: 42 }))
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/ok`

  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 2000 })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.deepEqual(data, { status: 'ok', value: 42 })
  } finally {
    server.close()
  }
})
test('behavior: fetchWithTimeout timeout fallback works when AbortSignal.any is undefined (#444)', async () => {
  const runtimeSrc = readFileSync(join(root, 'src/client/00-runtime.js'), 'utf8')
  const startIdx = runtimeSrc.indexOf('async function fetchWithTimeout(')
  assert.ok(startIdx !== -1, 'fetchWithTimeout must be defined in 00-runtime.js')
  const endMarker = 'const fetchJson = fetchWithTimeout'
  const endIdx = runtimeSrc.indexOf(endMarker, startIdx)
  assert.ok(endIdx !== -1, 'const fetchJson = fetchWithTimeout marker must be found')

  const fnSrc = runtimeSrc.slice(startIdx, endIdx).trim()
  // Create sandbox function without AbortSignal.any
  const sandboxFactory = new Function('AbortSignal', 'fetch', 'setTimeout', 'clearTimeout', 'AbortController', `
    ${fnSrc}
    return fetchWithTimeout;
  `)

  const mockAbortSignal = {
    timeout: (ms) => AbortSignal.timeout(ms),
  }

  const mockedFetchWithTimeout = sandboxFactory(
    mockAbortSignal,
    globalThis.fetch,
    globalThis.setTimeout,
    globalThis.clearTimeout,
    globalThis.AbortController
  )

  const server = http.createServer((req, res) => {})
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/hung-no-signal-any`

  const callerCtrl = new AbortController()
  const start = Date.now()
  try {
    await assert.rejects(
      async () => {
        await mockedFetchWithTimeout(url, { timeoutMs: 100, signal: callerCtrl.signal })
      },
      (err) => {
        const msg = String(err?.message || err)
        return err?.name === 'AbortError' || err?.name === 'TimeoutError' || msg.includes('timeout') || msg.includes('aborted')
      }
    )
    const elapsed = Date.now() - start
    assert.ok(elapsed < 2000, `Expected timeout in <2s without AbortSignal.any, took ${elapsed}ms`)
  } finally {
    server.close()
  }
})
