import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

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

test('lib/client.js CardForm store provides referentially stable getSnapshot (#230 React error 185 fix)', () => {
  const clientPath = path.join(rootDir, 'lib', 'client.js')
  const content = readFileSync(clientPath, 'utf8')

  let loadedModule = null
  const context = vm.createContext({
    window: {
      __ModuleLoader__: {
        load: (entry) => {
          loadedModule = entry
        },
      },
    },
    document: {
      head: { appendChild: () => {} },
      createElement: () => ({ setAttribute: () => {}, appendChild: () => {} }),
    },
    console,
  })

  vm.runInContext(content, context)
  assert.ok(loadedModule, 'Module should register with __ModuleLoader__')

  const mockRequire = (id) => {
    if (id === 'react') {
      return {
        createElement: () => ({}),
        useState: (init) => [init, () => {}],
        useEffect: () => {},
      }
    }
    if (id === 'react/jsx-runtime') {
      return { jsx: () => ({}), jsxs: () => ({}) }
    }
    throw new Error(`Cannot find module '${id}'`)
  }

  const moduleExports = loadedModule.factory(mockRequire)
  assert.ok(moduleExports && typeof moduleExports.apply === 'function', 'Factory must return module with apply()')

  let registeredItem = null
  const mockScope = {
    getSnapshot: () => ({ status: 'ready', writable: true, value: { provider: 'fal' } }),
    subscribe: () => () => {},
  }
  const mockCtx = {
    locale: { define: () => {} },
    settingsScope: {
      bind: () => mockScope,
    },
    slots: {
      inject: (name, cb) => cb(),
      register: (desc, comp) => {
        if (desc.name === 'settings.plugin.item') {
          registeredItem = { desc, comp, injected: desc.inject ? desc.inject() : null }
        }
      },
    },
  }

  moduleExports.apply(mockCtx)
  assert.ok(registeredItem, 'Should have registered settings.plugin.item slot')
  assert.ok(registeredItem.injected, 'Slot should have injected card controller')
  const store = registeredItem.injected.hooks.falSettingsCard
  assert.ok(store, 'Should have falSettingsCard store')
  assert.equal(typeof store.getSnapshot, 'function')
  assert.equal(typeof store.subscribe, 'function')

  // 1. Referential stability: consecutive calls must return EXACTLY the same object reference
  const snap1 = store.getSnapshot()
  const snap2 = store.getSnapshot()
  assert.strictEqual(snap1, snap2, 'consecutive getSnapshot() calls must be referentially identical (Object.is)')

  // 2. Notification & snapshot update on mutation
  let notified = 0
  const unsubscribe = store.subscribe(() => {
    notified++
  })

  // Trigger edit action
  registeredItem.injected.edit('provider', 'custom')
  assert.equal(notified, 1, 'Subscriber should be notified on edit')

  const snap3 = store.getSnapshot()
  assert.notStrictEqual(snap1, snap3, 'getSnapshot() after edit should return new snapshot')
  const snap4 = store.getSnapshot()
  assert.strictEqual(snap3, snap4, 'consecutive getSnapshot() after edit must be referentially identical')
  assert.equal(snap3.provider.text, 'custom')

  // Trigger discard action
  registeredItem.injected.discard()
  assert.equal(notified, 2, 'Subscriber should be notified on discard')
  const snap5 = store.getSnapshot()
  assert.notStrictEqual(snap3, snap5, 'getSnapshot() after discard should return new snapshot')
  assert.equal(snap5.provider.text, 'fal')

  unsubscribe()
  registeredItem.injected.edit('provider', 'seedart')
  assert.equal(notified, 2, 'Unsubscribed listener must not be called')
})
