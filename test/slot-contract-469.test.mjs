import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

test('RC2 Slot Registry Contract (#469): plugins.item list slot requires options.id and plugins.row.config requires options.key', () => {
  const clientPath = path.join(rootDir, 'lib', 'client.js')
  const clientCode = readFileSync(clientPath, 'utf8')

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
    fetch: async () => ({
      ok: true,
      json: async () => ({ ok: true, config: {} }),
    }),
    console: {
      ...console,
      warn: (...args) => {
        // Fail test if slot registration fails with options.id warning/error
        const msg = args.join(' ')
        if (msg.includes('Slot err plugins.item') || msg.includes('requires options.id')) {
          assert.fail(`Slot registration error intercepted: ${msg}`)
        }
      },
    },
  })

  vm.runInContext(clientCode, context)
  assert.ok(loadedModule, 'ModuleLoader must capture module')

  const mockRequire = (id) => {
    if (id === 'react') {
      return {
        createElement: (comp, props, ...children) => ({ comp, props, children }),
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
  assert.ok(moduleExports && typeof moduleExports.apply === 'function', 'Factory must return apply()')

  // Strict DSH 0.2.1-rc.2 slot registry simulator
  const registeredSlots = new Map()
  const listSlots = new Set(['plugins.item', 'conversation.session.header.utilities'])
  const keyedSlots = new Set(['plugins.row.config', 'tool.call.toolview', 'sidebar.right.pane.tab'])

  const strictSlots = {
    inject: (name, cb) => {
      // Immediate injection execution
      cb()
    },
    register: (options, component) => {
      assert.ok(options && typeof options === 'object', 'Slot options must be object')
      assert.ok(options.name, 'Slot options must have name')

      // Strict RC2 list slot contract: options.id is required
      if (listSlots.has(options.name)) {
        if (!options.id || typeof options.id !== 'string') {
          throw new Error(`list slot "${options.name}" requires options.id.`)
        }
      }

      // Keyed slot contract: options.key is required
      if (keyedSlots.has(options.name)) {
        if (!options.key || typeof options.key !== 'string') {
          throw new Error(`keyed slot "${options.name}" requires options.key.`)
        }
      }

      const key = `${options.name}:${options.id || options.key || 'default'}`
      registeredSlots.set(key, { options, component })
      return () => registeredSlots.delete(key)
    },
  }

  const mockCtx = {
    locale: { define: () => {}, register: () => {} },
    sessions: {},
    slots: strictSlots,
  }

  // Execute plugin client mount
  moduleExports.apply(mockCtx)

  // 1. Verify plugins.item registration
  const itemSlot = registeredSlots.get('plugins.item:dsh-image-gen')
  assert.ok(itemSlot, 'plugins.item slot must be registered successfully with id dsh-image-gen')
  assert.equal(itemSlot.options.name, 'plugins.item')
  assert.equal(itemSlot.options.id, 'dsh-image-gen', 'plugins.item MUST specify id')
  assert.equal(itemSlot.options.key, 'dsh-image-gen')
  assert.equal(typeof itemSlot.options.label, 'function', 'plugins.item must declare label function')
  assert.equal(itemSlot.options.label(), 'Image Generation')

  // 2. Verify plugins.row.config registration
  const rowConfigSlot = registeredSlots.get('plugins.row.config:dsh-image-gen')
  assert.ok(rowConfigSlot, 'plugins.row.config slot must be registered successfully with key dsh-image-gen')
  assert.equal(rowConfigSlot.options.name, 'plugins.row.config')
  assert.equal(rowConfigSlot.options.key, 'dsh-image-gen')

  // 3. Negative check: verify that our strict registry actually enforces list slot id requirement
  assert.throws(
    () => {
      strictSlots.register({ name: 'plugins.item', key: 'dsh-image-gen' }, () => {})
    },
    /list slot "plugins.item" requires options.id/,
    'Strict registry must reject list slot without options.id'
  )
})
