import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  THEME_STYLES,
  buildThemePairPrompts,
  buildThemePairSnippet,
} from '../lib/theme-pair-helpers.js'
import { registerThemePairTools } from '../lib/tools/theme-pair.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = path.join(here, '..', 'lib')

test('theme-pair: buildThemePairPrompts synthesizes light and dark directives (#189)', () => {
  const { lightPrompt, darkPrompt } = buildThemePairPrompts({
    prompt: 'abstract analytics dashboard card',
    style: 'minimalist',
    darkContrastBoost: 1.3,
  })

  assert.ok(lightPrompt.includes('clean pure white background'))
  assert.ok(lightPrompt.includes('light mode color palette'))
  assert.ok(lightPrompt.includes('minimalist aesthetic style'))

  assert.ok(darkPrompt.includes('deep dark slate or obsidian background'))
  assert.ok(darkPrompt.includes('dark mode color palette'))
  assert.ok(darkPrompt.includes('130% dynamic range highlights'))
  assert.ok(darkPrompt.includes('minimalist aesthetic style'))
})

test('theme-pair: buildThemePairSnippet generates responsive picture tag and css (#189)', () => {
  const { html, css } = buildThemePairSnippet({
    lightSrc: 'banner-light.png',
    darkSrc: 'banner-dark.png',
    alt: 'Analytics Hero Banner',
  })

  assert.ok(html.includes('<picture class="dsh-theme-pair">'))
  assert.ok(html.includes('(prefers-color-scheme: dark)'))
  assert.ok(html.includes('srcset="banner-dark.png"'))
  assert.ok(html.includes('src="banner-light.png"'))
  assert.ok(html.includes('alt="Analytics Hero Banner"'))

  assert.ok(css.includes('.dsh-theme-pair img'))
  assert.ok(css.includes(':is(.dark, [data-theme="dark"])'))
})

test('theme-pair: tool file declares generate_theme_pair with schema and parameters (#189)', () => {
  const src = readFileSync(path.join(lib, 'tools', 'theme-pair.js'), 'utf8')
  assert.match(src, /name:\s*'generate_theme_pair'/)
  assert.match(src, /prompt:\s*\{[\s\S]*?required:\s*true/)
  assert.match(src, /aspect_ratio:\s*\{/)
  assert.match(src, /style:\s*\{/)
  assert.match(src, /dark_contrast_boost:\s*\{/)
  assert.match(src, /additionalProperties:\s*true/)
  assert.match(src, /executeWithFallback/)

  const registered = []
  const mockCtx = {
    effect: (fn) => fn(),
    tools: {
      register: (tool) => registered.push(tool),
    },
  }

  registerThemePairTools(mockCtx, {
    live: () => ({ enabled: true }),
    slugify: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey: () => 'mock-key',
  })

  assert.equal(registered.length, 1)
  const tool = registered[0]
  assert.equal(tool.name, 'generate_theme_pair')
  assert.equal(typeof tool.output.render, 'function')

  const sampleRender = tool.output.render(null, {
    summary: 'OK',
    light: { path: '/tmp/light.png', url: '/dsh-image-gen/image?id=l1' },
    dark: { path: '/tmp/dark.png', url: '/dsh-image-gen/image?id=d1' },
  })
  assert.ok(Array.isArray(sampleRender))
  assert.ok(sampleRender.length >= 1)
})