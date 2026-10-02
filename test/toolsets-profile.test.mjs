import { registerImageCommand } from '../lib/commands.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerAllTools } from '../lib/register-tools.js'

function getRegisteredTools(config = {}) {
  const tools = []
  const ctx = {
    effect(fn) {
      fn()
    },
    tools: {
      register(def) {
        tools.push(def)
      },
    },
  }
  registerAllTools(ctx, {
    config,
    live: () => config,
    saveAndAttachResult: () => {},
    resolveSource: () => {},
    slugify: () => {},
    resolveApiKey: () => {},
  })
  return tools
}

test('toolsets profile: default minimal mode registers <= 3 core tools with schema <= 5k chars (#337)', () => {
  const tools = getRegisteredTools({})
  assert.equal(tools.length, 3, 'Minimal profile must register exactly 3 core tools')

  const names = tools.map((t) => t.name).sort()
  assert.deepEqual(names, ['edit_image', 'generate_image', 'inspect_image_quality'])

  let totalChars = 0
  for (const t of tools) {
    assert.ok(t.name, 'Tool must have a name')
    assert.ok(t.description, `Tool ${t.name} must have a description`)
    assert.ok(t.parameters, `Tool ${t.name} must have parameters`)
    const schemaStr = JSON.stringify({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })
    totalChars += schemaStr.length
  }

  assert.ok(
    totalChars <= 5000,
    `Total schema chars in minimal mode must be <= 5000 (got ${totalChars}) to save ~8k prompt tokens`,
  )
})

test('toolsets profile: "all" profile registers all 30 tools (#337)', () => {
  const tools = getRegisteredTools({ toolsetProfile: 'all' })
  assert.equal(tools.length, 30, '"all" profile must register all 30 tools')
})

test('toolsets profile: custom mode with nested toolsets toggles individual categories (#337)', () => {
  const designOnly = getRegisteredTools({
    toolsetProfile: 'custom',
    toolsets: { design: true },
  })
  // 3 core + 6 design (set_style_anchor, generate_ui_asset, generate_style_matrix, generate_theme_pair, generate_character_sheet, beautify_diagram) = 9
  assert.equal(designOnly.length, 9)
  const names = designOnly.map((t) => t.name)
  assert.ok(names.includes('set_style_anchor'))
  assert.ok(names.includes('generate_ui_asset'))
  assert.ok(names.includes('generate_style_matrix'))
  assert.ok(names.includes('generate_theme_pair'))
  assert.ok(names.includes('generate_character_sheet'))
  assert.ok(names.includes('beautify_diagram'))
  assert.ok(!names.includes('sketch_to_image'))
  assert.ok(!names.includes('remove_background'))
})

test('toolsets profile: custom mode with flat boolean keys (#337)', () => {
  const frontendOnly = getRegisteredTools({
    toolsetProfile: 'custom',
    toolsetFrontend: true,
  })
  // 3 core + 5 frontend + 1 responsive = 9
  assert.equal(frontendOnly.length, 9)
  const names = frontendOnly.map((t) => t.name)
  assert.ok(names.includes('extract_design_tokens'))
  assert.ok(names.includes('generate_responsive_mockups'))
  assert.ok(!names.includes('generate_spritesheet'))
})

test('master switch: all 30 tools reject with disabled error when cfg.enabled is false (#356)', async () => {
  let liveConfig = {
    enabled: false,
    toolsetProfile: 'all',
  }

  const tools = []
  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) { tools.push(def) },
    },
  }

  registerAllTools(ctx, {
    config: liveConfig,
    live: () => liveConfig,
    saveAndAttachResult: () => {},
    resolveSource: () => {},
    slugify: () => {},
    resolveApiKey: () => {},
  })

  assert.equal(tools.length, 30, 'Profile all must register 30 tools')

  // When enabled is false, executing any tool must reject with disabled message
  for (const t of tools) {
    if (typeof t.execute === 'function') {
      await assert.rejects(
        async () => {
          await t.execute({}, {})
        },
        /Image generation is disabled in settings/,
        `Tool ${t.name} must reject when enabled is false`
      )
    }
  }

  // Toggling settings dynamically to enabled: true allows execution to pass disabled check
  liveConfig = {
    enabled: true,
    toolsetProfile: 'all',
  }

  // For inspect_image_quality with empty args it won't throw "Image generation is disabled in settings"
  const inspectTool = tools.find((t) => t.name === 'inspect_image_quality')
  assert.ok(inspectTool)
  try {
    await inspectTool.execute({}, {})
  } catch (err) {
    assert.ok(
      !err.message.includes('Image generation is disabled in settings'),
      'When enabled=true, tool execution must proceed past enabled guard'
    )
  }
})

test('master switch: /image command returns error when cfg.enabled is false (#356)', async () => {
  let liveConfig = { enabled: false }
  let registeredCmd = null

  const ctx = {
    inject(deps, callback) {
      callback({
        commands: {
          register(cmd) {
            registeredCmd = cmd
          },
        },
      })
    },
  }

  registerImageCommand(ctx, {
    config: liveConfig,
    live: () => liveConfig,
    saveAndAttachResult: () => {},
    resolveApiKey: () => {},
    slugify: () => {},
  })

  assert.ok(registeredCmd, 'registerImageCommand must register command')
  const handlerResult = await registeredCmd.handler({ rawInput: 'futuristic neon city' })
  assert.equal(handlerResult.kind, 'error')
  assert.ok(handlerResult.text.includes('Image generation is disabled in settings'))

  const execResult = await registeredCmd.execute('futuristic neon city', {})
  assert.ok(execResult.includes('Image generation is disabled in settings'))
})

test('toolsets profile: reactive update on profile change (minimal -> all -> custom -> minimal) (#384)', () => {
  let liveCfg = { toolsetProfile: 'minimal' }
  const registeredTools = new Map()

  const ctx = {
    effect(fn) {
      fn()
    },
    tools: {
      register(def) {
        registeredTools.set(def.name, def)
        return () => {
          registeredTools.delete(def.name)
        }
      },
    },
  }

  const controller = registerAllTools(ctx, {
    config: liveCfg,
    live: () => liveCfg,
    saveAndAttachResult: () => {},
    resolveSource: () => {},
    slugify: () => {},
    resolveApiKey: () => {},
  })

  // 1. Initially minimal (3 core tools)
  assert.equal(registeredTools.size, 3)
  assert.deepEqual(Array.from(registeredTools.keys()).sort(), ['edit_image', 'generate_image', 'inspect_image_quality'])

  // 2. Switch to "all" without restart
  liveCfg = { toolsetProfile: 'all' }
  controller.sync()
  assert.equal(registeredTools.size, 30, 'Profile all must register exactly 30 tools without restart')
  // Verify no duplicates
  const namesAll = Array.from(registeredTools.keys())
  const uniqueNamesAll = new Set(namesAll)
  assert.equal(uniqueNamesAll.size, 30, 'Must have 30 unique tool names')

  // 3. Switch to custom with design toolset only
  liveCfg = { toolsetProfile: 'custom', toolsets: { design: true } }
  controller.sync()
  assert.equal(registeredTools.size, 9, 'Custom design toolset must have 3 core + 6 design = 9 tools')
  assert.ok(registeredTools.has('set_style_anchor'))
  assert.ok(registeredTools.has('generate_ui_asset'))
  assert.ok(!registeredTools.has('sketch_to_image'), 'Non-design tools must be unregistered')
  assert.ok(!registeredTools.has('remove_background'), 'Non-design tools must be unregistered')

  // 4. Switch back to minimal
  liveCfg = { toolsetProfile: 'minimal' }
  controller.sync()
  assert.equal(registeredTools.size, 3, 'Switching back to minimal must restore 3 core tools')
  assert.deepEqual(Array.from(registeredTools.keys()).sort(), ['edit_image', 'generate_image', 'inspect_image_quality'])
})
