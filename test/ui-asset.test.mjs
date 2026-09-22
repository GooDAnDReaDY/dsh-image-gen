import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildUiAssetPrompt,
  UI_ASSET_TYPES,
  LAYOUT_COMPOSITIONS,
  COLOR_MODES,
} from '../lib/ui-asset-helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(here, '..', 'lib')

test('ui-asset: buildUiAssetPrompt synthesizes negative space and asset type directives', () => {
  const prompt = buildUiAssetPrompt({
    prompt: 'blue delivery van',
    asset_type: 'icon',
    layout_composition: 'left_empty',
    color_mode: 'flat',
  })

  assert.ok(prompt.includes('blue delivery van'))
  assert.ok(prompt.includes('crisp minimalist app icon'))
  assert.ok(prompt.includes('left 60% entirely empty negative space'))
  assert.ok(prompt.includes('flat vector colors'))
})

test('ui-asset: buildUiAssetPrompt supports all layout compositions', () => {
  const layouts = ['isolated', 'left_empty', 'right_empty', 'top_empty', 'center_empty']
  for (const layout of layouts) {
    const res = buildUiAssetPrompt({
      prompt: 'sparkle star',
      asset_type: 'badge',
      layout_composition: layout,
      color_mode: 'duotone',
    })
    assert.ok(res.includes('sparkle star'))
    assert.ok(res.includes('two-tone duotone aesthetic'))
  }
})

test('ui-asset: constants are defined and exported', () => {
  assert.ok(UI_ASSET_TYPES.includes('icon'))
  assert.ok(UI_ASSET_TYPES.includes('hero_banner'))
  assert.ok(LAYOUT_COMPOSITIONS.includes('isolated'))
  assert.ok(COLOR_MODES.includes('flat'))
})

test('ui-asset: tool file declares generate_ui_asset tool and required parameters', () => {
  const src = readFileSync(path.join(lib, 'tools', 'ui-asset.js'), 'utf8')
  assert.match(src, /name: 'generate_ui_asset'/)
  assert.match(src, /prompt:\s*\{[\s\S]*?required: true/)
  assert.match(src, /asset_type:\s*\{/)
  assert.match(src, /layout_composition:\s*\{/)
  assert.match(src, /transparent:\s*\{/)
  assert.match(src, /removeBackgroundFal/)
})
