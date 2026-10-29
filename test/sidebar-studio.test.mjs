// test/sidebar-studio.test.mjs — Tests for Issue #452 (Standalone Image Studio workspace panel in DSH right sidebar)

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.join(__dirname, '..', 'lib', 'client.js')
const injectPath = path.join(__dirname, '..', 'src', 'client', '130-inject.js')
const studioPath = path.join(__dirname, '..', 'src', 'client', '150-image-studio.js')
const cssPath = path.join(__dirname, '..', 'src', 'client', '10-css.js')

test('sidebar-studio: source files exist and define SidebarImageStudio (#452)', () => {
  assert.ok(fs.existsSync(studioPath), '150-image-studio.js must exist')
  assert.ok(fs.existsSync(injectPath), '130-inject.js must exist')
  assert.ok(fs.existsSync(clientPath), 'lib/client.js must exist')

  const studioCode = fs.readFileSync(studioPath, 'utf8')
  assert.ok(studioCode.includes('function SidebarImageStudio'), 'Must define SidebarImageStudio')
  assert.ok(studioCode.includes('function ImageStudioView'), 'Must define ImageStudioView')
})

test('sidebar-studio: registers native sidebarRightTabs and sidebar.right.pane.tab with dsh-image-studio (#452)', () => {
  const injectCode = fs.readFileSync(injectPath, 'utf8')

  // sidebarRightTabs injection
  assert.ok(injectCode.includes("ctx.inject(['sidebarRightTabs']"), 'Must inject sidebarRightTabs')
  assert.ok(injectCode.includes("id: 'dsh-image-studio'"), 'Must register sidebarRightTabs with id dsh-image-studio')

  // sidebar.right.pane.tab slot registration
  assert.ok(injectCode.includes("name: 'sidebar.right.pane.tab'"), 'Must register slot sidebar.right.pane.tab')
  assert.ok(injectCode.includes("key: 'dsh-image-studio'"), 'Must register slot key dsh-image-studio')
  assert.ok(injectCode.includes('SidebarImageStudio'), 'Slot must render SidebarImageStudio')

  // betterSidebar fallback
  assert.ok(injectCode.includes("ctx.inject(['betterSidebar']"), 'Must inject betterSidebar fallback')
})

test('sidebar-studio: SidebarImageStudio component defines required controls and actions (#452)', () => {
  const studioCode = fs.readFileSync(studioPath, 'utf8')

  // Prompt and negative prompt
  assert.ok(studioCode.includes('updatePrompt'), 'Must support prompt editing')
  assert.ok(studioCode.includes('updateNegativePrompt'), 'Must support negative prompt editing')
  assert.ok(studioCode.includes('styleTags'), 'Must define style auto-completion tags')
  assert.ok(studioCode.includes('exclusionTags'), 'Must define negative prompt exclusion tags')

  // Provider, model, aspect ratio, transparent background
  assert.ok(studioCode.includes('providerModels'), 'Must define provider models map')
  assert.ok(studioCode.includes('transparentBg'), 'Must support transparent background toggle')
  assert.ok(studioCode.includes('aspectRatio'), 'Must support aspect ratio selection')

  // Recent grid & action buttons
  assert.ok(studioCode.includes('/dsh-image-gen/vault?limit=12'), 'Must fetch recent generations from vault')
  assert.ok(studioCode.includes('handleCopyPath'), 'Must implement Copy Path action')
  assert.ok(studioCode.includes('handleInsertToChat'), 'Must implement Insert to Chat action')
  assert.ok(studioCode.includes('handleGenerateCommand'), 'Must implement Generate Command action')
})

test('sidebar-studio: CSS stylesheet includes dedicated sidebar studio rules (#452)', () => {
  const cssCode = fs.readFileSync(cssPath, 'utf8')
  assert.ok(cssCode.includes('.ig-sidebar-studio'), 'CSS must declare .ig-sidebar-studio')
  assert.ok(cssCode.includes('.ig-chip-group'), 'CSS must declare .ig-chip-group')
  assert.ok(cssCode.includes('.ig-sidebar-grid'), 'CSS must declare .ig-sidebar-grid')
  assert.ok(cssCode.includes('.ig-sidebar-thumb'), 'CSS must declare .ig-sidebar-thumb')
  assert.ok(cssCode.includes('.ig-sidebar-actions'), 'CSS must declare .ig-sidebar-actions')
})

test('sidebar-studio: client bundle is updated and contains SidebarImageStudio', () => {
  const clientCode = fs.readFileSync(clientPath, 'utf8')
  assert.ok(clientCode.includes('SidebarImageStudio'), 'lib/client.js must include SidebarImageStudio')
  assert.ok(clientCode.includes("id: 'dsh-image-studio'"), 'lib/client.js must include dsh-image-studio id')
  assert.ok(clientCode.includes("key: 'dsh-image-studio'"), 'lib/client.js must include dsh-image-studio key')
})

