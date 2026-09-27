import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHARACTER_SHEET_LAYOUTS,
  CHARACTER_SHEET_STYLES,
  buildCharacterSheetPrompt,
} from '../lib/character-sheet-helpers.js'
import { registerCharacterSheetTools } from '../lib/tools/character-sheet.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(here, '..', 'lib')

test('character-sheet: layouts and styles are defined and complete', () => {
  assert.ok(CHARACTER_SHEET_LAYOUTS.turnaround)
  assert.ok(CHARACTER_SHEET_LAYOUTS['1x3'])
  assert.ok(CHARACTER_SHEET_LAYOUTS['2x2'])
  assert.ok(CHARACTER_SHEET_LAYOUTS.emotions)

  assert.ok(CHARACTER_SHEET_STYLES.concept_art)
  assert.ok(CHARACTER_SHEET_STYLES.anime)
  assert.ok(CHARACTER_SHEET_STYLES['3d_animation'])
  assert.ok(CHARACTER_SHEET_STYLES.pixel_art)
  assert.ok(CHARACTER_SHEET_STYLES.realistic)
  assert.ok(CHARACTER_SHEET_STYLES.comic)
})

test('character-sheet: buildCharacterSheetPrompt generates turnkey prompts with consistency directives', () => {
  const result = buildCharacterSheetPrompt({
    prompt: 'red-haired elven ranger with obsidian bow',
    layout: 'turnaround',
    style: 'anime',
  })

  assert.equal(result.layout, 'turnaround')
  assert.equal(result.style, 'anime')
  assert.equal(result.aspectRatio, '16:9')
  assert.ok(result.prompt.includes('red-haired elven ranger with obsidian bow'))
  assert.ok(result.prompt.includes('anime'))
  assert.ok(result.prompt.includes('turnaround'))
  assert.ok(result.prompt.includes('identical person across all angles'))
  assert.equal(result.views.length, 4)
  assert.ok(result.negativePrompt.includes('different characters'))
})

test('character-sheet: buildCharacterSheetPrompt supports 2x2 and emotions layouts', () => {
  const quad = buildCharacterSheetPrompt({
    prompt: 'mech pilot in armored exosuit',
    layout: '2x2',
    style: '3d_animation',
  })
  assert.equal(quad.aspectRatio, '1:1')
  assert.equal(quad.views.length, 4)
  assert.ok(quad.prompt.includes('2x2'))

  const emotions = buildCharacterSheetPrompt({
    prompt: 'cyberpunk street vendor',
    layout: 'emotions',
  })
  assert.equal(emotions.aspectRatio, '1:1')
  assert.ok(emotions.views.includes('neutral'))
  assert.ok(emotions.prompt.includes('facial expression sheet'))
})

test('character-sheet: throws on empty prompt', () => {
  assert.throws(() => {
    buildCharacterSheetPrompt({ prompt: '' })
  }, /required/i)
})

test('character-sheet: tool file declares generate_character_sheet with schema and parameters (#181)', () => {
  const src = fs.readFileSync(path.join(lib, 'tools', 'character-sheet.js'), 'utf8')
  assert.match(src, /name:\s*'generate_character_sheet'/)
  assert.match(src, /prompt:\s*\{/)
  assert.match(src, /layout:\s*\{/)
  assert.match(src, /style:\s*\{/)
  assert.match(src, /additionalProperties:\s*true/)
  assert.match(src, /executeWithFallback/)

  const registered = []
  const mockCtx = {
    effect(fn) { fn() },
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
  }

  registerCharacterSheetTools(mockCtx, {
    live: { value: {} },
    slugify: (s) => s.toLowerCase().replace(/\s+/g, '-'),
    resolveApiKey: () => 'fake-key',
  })

  assert.equal(registered.length, 1)
  const tool = registered[0]
  assert.equal(tool.name, 'generate_character_sheet')
  assert.equal(typeof tool.output.render, 'function')
  assert.equal(tool.output.schema.type, 'object')
  assert.equal(tool.output.schema.additionalProperties, true)

  const sampleRender = tool.output.render(null, {
    summary: 'OK',
    attachment: { id: 'test-att', url: 'https://example.com/sheet.png' },
    layout: 'turnaround',
    style: 'anime',
    views: ['front', 'side', 'back'],
  })
  assert.ok(Array.isArray(sampleRender))
  assert.ok(sampleRender.length >= 1)
})
