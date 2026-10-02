import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPresentationMeta } from '../lib/attachment-helper.js'

test('result cards (#378): buildPresentationMeta extracts all structured fields', () => {
  const meta = buildPresentationMeta({
    url: '/dsh-image-gen/image?id=sha256:123',
    path: '/generated/images/sample.png',
    width: 1024,
    height: 768,
    seed: 42,
    prompt: 'A cyberpunk city',
    provider: 'fal',
    model: 'flux-dev',
    attachment: {
      attachmentId: 'sha256:123',
      mediaType: 'image/png',
      width: 1024,
      height: 768,
      name: 'sample.png',
    },
    cells: [
      { id: 'A', style: 'anime', url: '/dsh-image-gen/image?id=sha256:A' },
      { id: 'B', style: 'cinematic', url: '/dsh-image-gen/image?id=sha256:B' },
      { id: 'C', style: 'sketch', url: '/dsh-image-gen/image?id=sha256:C' },
      { id: 'D', style: 'cyberpunk', url: '/dsh-image-gen/image?id=sha256:D' },
    ],
    light: { url: '/dsh-image-gen/image?id=sha256:light', path: '/light.png' },
    dark: { url: '/dsh-image-gen/image?id=sha256:dark', path: '/dark.png' },
    html_snippet: '<picture>...</picture>',
    css_snippet: ':root { ... }',
  })

  assert.equal(meta.url, '/dsh-image-gen/image?id=sha256:123')
  assert.equal(meta.attachmentId, 'sha256:123')
  assert.equal(meta.width, 1024)
  assert.equal(meta.cells.length, 4)
  assert.equal(meta.light.url, '/dsh-image-gen/image?id=sha256:light')
  assert.equal(meta.dark.url, '/dsh-image-gen/image?id=sha256:dark')
  assert.ok(meta.html_snippet)
})

test('result cards (#378): client readResult recovers relative URLs in link mode and presentationMeta', async () => {
  // Read the client bundled functions by importing or testing readResult behavior
  const { default: fs } = await import('node:fs/promises')
  const clientCode = await fs.readFile(
    new URL('../src/client/100-image-card.js', import.meta.url),
    'utf8'
  )

  // Extract readResult function implementation from client source
  const fnMatch = clientCode.match(/function readResult\(block\) \{([\s\S]*?)\n    \}/)
  assert.ok(fnMatch, 'readResult function found in 100-image-card.js')

  const readResult = new Function(
    'attachmentImageUrl',
    `const HTTP_IMAGE_URL_RE = /https?:\\/\\/[^\\s)]+\\.(png|jpg|jpeg|webp|gif)(\\?[^\\s)]*)?/i;
     const RELATIVE_IMAGE_URL_RE = /(\\/dsh-image-gen\\/image\\?[^\\s)"'<>]+)/i;
     const MARKDOWN_IMAGE_RE = /!\\[.*?\\]\\(((\\/|https?:\\/\\/)[^\\s)]+)\\)/i;
     const MARKDOWN_LINK_RE = /\\[.*?\\]\\(((\\/|https?:\\/\\/)[^\\s)]+)\\)/i;
     return function readResult(block) { ${fnMatch[1]} };`
  )(() => '')

  // 1. Relative URL in link mode text
  const linkBlock = {
    output: 'Generated image:\n/dsh-image-gen/image?id=sha256:abc123def&mt=image%2Fpng&w=1024&h=768',
  }
  const parsedLink = readResult(linkBlock)
  assert.equal(
    parsedLink.url,
    '/dsh-image-gen/image?id=sha256:abc123def&mt=image%2Fpng&w=1024&h=768',
    'Relative URL without file extension must be extracted'
  )

  // 2. Markdown image link with relative URL
  const mdBlock = {
    text: 'Check this out:\n![Generated Image](/dsh-image-gen/image?id=sha256:xyz789)',
  }
  const parsedMd = readResult(mdBlock)
  assert.equal(parsedMd.url, '/dsh-image-gen/image?id=sha256:xyz789')
  assert.equal(parsedMd.text, 'Check this out:')

  // 3. Structured presentationMeta
  const metaBlock = {
    output: 'Image generated',
    presentationMeta: {
      url: '/dsh-image-gen/image?id=sha256:from_meta',
      attachment: {
        attachmentId: 'sha256:from_meta',
        mediaType: 'image/png',
        width: 800,
        height: 600,
      },
    },
  }
  const parsedMeta = readResult(metaBlock)
  assert.equal(parsedMeta.url, '/dsh-image-gen/image?id=sha256:from_meta')
  assert.equal(parsedMeta.attachment?.attachmentId, 'sha256:from_meta')

  // 4. Error block handles safely
  const errorBlock = {
    isError: true,
    error: 'API rate limit exceeded',
    output: 'Error occurred',
  }
  const parsedErr = readResult(errorBlock)
  assert.equal(parsedErr.url, '')
  assert.equal(parsedErr.attachment, null)
})

test('result cards (#378): Style Matrix and Theme Pair presentation recovery', async () => {
  const { default: fs } = await import('node:fs/promises')
  const smCode = await fs.readFile(
    new URL('../src/client/106-style-matrix-view.js', import.meta.url),
    'utf8'
  )
  const tpCode = await fs.readFile(
    new URL('../src/client/107-theme-pair-view.js', import.meta.url),
    'utf8'
  )

  // Verify presentationMeta and tag fallbacks are handled in client code
  assert.ok(smCode.includes('presentationMeta'), 'Style matrix view inspects presentationMeta')
  assert.ok(smCode.includes('<dsh-image-gen-matrix>'), 'Style matrix view supports fallback tag')

  assert.ok(tpCode.includes('presentationMeta'), 'Theme pair view inspects presentationMeta')
  assert.ok(tpCode.includes('<dsh-image-gen-theme-pair>'), 'Theme pair view supports fallback tag')
})
