import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  loadInspirationCatalog,
  searchInspiration,
  getCatalogTaxonomy,
  formatInspirationMarkdown,
  formatInspirationTaxonomyMarkdown,
} from '../lib/inspiration-catalog.js'
import {
  parseModelIdentifier,
  buildComparisonTargets,
  createModelBadgeSvg,
  compositeModelMatrixContactSheet,
  formatModelMatrixMarkdown,
  MODEL_CAPABILITIES,
} from '../lib/model-matrix-helpers.js'
import { registerInspirationTools } from '../lib/tools/inspiration.js'
import { registerModelMatrixTools } from '../lib/tools/model-matrix.js'

test('Issue #504: loadInspirationCatalog bundles 970+ curated prompts from awesome-gpt-image-2 & handraw-style', async () => {
  const catalog = await loadInspirationCatalog()
  assert.ok(catalog.sources.length >= 2, 'Must have at least 2 inspiration sources')
  assert.ok(catalog.cases.length >= 970, `Must bundle at least 970 cases (got ${catalog.cases.length})`)
  assert.ok(catalog.categories.length > 20, 'Must have diverse categories')
  assert.ok(catalog.styles.length > 50, 'Must have diverse style tags')
})

test('Issue #504: searchInspiration filters by query, category, style, and case ID', async () => {
  // Case ID lookup
  const byId = await searchInspiration({ caseId: '544' })
  assert.equal(byId.totalMatches, 1)
  assert.equal(byId.cases[0].id, '544')
  assert.match(byId.cases[0].title, /幼儿词汇拆解学习卡/)

  // Category filter
  const byCategory = await searchInspiration({ category: 'Charts & Infographics', count: 3 })
  assert.ok(byCategory.totalMatches > 0)
  assert.equal(byCategory.cases.length, 3)
  for (const c of byCategory.cases) {
    assert.match(c.category, /Charts & Infographics/i)
  }

  // Keyword query
  const byQuery = await searchInspiration({ query: 'poster minimal', count: 2 })
  assert.ok(byQuery.totalMatches > 0)
  assert.equal(byQuery.cases.length, 2)

  // Source filter
  const handrawOnly = await searchInspiration({ source: 'handraw-style', count: 5 })
  assert.equal(handrawOnly.cases.length, 5)
  for (const c of handrawOnly.cases) {
    assert.equal(c.sourceId, 'handraw-style')
  }
})

test('Issue #504: getCatalogTaxonomy & Markdown formatters', async () => {
  const tax = await getCatalogTaxonomy('all')
  assert.ok(tax.totalCases >= 970)
  assert.ok(tax.categories.length > 20)

  const taxMd = formatInspirationTaxonomyMarkdown(tax)
  assert.match(taxMd, /Inspiration Catalog Taxonomy/)
  assert.match(taxMd, /Awesome GPT Image 2/)
  assert.match(taxMd, /Handraw Style/)

  const searchRes = await searchInspiration({ query: 'poster', count: 2 })
  const caseMd = formatInspirationMarkdown({
    totalMatches: searchRes.totalMatches,
    cases: searchRes.cases,
    query: 'poster',
  })
  assert.match(caseMd, /Inspiration Prompt Catalog/)
  assert.match(caseMd, /Prompt Template/)
})

test('Issue #504: search_inspiration_prompts tool registers and executes', async () => {
  const tools = []
  const ctx = {
    effect(fn) { fn() },
    tools: { register(def) { tools.push(def) } },
  }
  registerInspirationTools(ctx, {})
  assert.equal(tools.length, 1)
  const tool = tools[0]
  assert.equal(tool.name, 'search_inspiration_prompts')
  assert.ok(typeof tool.output.render === 'function')

  // Execute taxonomy mode
  const taxRes = await tool.execute({ list_categories: true }, {})
  assert.ok(taxRes.taxonomy)
  assert.match(taxRes.summary, /Inspiration Catalog Taxonomy/)

  // Execute search mode
  const searchRes = await tool.execute({ query: 'educational', count: 2 }, {})
  assert.ok(searchRes.cases.length <= 2)
  assert.match(searchRes.summary, /Inspiration Prompt Catalog/)

  const rendered = tool.output.render(null, searchRes)
  assert.ok(Array.isArray(rendered))
  assert.match(rendered[0].text, /Inspiration Prompt Catalog/)
})

test('Issue #503: parseModelIdentifier resolves aliases and compound providers', () => {
  const m1 = parseModelIdentifier('imagen-3')
  assert.equal(m1.provider, 'gemini')
  assert.equal(m1.model, 'imagen-3')

  const m2 = parseModelIdentifier('fal/flux-dev')
  assert.equal(m2.provider, 'fal')
  assert.equal(m2.model, 'flux-dev')

  const m3 = parseModelIdentifier('replicate/flux-schnell')
  assert.equal(m3.provider, 'replicate')
  assert.equal(m3.model, 'flux-schnell')

  const m4 = parseModelIdentifier('dall-e-3')
  assert.equal(m4.provider, 'openai')
  assert.equal(m4.model, 'dall-e-3')
})

test('Issue #503: buildComparisonTargets adapts aspect ratios and avoids duplicates', () => {
  const targets = buildComparisonTargets({
    models: ['gemini/imagen-3', 'fal/flux-dev', 'gemini/imagen-3'],
    requestedRatio: '21:9', // Supported by fal, but not gemini
  })
  assert.equal(targets.length, 2, 'Duplicate models must be deduplicated')

  const geminiTarget = targets.find(t => t.provider === 'gemini')
  assert.ok(geminiTarget)
  assert.equal(geminiTarget.ratio, '1:1', 'Unsupported ratio must snap to 1:1')
  assert.equal(geminiTarget.adjusted, true, 'Adjusted flag must be set')

  const falTarget = targets.find(t => t.provider === 'fal')
  assert.ok(falTarget)
  assert.equal(falTarget.ratio, '21:9', 'Supported ratio must be preserved')
  assert.equal(falTarget.adjusted, false)
})

test('Issue #503: createModelBadgeSvg & compositeModelMatrixContactSheet', async () => {
  const badgeSvg = createModelBadgeSvg('Google Imagen 3', '1.8s latency · $0.030')
  assert.ok(Buffer.isBuffer(badgeSvg))
  assert.match(badgeSvg.toString(), /Google Imagen 3/)
  assert.match(badgeSvg.toString(), /1\.8s latency/)

  // Create two solid tiles with Sharp
  const tileA = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer()

  const tileB = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
  }).png().toBuffer()

  const contactSheet = await compositeModelMatrixContactSheet({
    tiles: [
      { bytes: tileA, label: 'Model A', durationMs: 1200, cost: 0.02 },
      { bytes: tileB, label: 'Model B', durationMs: 2500, cost: 0.04 },
    ],
    tileWidth: 100,
    tileHeight: 100,
  })

  assert.ok(Buffer.isBuffer(contactSheet))
  const meta = await sharp(contactSheet).metadata()
  assert.equal(meta.format, 'png')
  assert.equal(meta.width, 200) // 1 row, 2 cols = 200x100
  assert.equal(meta.height, 100)
})

test('Issue #503: formatModelMatrixMarkdown generates table and speed champion', () => {
  const md = formatModelMatrixMarkdown({
    prompt: 'A futuristic electric hypercar speeding through neon Tokyo',
    totalDurationMs: 4200,
    contactSheetUrl: '/dsh-image-gen/image?id=sheet-123',
    results: [
      {
        id: 'M1',
        provider: 'gemini',
        model: 'imagen-3',
        label: 'Google Imagen 3',
        success: true,
        durationMs: 1800,
        cost: 0.03,
        url: '/dsh-image-gen/image?id=img-1',
      },
      {
        id: 'M2',
        provider: 'fal',
        model: 'flux-dev',
        label: 'FLUX Dev (FAL)',
        success: true,
        durationMs: 3400,
        cost: 0.025,
        url: '/dsh-image-gen/image?id=img-2',
      },
    ],
  })

  assert.match(md, /Multi-Model Shootout Matrix \(2\/2 Succeeded in 4\.2s\)/)
  assert.match(md, /!\[Multi-Model Comparison Grid\]\(\/dsh-image-gen\/image\?id=sheet-123\)/)
  assert.match(md, /Google Imagen 3/)
  assert.match(md, /Speed Champion:\*\* \*\*Google Imagen 3\*\* \(1\.80s\)/)
})

test('Issue #503: compare_models_matrix tool registers with schema and renders output', () => {
  const tools = []
  const ctx = {
    effect(fn) { fn() },
    tools: { register(def) { tools.push(def) } },
  }
  registerModelMatrixTools(ctx, {
    live: () => ({ enabled: true, provider: 'fal' }),
    slugify: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey: () => 'test-key',
  })

  assert.equal(tools.length, 1)
  const tool = tools[0]
  assert.equal(tool.name, 'compare_models_matrix')
  assert.ok(tool.parameters.properties.prompt)
  assert.ok(tool.parameters.properties.models)
  assert.ok(tool.output.schema)
  assert.ok(typeof tool.output.render === 'function')

  const rendered = tool.output.render(null, {
    prompt: 'Cyberpunk landscape',
    totalDurationMs: 3500,
    modelsCount: 2,
    successCount: 2,
    results: [
      { id: 'M1', provider: 'fal', model: 'flux-dev', label: 'FLUX Dev', success: true, durationMs: 2100, cost: 0.025 },
      { id: 'M2', provider: 'gemini', model: 'imagen-3', label: 'Imagen 3', success: true, durationMs: 1400, cost: 0.03 },
    ],
  })
  assert.ok(Array.isArray(rendered))
  assert.match(rendered[0].text, /Multi-Model Shootout Matrix/)
  assert.match(rendered[0].text, /<dsh-image-gen-shootout>/)
})
