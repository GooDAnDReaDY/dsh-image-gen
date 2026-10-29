// @ts-check
// test/translate-image-text.test.mjs — tests for translate_image_text tool (#454).
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import {
  translateTextString,
  TRANSLATION_DICTIONARY,
  registerTranslateImageTextTools,
} from '../lib/tools/translate-image-text.js'

const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==',
  'base64',
)

test('translate_image_text: dictionary translations return accurate localized strings (#454)', () => {
  assert.equal(translateTextString('Settings', 'ru'), 'Настройки')
  assert.equal(translateTextString('Settings', 'zh'), '设置')
  assert.equal(translateTextString('Save', 'ru'), 'Сохранить')
  assert.equal(translateTextString('Cancel', 'ru'), 'Отмена')
  assert.equal(translateTextString('Login', 'zh'), '登录')
  assert.equal(translateTextString('Hello World', 'ru'), 'Привет, мир')
  // Case-insensitivity
  assert.equal(translateTextString('dashboard', 'ru'), 'Панель управления')
  // Untranslated returns original clean string
  assert.equal(translateTextString('Quantum Entanglement 42', 'ru'), 'Quantum Entanglement 42')
})

test('translate_image_text: tool registers with schema and renders output (#454)', () => {
  let registeredTool = null
  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) { registeredTool = def },
    },
  }

  registerTranslateImageTextTools(ctx, {
    live: () => ({ enabled: true }),
    saveAndAttachResult: async () => {},
    slugify: (s) => s,
    resolveApiKey: async () => 'test-key',
  })

  assert.ok(registeredTool, 'translate_image_text must be registered')
  assert.equal(registeredTool.name, 'translate_image_text')
  assert.ok(registeredTool.parameters.properties.image)
  assert.ok(registeredTool.parameters.properties.target_lang)
  assert.ok(registeredTool.parameters.properties.regions)
  assert.ok(typeof registeredTool.output.render === 'function')

  const rendered = registeredTool.output.render(null, {
    summary: 'Localized image with 2 translated items',
    path: '/path/to/img.png',
  })
  assert.ok(Array.isArray(rendered))
  assert.ok(rendered.length >= 1)
})

test('translate_image_text: executes with explicit regions, produces inpaint mask and overlay (#454)', async () => {
  let registeredTool = null
  const ctx = {
    effect(fn) { fn() },
    tools: {
      register(def) { registeredTool = def },
    },
    logger: {
      debug() {},
      warn() {},
      info() {},
    },
    attachments: {
      async saveImage({ bytes, mediaType, name }) {
        return {
          attachment: {
            attachmentId: `att-${name}`,
            url: `https://test-cdn.local/${name}`,
            mediaType,
            width: 100,
            height: 100,
          },
          localUrl: `https://test-cdn.local/${name}`,
        }
      },
    },
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'trans-test-'))
  const testImgPath = path.join(tmpDir, 'ui-source.png')
  await writeFile(testImgPath, TEST_PNG)

  let attachedMeta = null
  const deps = {
    live: () => ({ enabled: true, provider: 'fal', outputDir: tmpDir }),
    saveAndAttachResult: async (_ctx, _exec, _cfg, meta) => {
      attachedMeta = meta
      return {
        path: path.join(tmpDir, meta.name),
        url: `file://${path.join(tmpDir, meta.name)}`,
        attachment: { attachmentId: 'att-res', url: 'https://test-cdn.local/res.png' },
      }
    },
    slugify: (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey: async () => 'test-api-key',
  }

  registerTranslateImageTextTools(ctx, deps)

  const execCtx = {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: tmpDir }, id: 'sess-test' } },
  }

  try {
    const result = await registeredTool.execute(
      {
        image: testImgPath,
        target_lang: 'ru',
        regions: [
          { text: 'Settings', bbox: [50, 50, 300, 150] },
          { text: 'Profile', bbox: [50, 200, 300, 300], target_text: 'Мой Профиль' },
        ],
      },
      execCtx,
    )

    assert.equal(result.translatedCount, 2)
    assert.equal(result.targetLanguage, 'ru')
    assert.equal(result.regions[0].targetText, 'Настройки')
    assert.equal(result.regions[1].targetText, 'Мой Профиль')
    assert.ok(result.maskAttachment, 'Mask SVG attachment must be present')
    assert.ok(result.overlayAttachment, 'Overlay SVG attachment must be present')
    assert.ok(attachedMeta, 'saveAndAttachResult must be invoked')
    assert.equal(attachedMeta.action, 'translated')
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
})

