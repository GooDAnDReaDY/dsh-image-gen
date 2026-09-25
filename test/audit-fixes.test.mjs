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

test("audit (#295): ensureConfig handles plain, empty and volatile config inputs", async () => {
  const { ensureConfig, plainConfig } = await import("../lib/index.js");

  // 1. Plain empty config
  const c1 = ensureConfig({});
  const p1 = plainConfig(c1);
  assert.equal(p1.enabled, true);
  assert.equal(p1.timeoutMs, 180000);
  assert.equal(p1.provider, "fal");

  // 2. Synthesized empty field objects from cordis loader
  const c2 = ensureConfig({ enabled: {}, timeoutMs: {} });
  const p2 = plainConfig(c2);
  assert.equal(p2.enabled, true);
  assert.equal(p2.timeoutMs, 180000);

  // 3. Volatile ref getters from cordis reactive context
  const fakeVolatile = {
    enabled: { get: () => true },
    timeoutMs: { get: () => 120000 },
    provider: { get: () => "custom" },
  };
  const c3 = ensureConfig(fakeVolatile);
  const p3 = plainConfig(c3);
  assert.equal(p3.enabled, true);
  assert.equal(p3.timeoutMs, 120000);
  assert.equal(p3.provider, "custom");

  // 4. Custom plain options
  const c4 = ensureConfig({ provider: "custom", timeoutMs: 60000 });
  const p4 = plainConfig(c4);
  assert.equal(p4.provider, "custom");
  assert.equal(p4.timeoutMs, 60000);
});

// ── GH Issue #4: enhancePrompt must be importable from prompt-enhancer.js ──
test('GH#4: enhancePrompt is exported from prompt-enhancer.js', async () => {
  const mod = await import('../lib/prompt-enhancer.js')
  assert.strictEqual(typeof mod.enhancePrompt, 'function', 'enhancePrompt must be a function')
  assert.strictEqual(typeof mod.buildEnhancePromptSystemMessage, 'function', 'buildEnhancePromptSystemMessage must be a function')
  assert.strictEqual(typeof mod.collectText, 'function', 'collectText must be a function')
})

test('GH#4: enhancePrompt is re-exported from index.js for backwards compat', async () => {
  const mod = await import('../lib/index.js')
  assert.strictEqual(typeof mod.enhancePrompt, 'function')
  assert.strictEqual(typeof mod.buildEnhancePromptSystemMessage, 'function')
  assert.strictEqual(typeof mod.collectText, 'function')
})

test('GH#4: generation.js can import enhancePrompt without ReferenceError', async () => {
  // This import itself validates that the identifier resolves at module load time
  const mod = await import('../lib/tools/generation.js')
  assert.strictEqual(typeof mod.registerGenerationTools, 'function')
})

test('GH#4: enhancePrompt returns original prompt when disabled', async () => {
  const { enhancePrompt } = await import('../lib/prompt-enhancer.js')
  const result = await enhancePrompt({}, { enhancePrompt: false }, 'test prompt', null, 'fal')
  assert.deepStrictEqual(result, { prompt: 'test prompt', enhanced: false })
})

test('GH#4: enhancePrompt returns original prompt when prompt is long enough', async () => {
  const { enhancePrompt } = await import('../lib/prompt-enhancer.js')
  const longPrompt = 'a'.repeat(250)
  const result = await enhancePrompt({}, { enhancePrompt: true, enhanceBelowChars: 200 }, longPrompt, null, 'fal')
  assert.deepStrictEqual(result, { prompt: longPrompt, enhanced: false })
})

// ── GH Issue #5: SVG attachments must NOT enter multimodal LLM context ──
test('GH#5: renderToolOutput omits image block for SVG attachments', async () => {
  const { renderToolOutput } = await import('../lib/attachment-helper.js')
  const value = {
    summary: 'test grid',
    attachment: { attachmentId: '', mediaType: 'image/svg+xml', bytes: 1000, width: 0, height: 0, name: 'grid.svg' },
  }
  const blocks = renderToolOutput(value)
  assert.strictEqual(blocks.length, 1, 'SVG attachment must NOT produce image block')
  assert.strictEqual(blocks[0].type, 'text')
})

test('GH#5: renderToolOutput emits image block for PNG attachments', async () => {
  const { renderToolOutput } = await import('../lib/attachment-helper.js')
  const value = {
    summary: 'test image',
    attachment: { attachmentId: 'abc123', mediaType: 'image/png', bytes: 5000, width: 512, height: 512, name: 'img.png' },
  }
  const blocks = renderToolOutput(value)
  assert.strictEqual(blocks.length, 2, 'PNG attachment must produce image block')
  assert.strictEqual(blocks[1].type, 'image')
})

test('GH#5: renderToolOutput omits image block when attachmentId is empty', async () => {
  const { renderToolOutput } = await import('../lib/attachment-helper.js')
  const value = {
    summary: 'fallback',
    attachment: { attachmentId: '', mediaType: 'image/png', bytes: 100, width: 0, height: 0, name: 'x.png' },
  }
  const blocks = renderToolOutput(value)
  assert.strictEqual(blocks.length, 1, 'Empty attachmentId must NOT produce image block')
})

test('GH#5: saveAttachmentSafe returns stub for SVG without calling saveImage', async () => {
  const { saveAttachmentSafe } = await import('../lib/providers.js')
  let saveCalled = false
  const ctx = {
    attachments: {
      saveImage: async () => { saveCalled = true; return { attachmentId: 'x' } },
    },
  }
  const result = await saveAttachmentSafe(ctx, {
    bytes: Buffer.from('<svg></svg>'),
    mediaType: 'image/svg+xml',
    name: 'test.svg',
  })
  assert.strictEqual(saveCalled, false, 'saveImage must NOT be called for SVG')
  assert.strictEqual(result.attachment.attachmentId, '', 'SVG attachment must have empty id')
  assert.strictEqual(result.localUrl, '')
})

test('GH#5: saveAttachmentSafe calls saveImage for PNG', async () => {
  const { saveAttachmentSafe } = await import('../lib/providers.js')
  let saveCalled = false
  const ctx = {
    attachments: {
      saveImage: async ({ mediaType }) => {
        saveCalled = true
        return { attachmentId: 'png-123', mediaType, bytes: 100, width: 64, height: 64, name: 'test.png' }
      },
    },
  }
  const result = await saveAttachmentSafe(ctx, {
    bytes: Buffer.alloc(100),
    mediaType: 'image/png',
    name: 'test.png',
  })
  assert.strictEqual(saveCalled, true, 'saveImage must be called for PNG')
  assert.strictEqual(result.attachment.attachmentId, 'png-123')
  assert.ok(result.localUrl.includes('png-123'))
})

// ── Issue #303: Locale registration via current ctx.locale.register API ──
test('audit (#303): client registers locales using modern ctx.locale.register(NS, { en, zh })', async () => {
  const fs = await import('node:fs')
  const vm = await import('node:vm')
  const clientCode = fs.readFileSync('lib/client.js', 'utf8')

  let loadedModule = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: (entry) => { loadedModule = entry },
      },
    },
    document: {
      head: { appendChild: () => {} },
      createElement: () => ({ setAttribute: () => {}, appendChild: () => {} }),
    },
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(clientCode, sandbox)

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
  assert.strictEqual(typeof moduleExports?.apply, 'function', 'client plugin must have apply function')

  let registeredNs = null
  let registeredDicts = null
  let effectCalled = false

  const mockCtx = {
    locale: {
      register: (ns, dicts) => {
        registeredNs = ns
        registeredDicts = dicts
        return () => {}
      },
    },
    effect: (fn, label) => {
      effectCalled = true
      return fn()
    },
    slots: {
      inject: (name, cb) => cb(),
      register: () => () => {},
    },
  }

  moduleExports.apply(mockCtx)

  assert.strictEqual(registeredNs, 'dsh-image-gen', 'Must register under dsh-image-gen namespace')
  assert.ok(registeredDicts && typeof registeredDicts === 'object', 'Dicts must be provided')
  assert.ok(registeredDicts.en && typeof registeredDicts.en === 'object', 'English dictionary must be registered')
  assert.ok(registeredDicts.zh && typeof registeredDicts.zh === 'object', 'Chinese dictionary must be registered')
  assert.strictEqual(effectCalled, true, 'Registration must be registered inside labeled ctx.effect')
})

// ── Issue #304: Asset Vault & Image Studio localization ──
test('audit (#304): client UI resolves all Vault and Studio strings through locale dictionaries', async () => {
  const fs = await import('node:fs')
  const vm = await import('node:vm')
  const clientCode = fs.readFileSync('lib/client.js', 'utf8')

  let loadedModule = null
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (entry) => { loadedModule = entry } },
      localStorage: { getItem: () => null, setItem: () => {} },
    },
    document: {
      head: { appendChild: () => {} },
      createElement: () => ({ setAttribute: () => {}, appendChild: () => {} }),
    },
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(clientCode, sandbox)

  let capturedComponents = {}
  const mockRequire = (id) => {
    if (id === 'react') {
      return {
        createElement: (type, props, ...children) => {
          if (typeof type === 'function') {
            capturedComponents[type.name] = type
          }
          return { type, props, children }
        },
        useState: (init) => [init, () => {}],
        useEffect: () => {},
        Fragment: 'Fragment',
      }
    }
    if (id === 'react/jsx-runtime') {
      return { jsx: () => ({}), jsxs: () => ({}) }
    }
    throw new Error(`Cannot find module '${id}'`)
  }

  const moduleExports = loadedModule.factory(mockRequire)
  let registeredSlots = []
  const mockCtx = {
    locale: { register: () => () => {} },
    inject: (deps, cb) => {
      cb({ sidebarRightTabs: { register: () => {} }, slots: mockCtx.slots })
    },
    slots: {
      inject: (name, cb) => cb(),
      register: (desc, comp) => {
        registeredSlots.push({ desc, comp })
      },
    },
  }
  moduleExports.apply(mockCtx)

  // Find ImageStudioView slot
  const studioSlot = registeredSlots.find((s) => s.desc?.name === 'sidebar.right.pane.tab')
  assert.ok(studioSlot, 'Studio tab slot must be registered')

  // Check English and Chinese dictionary definitions in client bundle
  assert.ok(clientCode.includes("'studio.title': 'Image Studio'"))
  assert.ok(clientCode.includes("'studio.title': '图像创作工作台'"))
  assert.ok(clientCode.includes("'vault.search': 'Search prompt or tags...'"))
  assert.ok(clientCode.includes("'vault.search': '搜索提示词或标签...'"))
  assert.ok(clientCode.includes("'vault.empty': '素材库中暂无图像。'"))
})

// ── Issue #305: Containment and bounded limits on image inputs and data URIs ──
test('audit (#305): resolveConversationImage rejects absolute paths outside workspace', async () => {
  const { resolveConversationImage } = await import('../lib/resolve-image.js')
  const ctx = {}
  const exec = { agent: { session: { header: { cwd: '/tmp/test-session-workspace' } } } }

  await assert.rejects(
    async () => resolveConversationImage(ctx, exec, '/etc/hostname'),
    /Access denied: path "\/etc\/hostname" is outside allowed workspace directory/
  )
})

test('audit (#305): resolveConversationImage rejects path traversal outside workspace', async () => {
  const { resolveConversationImage } = await import('../lib/resolve-image.js')
  const ctx = {}
  const exec = { agent: { session: { header: { cwd: '/tmp/test-session-workspace' } } } }

  await assert.rejects(
    async () => resolveConversationImage(ctx, exec, '../../../../etc/passwd'),
    /Access denied: path "\.\.\/\.\.\/\.\.\/\.\.\/etc\/passwd" is outside allowed workspace directory/
  )
})

test('audit (#305): resolveConversationImage rejects oversized data URIs before allocation', async () => {
  const { resolveConversationImage } = await import('../lib/resolve-image.js')
  const ctx = {}
  const exec = { agent: { session: { header: { cwd: '/tmp' } } } }
  // Construct a pseudo data URI with declared length > 50MB (base64 string of 70M chars)
  const hugeDataUri = 'data:image/png;base64,' + 'A'.repeat(70 * 1024 * 1024)

  await assert.rejects(
    async () => resolveConversationImage(ctx, exec, hugeDataUri),
    /Data URI payload too large/
  )
})

test('audit (#305): resolveConversationImage validates image signatures and rejects non-image files', async () => {
  const { resolveConversationImage } = await import('../lib/resolve-image.js')
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const testDir = path.join(os.tmpdir(), `test-dsh-img-sig-${Date.now()}`)
  fs.mkdirSync(testDir, { recursive: true })
  const fakeImgPath = path.join(testDir, 'not_really_an_image.png')
  fs.writeFileSync(fakeImgPath, 'This is a text file that pretends to be a png')

  const ctx = {}
  const exec = { agent: { session: { header: { cwd: testDir } } } }

  await assert.rejects(
    async () => resolveConversationImage(ctx, exec, fakeImgPath),
    /does not match any recognized image signature/
  )

  fs.unlinkSync(fakeImgPath)
})

test('audit (#305): resolveSource enforces workspace containment and signature check', async () => {
  const { resolveSource } = await import('../lib/index.js')
  const ctx = {}
  const exec = { agent: { session: { header: { cwd: '/tmp/dsh-source-test' } } } }

  await assert.rejects(
    async () => resolveSource(ctx, exec, '/etc/shadow'),
    /Access denied: path "\/etc\/shadow" is outside allowed workspace directory/
  )
})

// ── Issue #306: Vault DELETE reads bounded body with early 413 rejection ──
test('audit (#306): readBoundedRequestBody rejects bodies exceeding byte ceiling with 413', async () => {
  const { readBoundedRequestBody } = await import('../lib/vault.js')
  const { Readable } = await import('node:stream')

  // Stream emitting 70 KB in chunks
  const chunk = Buffer.alloc(10 * 1024, 'A')
  let count = 0
  const req = new Readable({
    read() {
      if (count++ < 7) {
        this.push(chunk)
      } else {
        this.push(null)
      }
    },
  })

  await assert.rejects(
    async () => readBoundedRequestBody(req, 64 * 1024),
    (err) => {
      assert.strictEqual(err.statusCode, 413)
      assert.ok(err.message.includes('Payload Too Large'))
      return true
    }
  )
})

test('audit (#306): vault DELETE route responds with 413 on oversized body and halts deletion', async () => {
  const { registerVaultRoutes } = await import('../lib/vault.js')
  const { Readable } = await import('node:stream')

  let registeredRoute = null
  const mockCtx = {
    effect: (fn) => fn(),
    webServer: {
      register: (opts) => {
        if (opts.path === '/dsh-image-gen/vault') registeredRoute = opts
      },
    },
  }
  registerVaultRoutes(mockCtx)
  assert.ok(registeredRoute, 'Vault route must be registered')

  // Create oversized request with loopback headers to pass isTrustedLocalRequest
  const chunk = Buffer.alloc(16 * 1024, 'X')
  let pushed = 0
  const req = new Readable({
    read() {
      if (pushed++ < 5) { // 5 * 16KB = 80KB > 64KB
        this.push(chunk)
      } else {
        this.push(null)
      }
    },
  })
  req.method = 'DELETE'
  req.url = '/dsh-image-gen/vault'
  req.headers = { host: '127.0.0.1' }
  req.socket = { remoteAddress: '127.0.0.1' }

  let statusCode = 0
  let responseData = ''
  const res = {
    writeHead: (code, headers) => { statusCode = code },
    end: (body) => { responseData = body },
  }

  await registeredRoute.handler(req, res)
  assert.strictEqual(statusCode, 413, 'Must return HTTP 413 Payload Too Large')
  assert.ok(responseData.includes('Payload Too Large'))
})

// ── Issue #307: History file and directory permissions (0700/0600) & startup repair ──
test('audit (#307): repairHistoryPermissions migrates legacy 0755 dir and 0644 file to 0700/0600', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { repairHistoryPermissions, writeHistory, historyFile } = await import('../lib/history.js')

  const testDshHome = path.join(os.tmpdir(), `test-dsh-perm-${Date.now()}`)
  process.env.DSH_HOME = testDshHome

  try {
    const file = historyFile()
    const dir = path.dirname(file)

    // Simulate legacy world-readable install: 0755 dir, 0644 file
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
    fs.chmodSync(dir, 0o755)
    fs.writeFileSync(file, JSON.stringify([{ id: 'test-1', prompt: 'secret prompt', path: '/secret/path' }]), { mode: 0o644 })
    fs.chmodSync(file, 0o644)

    // Verify initial legacy permissions
    const dirStatBefore = fs.statSync(dir)
    assert.strictEqual(dirStatBefore.mode & 0o777, 0o755, 'Initial dir mode must be 0755')
    const fileStatBefore = fs.statSync(file)
    assert.strictEqual(fileStatBefore.mode & 0o777, 0o644, 'Initial file mode must be 0644')

    // Run repair
    repairHistoryPermissions()

    // Assert repaired permissions
    const dirStatAfter = fs.statSync(dir)
    assert.strictEqual(dirStatAfter.mode & 0o777, 0o700, 'Repaired dir mode must be 0700')
    const fileStatAfter = fs.statSync(file)
    assert.strictEqual(fileStatAfter.mode & 0o777, 0o600, 'Repaired file mode must be 0600')

    // Also verify writeHistory maintains 0700/0600
    await writeHistory([{ id: 'test-2', prompt: 'another secret', path: '/path/2' }])
    assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700)
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600)
  } finally {
    delete process.env.DSH_HOME
    try { fs.rmSync(testDshHome, { recursive: true, force: true }) } catch {}
  }
})

// ── Issue #266: Canonical sanitized GitHub publish script ──
test('audit (#266): scripts/publish-github.sh exists, is executable and passes --check', async () => {
  const fs = await import('node:fs')
  const { execSync } = await import('node:child_process')

  const scriptPath = 'scripts/publish-github.sh'
  assert.ok(fs.existsSync(scriptPath), 'scripts/publish-github.sh must exist')
  const stat = fs.statSync(scriptPath)
  assert.ok((stat.mode & 0o111) !== 0, 'scripts/publish-github.sh must have executable bit set')

  // Run --check on current HEAD
  const output = execSync('bash scripts/publish-github.sh --check HEAD', { encoding: 'utf8' })
  assert.ok(output.includes('WILL BE PUBLISHED'), 'Must report published list')
  assert.ok(output.includes('WILL BE DROPPED'), 'Must report dropped list')
  assert.ok(output.includes('package.json'), 'package.json must be published')
  assert.ok(output.includes('README.md'), 'README.md must be published')
  assert.ok(output.includes('lib/index.js'), 'lib/index.js must be published')

  // Verify non-product files are excluded from published tree
  assert.ok(!output.split('WILL BE PUBLISHED')[1].split('WILL BE DROPPED')[0].includes('test/'), 'test files must not be published')
  assert.ok(!output.split('WILL BE PUBLISHED')[1].split('WILL BE DROPPED')[0].includes('scripts/'), 'scripts must not be published')
})

// ── Issue #152: Slash command /image <prompt> [flags] ──
test('audit (#152): parseImageCommandArgs correctly parses prompt and flags', async () => {
  const { parseImageCommandArgs } = await import('../lib/commands.js')

  // Empty string
  const empty = parseImageCommandArgs('')
  assert.strictEqual(empty.prompt, '')
  assert.ok(empty.error)

  // Standard prompt with --flag=value
  const r1 = parseImageCommandArgs('cyberpunk cat in neon rain --aspect=16:9 --provider=fal --style=anime --seed=42')
  assert.strictEqual(r1.prompt, 'cyberpunk cat in neon rain')
  assert.strictEqual(r1.flags.aspect, '16:9')
  assert.strictEqual(r1.flags.provider, 'fal')
  assert.strictEqual(r1.flags.style, 'anime')
  assert.strictEqual(r1.flags.seed, '42')

  // Space-separated flags: --size landscape_4_3
  const r2 = parseImageCommandArgs('retro arcade game --size landscape_4_3 --quality hd')
  assert.strictEqual(r2.prompt, 'retro arcade game')
  assert.strictEqual(r2.flags.size, 'landscape_4_3')
  assert.strictEqual(r2.flags.quality, 'hd')

  // Quoted arguments
  const r3 = parseImageCommandArgs('"portrait of a wise owl in library" --style "oil painting" --aspect 1:1')
  assert.strictEqual(r3.prompt, 'portrait of a wise owl in library')
  assert.strictEqual(r3.flags.style, 'oil painting')
  assert.strictEqual(r3.flags.aspect, '1:1')
})

test('audit (#152): registerImageCommand registers /image on commands service and executes directly', async () => {
  const { registerImageCommand } = await import('../lib/commands.js')

  let registeredCommand = null
  let effectDisposer = null

  const dummyImageBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00])

  const mockCtx = {
    inject: (deps, cb) => {
      assert.ok(deps.includes('commands'))
      cb({
        commands: {
          register: (def) => {
            registeredCommand = def
            return () => { registeredCommand = null }
          },
        },
      })
    },
    effect: (fn, label) => {
      effectDisposer = fn()
    },
    attachments: {
      saveImage: async () => ({ attachmentId: 'cmd-img-123', mediaType: 'image/png' }),
    },
  }

  const mockDeps = {
    live: () => ({ provider: 'custom', defaultSize: 'square', defaultFormat: 'png' }),
    resolveApiKey: async () => 'test-key',
    slugify: (str) => 'slug-' + str.replace(/\s+/g, '-'),
    makeProviders: () => ({
      custom: async () => ({
        bytes: dummyImageBytes,
        mediaType: 'image/png',
        seed: 42,
      }),
    }),
    saveAndAttachResult: async (ctx, exec, cfg, params) => {
      return {
        summary: `### Generated Image: ${params.prompt}\n![image](mock-url)`,
        attachment: { attachmentId: 'att-slash-cmd', mediaType: 'image/png' },
      }
    },
  }

  registerImageCommand(mockCtx, mockDeps)

  assert.ok(registeredCommand, 'Command /image must be registered')
  assert.strictEqual(registeredCommand.name, 'image')
  assert.ok(registeredCommand.description.includes('/image'))
  assert.strictEqual(typeof registeredCommand.handler, 'function')
  assert.strictEqual(typeof registeredCommand.execute, 'function')

  // Test usage error on empty prompt
  const emptyRes = await registeredCommand.handler({ rawInput: '' })
  assert.strictEqual(emptyRes.kind, 'error')
  assert.ok(emptyRes.text.includes('Usage: /image'))

  // Test successful execution with mock provider
  const succRes = await registeredCommand.handler({ rawInput: 'neon sunset --aspect=16:9' })
  assert.strictEqual(succRes.kind, 'success')
  assert.ok(succRes.text.includes('Generated Image: neon sunset'))
  assert.strictEqual(succRes.attachment.attachmentId, 'att-slash-cmd')
})
