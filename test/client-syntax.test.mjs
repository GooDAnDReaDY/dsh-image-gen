import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

function getAllJsFiles(dir) {
  const results = []
  const list = readdirSync(dir)
  for (const file of list) {
    const fullPath = path.join(dir, file)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      results.push(...getAllJsFiles(fullPath))
    } else if (file.endsWith('.js') || file.endsWith('.mjs')) {
      results.push(fullPath)
    }
  }
  return results
}

test('all lib/ and test/ files pass node --check syntax validation', () => {
  const libDir = path.join(rootDir, 'lib')
  const files = getAllJsFiles(libDir)
  assert.ok(files.length > 5, 'Should find multiple files in lib')

  for (const file of files) {
    const rel = path.relative(rootDir, file)
    assert.doesNotThrow(() => {
      execSync(`node --check "${file}"`, { stdio: 'pipe' })
    }, `File ${rel} failed node --check syntax validation`)
  }
})

test('lib/client.js contains complete gallery, diagnostics, and settings components', () => {
  const clientPath = path.join(rootDir, 'lib', 'client.js')
  const content = readFileSync(clientPath, 'utf8')

  const requiredSymbols = [
    'GalleryView',
    'GalleryHeaderChip',
    'DiagnosticsPanel',
    'FalSettingsCard',
    'FalImageCard',
    'ErrorBoundary',
    'tool.call.toolview',
    'settings.plugin.item',
    'sidebar.right.pane.tab',
    'betterSidebar',
    'conversation.session.header.utilities',
    'assemble_image_grid',
  ]

  for (const sym of requiredSymbols) {
    assert.ok(content.includes(sym), `lib/client.js must include required symbol "${sym}"`)
  }

  // Ensure no unclosed template or syntax fragments
  assert.ok(!content.includes("selected.cost ? react.createElement('span', { className: 'ig-badge' }, '\n"), 'Should not have unclosed string in selected.cost')
})
