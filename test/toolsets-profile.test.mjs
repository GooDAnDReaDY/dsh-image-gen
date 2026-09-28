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
