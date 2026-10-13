import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  formatDesignExportPayload,
  pushAssetToOpenDesignProject,
} from '../lib/design-export.js'

test('design-export (#446): formatDesignExportPayload generates PNG snippets', () => {
  const dummyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02])
  const result = formatDesignExportPayload({
    buffer: dummyPng,
    mimeType: 'image/png',
    name: 'hero-banner',
    width: 1200,
    height: 630,
  })

  assert.equal(result.name, 'hero-banner')
  assert.equal(result.isSvg, false)
  assert.equal(result.width, 1200)
  assert.equal(result.height, 630)
  assert.ok(result.dataUrl.startsWith('data:image/png;base64,'))
  assert.ok(result.figmaHtml.includes('<img src="data:image/png;base64,'))
  assert.ok(result.figmaHtml.includes('width="1200"'))
  assert.ok(result.penpotSnippet.includes('<svg xmlns="http://www.w3.org/2000/svg"'))
  assert.ok(result.penpotSnippet.includes('<image href="data:image/png;base64,'))
  assert.ok(result.cssBackground.includes('background-image: url("data:image/png;base64,'))
})

test('design-export (#446): formatDesignExportPayload generates direct SVG markup', () => {
  const dummySvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/></svg>')
  const result = formatDesignExportPayload({
    buffer: dummySvg,
    mimeType: 'image/svg+xml',
    name: 'icon-star',
    width: 100,
    height: 100,
  })

  assert.equal(result.name, 'icon-star')
  assert.equal(result.isSvg, true)
  assert.ok(result.svgMarkup.includes('<circle cx="50" cy="50" r="40" fill="red"/>'))
  assert.equal(result.figmaHtml, result.svgMarkup, 'Figma HTML for SVG must be raw SVG markup')
  assert.equal(result.penpotSnippet, result.svgMarkup, 'Penpot snippet for SVG must be raw SVG markup')
})

test('design-export (#446): pushAssetToOpenDesignProject writes file into project folder', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'od-test-projects-'))
  const projectId = 'test-proj-446'
  const projectFolder = path.join(tempDir, projectId)
  await fs.mkdir(projectFolder, { recursive: true })

  const fileData = Buffer.from('test-image-content-bytes')
  const res = await pushAssetToOpenDesignProject({
    buffer: fileData,
    filename: 'mock-hero.png',
    projectId,
    openDesignRoot: tempDir,
  })

  assert.equal(res.ok, true)
  assert.equal(res.filename, 'mock-hero.png')
  assert.equal(res.projectId, projectId)
  assert.ok(res.savedPath.includes('mock-hero.png'))

  const written = await fs.readFile(res.savedPath)
  assert.deepEqual(written, fileData)

  // Cleanup
  await fs.rm(tempDir, { recursive: true, force: true })
})

test('design-export (#446): pushAssetToOpenDesignProject handles missing project gracefully', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'od-test-projects-'))
  const res = await pushAssetToOpenDesignProject({
    buffer: Buffer.from('abc'),
    filename: 'mock.png',
    projectId: 'non-existent-proj',
    openDesignRoot: tempDir,
  })

  assert.equal(res.ok, false)
  assert.ok(res.error.includes('OpenDesign project not found on disk'))

  await fs.rm(tempDir, { recursive: true, force: true })
})
