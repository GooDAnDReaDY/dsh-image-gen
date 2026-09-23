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
    configForms: { get: () => mockScope,
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

test('lib/client.js inject supports both DSH 0.1.5-rc.3 (settingsScope) and 0.1.6+ (configForms) (#291, GitHub #3)', () => {
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

  // 1. Verify exports.inject has slots, locale, sessions and neither configForms nor settingsScope
  assert.ok(Array.isArray(moduleExports.inject), 'exports.inject must be an array')
  assert.ok(moduleExports.inject.includes('slots'), 'must inject slots')
  assert.ok(moduleExports.inject.includes('locale'), 'must inject locale')
  assert.ok(moduleExports.inject.includes('sessions'), 'must inject sessions')
  assert.ok(!moduleExports.inject.includes('configForms'), 'must NOT declare configForms in inject (causes hard block on 0.1.5-rc.3)')
  assert.ok(!moduleExports.inject.includes('settingsScope'), 'must NOT declare settingsScope in inject (causes hard block on 0.1.6+)')

  // 2. Test compatibility with DSH 0.1.5-rc.3 host (settingsScope only)
  {
    let registeredItem = null
    let mockValues = { provider: 'fal', defaultModel: 'flux-schnell' }
    const mockScope = {
      getSnapshot: () => ({ status: 'ready', writable: true, value: mockValues }),
      set: (k, v) => { mockValues[k] = v },
      delete: (k) => { delete mockValues[k] },
      subscribe: (cb) => () => {},
    }
    const mockCtx015 = {
      locale: { define: () => {} },
      settingsScope: {
        bind: ({ namespace }) => {
          assert.equal(namespace, 'dsh-image-gen')
          return mockScope
        },
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

    moduleExports.apply(mockCtx015)
    assert.ok(registeredItem, '0.1.5: Should have registered settings.plugin.item slot')
    assert.ok(registeredItem.injected, '0.1.5: Slot should have injected card controller')
    const store = registeredItem.injected.hooks.falSettingsCard
    assert.ok(store, '0.1.5: Should have falSettingsCard store')
    const snap = store.getSnapshot()
    assert.equal(snap.provider.text, 'fal')
  }

  // 3. Test compatibility with DSH 0.1.6+ host (configForms only)
  {
    let registeredItem = null
    let mockValues = { provider: 'custom', defaultModel: 'my-custom-model' }
    const mockScope = {
      getSnapshot: () => ({ status: 'ready', writable: true, value: mockValues }),
      set: (k, v) => { mockValues[k] = v },
      delete: (k) => { delete mockValues[k] },
      subscribe: (cb) => () => {},
    }
    const mockCtx016 = {
      locale: { define: () => {} },
      configForms: {
        get: (namespace) => {
          assert.equal(namespace, 'dsh-image-gen')
          return mockScope
        },
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

    moduleExports.apply(mockCtx016)
    assert.ok(registeredItem, '0.1.6+: Should have registered settings.plugin.item slot')
    assert.ok(registeredItem.injected, '0.1.6+: Slot should have injected card controller')
    const store = registeredItem.injected.hooks.falSettingsCard
    assert.ok(store, '0.1.6+: Should have falSettingsCard store')
    const snap = store.getSnapshot()
    assert.equal(snap.provider.text, 'custom')
  }

  // 4. Test async resolution via ctx.inject
  {
    let registeredItem = null
    let injectCallbacks = {}
    let mockValues = { provider: 'seedart' }
    const mockScope = {
      getSnapshot: () => ({ status: 'ready', writable: true, value: mockValues }),
      set: (k, v) => { mockValues[k] = v },
      delete: (k) => { delete mockValues[k] },
      subscribe: (cb) => () => {},
    }
    const mockCtxAsync = {
      locale: { define: () => {} },
      inject: (deps, cb) => {
        injectCallbacks[deps[0]] = cb
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

    moduleExports.apply(mockCtxAsync)
    assert.ok(registeredItem, 'Async: Should register slot')
    const store = registeredItem.injected.hooks.falSettingsCard

    // Initially scope has no host service yet
    const snapInitial = store.getSnapshot()
    assert.ok(snapInitial, 'Should have initial fallback snapshot')

    // Simulate configForms becoming available later via Cordis inject
    if (injectCallbacks['configForms']) {
      injectCallbacks['configForms']({
        configForms: {
          get: (ns) => mockScope,
        },
      })
    }
    const snapAfter = store.getSnapshot()
    assert.equal(snapAfter.provider.text, 'seedart')
  }
})
