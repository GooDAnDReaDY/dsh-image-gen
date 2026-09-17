// lifecycle-structure.test.mjs — tool registration layout (#216)

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(here, '..', 'lib')

const EXPECTED_TOOLS = [
  'assemble_image_grid',
  'export_asset_pack',
  'remix_image',
  'smart_crop_image',
  'generate_image',
  'generate_image_pack',
  'remove_background',
  'upscale_image',
  'vectorize_image',
  'blend_images',
  'edit_image',
  'vary_image',
  'compare_images',
  'inspect_image_quality',
  'extract_design_tokens',
  'image_to_css_gradient',
  'check_image_contrast',
  'optimize_vector_svg',
  'generate_pwa_icon_suite',
  'sketch_to_image',
  'generate_spritesheet',
  'generate_seamless_pattern',
  'generate_responsive_mockups',
]

test('lifecycle: apply() delegates to registerAllTools and keeps host thin', () => {
  const src = readFileSync(path.join(lib, 'index.js'), 'utf8')
  assert.match(src, /registerAllTools\(ctx,/)
  assert.ok(src.split('\n').length < 800, `index.js should stay under 800 lines, got ${src.split('\n').length}`)
  assert.ok(!/ctx\.tools\.register\(/.test(src), 'index.js must not register tools inline')
})

test('lifecycle: every tool is registered inside a labeled ctx.effect', () => {
  const toolsDir = path.join(lib, 'tools')
  const files = readdirSync(toolsDir).filter((f) => f.endsWith('.js'))
  assert.ok(files.length >= 5, 'expected modular tool groups')
  const found = []
  for (const file of files) {
    const src = readFileSync(path.join(toolsDir, file), 'utf8')
    const labels = [...src.matchAll(/dsh-image-gen: tool ([a-z_]+)/g)].map((m) => m[1])
    for (const name of labels) {
      found.push(name)
      assert.match(src, new RegExp(`ctx\\.effect\\(\\(\\) => \\{[\\s\\S]*?name: '${name}'[\\s\\S]*?\\}, 'dsh-image-gen: tool ${name}'\\)`))
    }
  }
  assert.deepEqual([...found].sort(), [...EXPECTED_TOOLS].sort())
})

test('lifecycle: orchestrator wires all five tool groups', () => {
  const src = readFileSync(path.join(lib, 'register-tools.js'), 'utf8')
  for (const fn of [
    'registerGenerationTools',
    'registerProcessingTools',
    'registerEditingTools',
    'registerInspectTools',
    'registerFrontendTools',
    'registerResponsiveTools',
  ]) {
    assert.match(src, new RegExp(fn))
  }
})

test('docs: project meta files exist', () => {
  const root = path.join(here, '..')
  for (const name of ['AGENTS.md', 'index.md', 'docs/design/DESIGN.md']) {
    assert.ok(readFileSync(path.join(root, name), 'utf8').length > 100, name)
  }
  const design = readFileSync(path.join(root, 'docs/design/DESIGN.md'), 'utf8')
  assert.ok(!/встроенную галерею истории генераций \(`HistoryGallery`\)/.test(design), 'HistoryGallery must not be advertised as shipped UI')
})

test('lifecycle: index.js imports registerAllTools from register-tools.js', () => {
  const src = readFileSync(path.join(lib, 'index.js'), 'utf8')
  assert.match(src, /import \{ registerAllTools \} from '\.\/register-tools\.js'/)
  assert.match(src, /registerAllTools\(ctx,/)
})

test('identity: export const name matches package.json and client loader id', () => {
  const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'))
  const indexSrc = readFileSync(path.join(lib, 'index.js'), 'utf8')
  const clientSrc = readFileSync(path.join(lib, 'client.js'), 'utf8')
  const cordis = readFileSync(path.join(here, '..', 'cordis.patch.yml'), 'utf8')

  const m = indexSrc.match(/export const name = '([^']+)'/)
  assert.ok(m, 'lib/index.js must export const name')
  assert.equal(m[1], pkg.name, `export const name must equal package.json name`)

  const loadId = clientSrc.match(/__ModuleLoader__\.load\(\{[\s\S]*?id:\s*'([^']+)'/)
  assert.ok(loadId, 'client.js must declare ModuleLoader id')
  assert.equal(loadId[1], pkg.name, 'client loader id must equal package.json name')

  assert.ok(cordis.includes(`name: '${pkg.name}'`), 'cordis.patch.yml name must match package.json')
})
