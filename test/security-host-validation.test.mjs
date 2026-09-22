import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  isLoopbackAddress,
  isPrivateLanAddress,
  extractHostName,
  isTrustedLocalRequest,
} from '../lib/security.js'
import { isTrustedUpdateRequest } from '../lib/updater.js'

test('security: isLoopbackAddress validates strict loopback and rejects rebinding domains', () => {
  // Valid loopback
  assert.equal(isLoopbackAddress('localhost'), true)
  assert.equal(isLoopbackAddress('localhost.'), true)
  assert.equal(isLoopbackAddress('app.localhost'), true)
  assert.equal(isLoopbackAddress('sub.app.localhost'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('[::1]'), true)
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('127.0.0.2'), true)
  assert.equal(isLoopbackAddress('127.255.255.254'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)

  // Malicious rebinding and prefix bypass attempts (Refs: GitHub #1, #280)
  assert.equal(isLoopbackAddress('127.0.0.1.evil.com'), false)
  assert.equal(isLoopbackAddress('127.evil.com'), false)
  assert.equal(isLoopbackAddress('127.0.0.1.nip.io'), false)
  assert.equal(isLoopbackAddress('localhost.evil.com'), false)
  assert.equal(isLoopbackAddress('notlocalhost'), false)
  assert.equal(isLoopbackAddress('127.0.0.256'), false)
  assert.equal(isLoopbackAddress('127.0.0.-1'), false)
  assert.equal(isLoopbackAddress('192.168.1.1'), false)
  assert.equal(isLoopbackAddress('8.8.8.8'), false)
  assert.equal(isLoopbackAddress(''), false)
  assert.equal(isLoopbackAddress(null), false)
  assert.equal(isLoopbackAddress(undefined), false)
})

test('security: isPrivateLanAddress validates RFC 1918 / ULA and rejects rebinding domains', () => {
  // Valid RFC 1918 & link-local & ULA
  assert.equal(isPrivateLanAddress('10.0.0.1'), true)
  assert.equal(isPrivateLanAddress('10.255.255.255'), true)
  assert.equal(isPrivateLanAddress('172.16.0.1'), true)
  assert.equal(isPrivateLanAddress('172.31.255.254'), true)
  assert.equal(isPrivateLanAddress('192.168.0.1'), true)
  assert.equal(isPrivateLanAddress('192.168.1.100'), true)
  assert.equal(isPrivateLanAddress('169.254.1.1'), true)
  assert.equal(isPrivateLanAddress('::ffff:192.168.1.1'), true)
  assert.equal(isPrivateLanAddress('fc00::1'), true)
  assert.equal(isPrivateLanAddress('fd12:3456:789a::1'), true)
  assert.equal(isPrivateLanAddress('fe80::1'), true)

  // Malicious prefix and DNS rebinding attacks (Refs: GitHub #1, #280)
  assert.equal(isPrivateLanAddress('10.evil.com'), false)
  assert.equal(isPrivateLanAddress('192.168.evil.com'), false)
  assert.equal(isPrivateLanAddress('172.16.evil.com'), false)
  assert.equal(isPrivateLanAddress('10.0.0.1.nip.io'), false)
  assert.equal(isPrivateLanAddress('192.168.1.100.nip.io'), false)
  assert.equal(isPrivateLanAddress('172.32.0.1'), false) // outside 172.16.0.0/12
  assert.equal(isPrivateLanAddress('172.15.255.255'), false)
  assert.equal(isPrivateLanAddress('11.0.0.1'), false)
  assert.equal(isPrivateLanAddress('1.1.1.1'), false)
  assert.equal(isPrivateLanAddress('8.8.8.8'), false)
  assert.equal(isPrivateLanAddress(''), false)
  assert.equal(isPrivateLanAddress(null), false)
  assert.equal(isPrivateLanAddress(undefined), false)
})

test('security: extractHostName strips ports and IPv6 brackets safely', () => {
  assert.equal(extractHostName('127.0.0.1:3080'), '127.0.0.1')
  assert.equal(extractHostName('localhost:3000'), 'localhost')
  assert.equal(extractHostName('192.168.1.111:3080'), '192.168.1.111')
  assert.equal(extractHostName('[::1]:3080'), '::1')
  assert.equal(extractHostName('[::1]'), '::1')
  assert.equal(extractHostName('10.evil.com:80'), '10.evil.com')
  assert.equal(extractHostName(''), '')
  assert.equal(extractHostName(null), '')
})

test('security: isTrustedLocalRequest enforces trusted authorities and blocks cross-site attacks', () => {
  // Valid local requests
  assert.equal(isTrustedLocalRequest({
    headers: { host: 'localhost:3080' },
    socket: { remoteAddress: '127.0.0.1' },
  }), true)

  assert.equal(isTrustedLocalRequest({
    headers: {
      host: '192.168.1.111:3080',
      origin: 'http://192.168.1.111:3080',
      'sec-fetch-site': 'same-origin',
    },
    socket: { remoteAddress: '192.168.1.50' },
  }), true)

  // Attack 1: Cross-site fetch (Sec-Fetch-Site: cross-site)
  assert.equal(isTrustedLocalRequest({
    headers: {
      host: 'localhost:3080',
      'sec-fetch-site': 'cross-site',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }), false)

  // Attack 2: DNS rebinding with 10.evil.com Host header
  assert.equal(isTrustedLocalRequest({
    headers: {
      host: '10.evil.com:3080',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }), false)

  // Attack 3: DNS rebinding with 127.0.0.1.evil.com Host header
  assert.equal(isTrustedLocalRequest({
    headers: {
      host: '127.0.0.1.evil.com:3080',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }), false)

  // Attack 4: Public remote IP address (direct external probe)
  assert.equal(isTrustedLocalRequest({
    headers: {
      host: 'localhost:3080',
    },
    socket: { remoteAddress: '93.184.216.34' },
  }), false)

  // Attack 5: Cross-origin Origin header
  assert.equal(isTrustedLocalRequest({
    headers: {
      host: 'localhost:3080',
      origin: 'https://evil.com',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }), false)

  // Attack 6: Origin host mismatch against Host header
  assert.equal(isTrustedLocalRequest({
    headers: {
      host: '192.168.1.111:3080',
      origin: 'http://192.168.1.200:3080',
    },
    socket: { remoteAddress: '192.168.1.111' },
  }), false)

  // Attack 7: External Referer header
  assert.equal(isTrustedLocalRequest({
    headers: {
      host: 'localhost:3080',
      referer: 'https://malicious-site.org/exploit.html',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }), false)

  // Missing host header
  assert.equal(isTrustedLocalRequest({
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  }), false)
})

test('updater: isTrustedUpdateRequest rejects DNS-rebinding hostname attacks', () => {
  // Malicious 10.evil.com bypass attempt
  assert.equal(isTrustedUpdateRequest({
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      'x-dsh-plugin-update': '1',
      host: '10.evil.com:3000',
      origin: 'http://10.evil.com:3000',
      'sec-fetch-site': 'same-origin',
    },
  }), false)

  // Malicious 127.0.0.1.evil.com bypass attempt
  assert.equal(isTrustedUpdateRequest({
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      'x-dsh-plugin-update': '1',
      host: '127.0.0.1.evil.com:3000',
      origin: 'http://127.0.0.1.evil.com:3000',
      'sec-fetch-site': 'same-origin',
    },
  }), false)

  // Legitimate LAN update request
  assert.equal(isTrustedUpdateRequest({
    socket: { remoteAddress: '192.168.1.50' },
    headers: {
      'x-dsh-plugin-update': '1',
      host: '192.168.1.111:3080',
      origin: 'http://192.168.1.111:3080',
      'sec-fetch-site': 'same-origin',
    },
  }), true)
})

test('routes: lib/index.js binds isTrustedLocalRequest guards and sanitizes history (#280, #276, #277)', () => {
  const indexSource = fs.readFileSync('lib/index.js', 'utf8')

  // 1. Guard imported
  assert.ok(indexSource.includes('isTrustedLocalRequest'), 'index.js must import and use isTrustedLocalRequest')

  // 2. /dsh-image-gen/image route guarded
  assert.ok(
    indexSource.includes('imageHandler =') && indexSource.includes('if (!isTrustedLocalRequest(req))'),
    'imageHandler must enforce isTrustedLocalRequest'
  )

  // 3. /dsh-image-gen/diagnostics/test guarded (#277)
  const diagSection = indexSource.slice(indexSource.indexOf('/dsh-image-gen/diagnostics/test'))
  assert.ok(
    diagSection.includes('if (!isTrustedLocalRequest(req))'),
    'diagnostics/test route must enforce isTrustedLocalRequest'
  )

  // 4. /dsh-image-gen/history guarded and path stripped (#276)
  const histSection = indexSource.slice(indexSource.indexOf('/dsh-image-gen/history'))
  assert.ok(
    histSection.includes('if (!isTrustedLocalRequest(req))'),
    'history route must enforce isTrustedLocalRequest'
  )
  assert.ok(
    histSection.includes('path: _discardPath') || histSection.includes('delete safeEntry.path'),
    'history route must strip server local filesystem path from output'
  )

  // 5. Verification of path sanitization behavior
  const mockRawEntries = [
    { prompt: 'A cute cat', attachmentId: 'sha256:123', path: '/home/user/workspace/cat.png', width: 512, height: 512 },
    { prompt: 'Mountain sunset', path: '/var/data/private/sunset.png', width: 1024, height: 768 },
  ]
  const sanitized = mockRawEntries.map((e) => {
    const { path: _discardPath, ...safeEntry } = e
    return {
      ...safeEntry,
      thumbnailUrl: e.attachmentId ? `/dsh-image-gen/image?id=${encodeURIComponent(e.attachmentId)}` : '',
    }
  })

  assert.equal(sanitized.length, 2)
  assert.equal(sanitized[0].path, undefined)
  assert.equal(sanitized[1].path, undefined)
  assert.equal(sanitized[0].prompt, 'A cute cat')
  assert.equal(sanitized[0].thumbnailUrl, '/dsh-image-gen/image?id=sha256%3A123')
})
