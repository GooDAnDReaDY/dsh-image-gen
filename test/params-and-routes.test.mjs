import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import { registerFrontendTools } from '../lib/tools/frontend.js'
import { apply } from '../lib/index.js'

test('tools (#413): generate_pwa_icon_suite declares out_dir in parameter schema', () => {
  const registeredTools = new Map()
  const fakeCtx = {
    effect: (fn) => fn(),
    tools: {
      register: (tool) => {
        registeredTools.set(tool.name, tool)
      },
    },
  }

  registerFrontendTools(fakeCtx, {
    live: () => ({}),
    resolveSource: async () => null,
  })

  const pwaTool = registeredTools.get('generate_pwa_icon_suite')
  assert.ok(pwaTool, 'generate_pwa_icon_suite tool must be registered')

  // #413: out_dir must be declared in parameters schema alongside icons_dir
  const props = pwaTool.parameters?.properties || pwaTool.parameters
  assert.ok(props.icons_dir, 'icons_dir parameter must exist')
  assert.ok(props.out_dir, 'out_dir parameter must exist (#413)')
  assert.equal(props.out_dir.type, 'string')
})

test('tools (#413): generate_pwa_icon_suite respects declared out_dir parameter', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-pwa-outdir-'))
  const customTargetDir = path.join(tmpDir, 'custom-public')
  const registeredTools = new Map()
  const fakeCtx = {
    effect: (fn) => fn(),
    tools: {
      register: (tool) => {
        registeredTools.set(tool.name, tool)
      },
    },
  }

  registerFrontendTools(fakeCtx, {
    live: () => ({}),
    resolveSource: async () => null,
  })

  const pwaTool = registeredTools.get('generate_pwa_icon_suite')
  const fakeExec = {
    agent: {
      session: {
        header: { cwd: tmpDir },
      },
    },
  }

  const res = await pwaTool.execute(
    {
      name: 'TestOutDirApp',
      short_name: 'OutApp',
      out_dir: customTargetDir,
      icons_dir: 'assets/icons',
    },
    fakeExec,
  )

  const parsed = typeof res === 'string' ? JSON.parse(res) : res
  assert.ok(parsed.exportedFiles.length >= 8)

  // Verify all files were written inside customTargetDir
  for (const file of parsed.exportedFiles) {
    assert.ok(file.startsWith(customTargetDir), `Exported file ${file} must be in ${customTargetDir}`)
    const stat = await fs.stat(file)
    assert.ok(stat.size > 0, `File ${file} must not be empty`)
  }

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('routes (#419): /dsh-image-gen/diagnostics/test supports GET, POST with JSON body, and rejects others with 405', async () => {
  let registeredRoute = null
  const mockCtx = {
    inject: () => {},
    effect: (fn) => fn(),
    webServer: {
      register: (entry) => {
        if (entry?.path === '/dsh-image-gen/diagnostics/test') {
          registeredRoute = entry.handler
        }
      },
    },
    tools: { register: () => {} },
    credentials: { get: async () => null },
    logger: { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} },
  }

  const mockConfig = {
    provider: 'fal',
  }

  apply(mockCtx, mockConfig)
  assert.ok(registeredRoute, 'Diagnostics route should be registered')

  // Helper to simulate request
  const simulateReq = async ({ method, url = '/dsh-image-gen/diagnostics/test', body = null, remoteAddress = '127.0.0.1' }) => {
    let statusCode = null
    let responseData = null
    const buf = body !== null ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : Buffer.alloc(0)
    const req = Readable.from(buf.length > 0 ? [buf] : [])
    req.method = method
    req.url = url
    req.headers = { host: '127.0.0.1', 'content-length': String(buf.length) }
    req.socket = { remoteAddress }
    const res = {
      writeHead: (status) => { statusCode = status },
      end: (str) => {
        try {
          responseData = JSON.parse(str)
        } catch (_e) {
          responseData = str
        }
      },
    }
    await registeredRoute(req, res)
    return { statusCode, responseData }
  }

  // 1. GET with searchParams
  const getRes = await simulateReq({ method: 'GET', url: '/dsh-image-gen/diagnostics/test?provider=custom' })
  assert.equal(getRes.statusCode, 200)
  assert.equal(getRes.responseData.provider, 'custom')

  // 2. POST with JSON body (#419)
  const postRes = await simulateReq({
    method: 'POST',
    url: '/dsh-image-gen/diagnostics/test',
    body: { provider: 'replicate' },
  })
  assert.equal(postRes.statusCode, 200)
  assert.equal(postRes.responseData.provider, 'replicate', 'POST must parse provider from request body (#419)')

  // 3. POST with searchParams fallback
  const postParamRes = await simulateReq({
    method: 'POST',
    url: '/dsh-image-gen/diagnostics/test?provider=gemini',
    body: {},
  })
  assert.equal(postParamRes.statusCode, 200)
  assert.equal(postParamRes.responseData.provider, 'gemini')

  // 4. PUT returns 405 Method Not Allowed
  const putRes = await simulateReq({ method: 'PUT' })
  assert.equal(putRes.statusCode, 405)
  assert.equal(putRes.responseData.error, 'GET or POST only')

  // 5. DELETE returns 405 Method Not Allowed
  const delRes = await simulateReq({ method: 'DELETE' })
  assert.equal(delRes.statusCode, 405)

  // 6. Untrusted address returns 403 Forbidden for both GET and POST
  const untrustedGet = await simulateReq({ method: 'GET', remoteAddress: '8.8.8.8' })
  assert.equal(untrustedGet.statusCode, 403)
  const untrustedPost = await simulateReq({ method: 'POST', remoteAddress: '8.8.8.8', body: { provider: 'fal' } })
  assert.equal(untrustedPost.statusCode, 403)
})
