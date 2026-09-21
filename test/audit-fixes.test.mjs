import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeminiGenerator } from '../lib/providers/backends/gemini.js';
import { createSeedreamGenerator } from '../lib/providers/backends/seedream.js';
import { editImageDirect, varyImageDirect } from '../lib/providers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('audit (#268): tool files forward signal: exec?.signal to job', () => {
  const checkFiles = [
    'lib/tools/editing.js',
    'lib/tools/sketch.js',
    'lib/tools/pattern.js',
    'lib/tools/spritesheet.js',
    'lib/tools/responsive.js',
  ];

  for (const f of checkFiles) {
    const content = fs.readFileSync(path.join(root, f), 'utf8');
    assert.match(
      content,
      /signal:\s*exec\?\.signal/,
      `${f} must forward exec?.signal to job`
    );
  }
});

test('audit (#269): gemini backend enforces fallback timeout signal', async () => {
  let capturedSignal = null;
  const mockFetch = async (url, opts) => {
    capturedSignal = opts.signal;
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ inlineData: { data: 'AQID', mimeType: 'image/png' } }] } }],
      }),
    };
  };

  const deps = {
    fetchImpl: mockFetch,
    resolveKey: async () => 'test-key',
    cfg: { geminiKeyEnv: 'GEMINI_KEY', timeoutMs: 50000 },
  };

  // Called WITHOUT signal
  const gen = createGeminiGenerator(deps, { prompt: 'test', size: 'square', format: 'png' });
  await gen(1, 'test');

  assert.ok(capturedSignal, 'Gemini must provide an AbortSignal even when signal is omitted');
});

test('audit (#269): seedream backend enforces fallback timeout signal', async () => {
  let capturedSignal = null;
  const mockFetch = async (url, opts) => {
    capturedSignal = opts.signal;
    return {
      ok: true,
      json: async () => ({
        data: [{ b64_json: 'AQID' }],
      }),
    };
  };

  const deps = {
    fetchImpl: mockFetch,
    resolveKey: async () => 'test-key',
    cfg: { seedreamKeyEnv: 'SEEDREAM_KEY', timeoutMs: 50000 },
  };

  // Called WITHOUT signal
  const gen = createSeedreamGenerator(deps, { prompt: 'test', size: 'square', format: 'png' });
  await gen(1, 'test');

  assert.ok(capturedSignal, 'Seedream must provide an AbortSignal even when signal is omitted');
});

test('audit (#270): lib/tools/editing.js invokes editImageDirect and varyImageDirect', () => {
  const content = fs.readFileSync(path.join(root, 'lib/tools/editing.js'), 'utf8');
  assert.match(content, /await\s+editImageDirect\(deps,\s*job\)/);
  assert.match(content, /await\s+varyImageDirect\(deps,\s*job\)/);
});

test('audit (#272): no bulk unused provider imports in tool modules', () => {
  const files = [
    'lib/tools/processing-basic.js',
    'lib/tools/processing-advanced.js',
    'lib/tools/frontend.js',
  ];

  for (const f of files) {
    const content = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(content, /makeProviders/);
    assert.doesNotMatch(content, /OUTPUT_FORMATS/);
    assert.doesNotMatch(content, /PROVIDER_KEYS/);
  }

  const inspectContent = fs.readFileSync(path.join(root, 'lib/tools/inspect.js'), 'utf8');
  assert.doesNotMatch(inspectContent, /makeProviders/);
  assert.doesNotMatch(inspectContent, /OUTPUT_FORMATS/);
});

test('audit (#273): /dsh-image-gen/image route uses Buffer.isBuffer check before Buffer.from', () => {
  const indexContent = fs.readFileSync(path.join(root, 'lib/index.js'), 'utf8');
  assert.match(
    indexContent,
    /res\.end\(Buffer\.isBuffer\(stored\.data\)\s*\?\s*stored\.data\s*:\s*Buffer\.from\(stored\.data\)\)/
  );
});
