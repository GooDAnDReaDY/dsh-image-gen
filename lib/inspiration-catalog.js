// @ts-check
// inspiration-catalog.js — Bundled offline inspiration prompt catalog (#504).
// Curated repository of 970+ production-tested prompts and artistic styles from
// awesome-gpt-image-2 and handraw-style collections with zero token or network overhead.

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'inspiration', 'data')

/**
 * @typedef {object} InspirationCase
 * @property {string|number} id
 * @property {string} title
 * @property {string} prompt
 * @property {string} [promptPreview]
 * @property {string} category
 * @property {string[]} styles
 * @property {string[]} scenes
 * @property {string} [sourceLabel]
 * @property {string} [sourceUrl]
 * @property {string} [githubUrl]
 * @property {boolean} [featured]
 * @property {string} sourceId
 */


async function readCatalogDataset(filename) {
  const gzPath = path.join(DATA_DIR, `${filename}.gz`)
  if (existsSync(gzPath)) {
    const buf = await readFile(gzPath)
    return JSON.parse(zlib.gunzipSync(buf).toString('utf-8'))
  }
  const rawPath = path.join(DATA_DIR, filename)
  if (existsSync(rawPath)) {
    const raw = await readFile(rawPath, 'utf-8')
    return JSON.parse(raw)
  }
  return null
}

let cachedCatalog = null

/**
 * Loads and caches all bundled inspiration prompt catalogs.
 *
 * @returns {Promise<{
 *   sources: Array<{ id: string, label: string, repository: string, version: string, count: number }>,
 *   cases: InspirationCase[],
 *   categories: string[],
 *   styles: string[]
 * }>}
 */
export async function loadInspirationCatalog() {
  if (cachedCatalog) return cachedCatalog

  const allCases = []
  const sources = []
  const categoriesSet = new Set()
  const stylesSet = new Set()

  // 1. awesome-gpt-image-2
  try {
    const p1 = await readCatalogDataset('awesome-gpt-image-2-part1.json') || {}
    const p2 = await readCatalogDataset('awesome-gpt-image-2-part2.json') || {}
    const parsedGpt2 = {
      repository: p1.repository || p2.repository,
      cases: [...(p1.cases || []), ...(p2.cases || [])]
    }
    const cases = Array.isArray(parsedGpt2.cases) ? parsedGpt2.cases : []
    sources.push({
      id: 'awesome-gpt-image-2',
      label: 'Awesome GPT Image 2 (Production Prompts)',
      repository: parsedGpt2.repository || 'https://github.com/freestylefly/awesome-gpt-image-2',
      version: '2026.08',
      count: cases.length,
    })
    for (const item of cases) {
      if (!item.prompt || !item.title) continue
      const normCase = {
        id: String(item.id),
        title: String(item.title).trim(),
        prompt: String(item.prompt).trim(),
        promptPreview: String(item.promptPreview || item.prompt.slice(0, 240)).trim(),
        category: String(item.category || 'General').trim(),
        styles: Array.isArray(item.styles) ? item.styles.map(String) : [],
        scenes: Array.isArray(item.scenes) ? item.scenes.map(String) : [],
        sourceLabel: item.sourceLabel ? String(item.sourceLabel).trim() : undefined,
        sourceUrl: item.sourceUrl ? String(item.sourceUrl).trim() : undefined,
        githubUrl: item.githubUrl ? String(item.githubUrl).trim() : undefined,
        featured: Boolean(item.featured),
        sourceId: 'awesome-gpt-image-2',
      }
      allCases.push(normCase)
      if (normCase.category) categoriesSet.add(normCase.category)
      for (const s of normCase.styles) stylesSet.add(s)
    }
  } catch (err) {
    // Graceful fallback if dataset is missing
  }

  // 2. handraw-style
  try {
    const parsedHandraw = await readCatalogDataset('handraw-style.json') || {}
    const cases = Array.isArray(parsedHandraw.cases) ? parsedHandraw.cases : []
    sources.push({
      id: 'handraw-style',
      label: 'Handraw Style (Artistic & Comic Styles)',
      repository: parsedHandraw.repository || 'https://github.com/yang0/handraw-style',
      version: '2026.09',
      count: cases.length,
    })
    for (const item of cases) {
      if (!item.prompt || !item.title) continue
      const normCase = {
        id: String(item.id),
        title: String(item.title).trim(),
        prompt: String(item.prompt).trim(),
        promptPreview: String(item.promptPreview || item.prompt.slice(0, 240)).trim(),
        category: String(item.category || 'Handraw Style').trim(),
        styles: Array.isArray(item.styles) ? item.styles.map(String) : [],
        scenes: Array.isArray(item.scenes) ? item.scenes.map(String) : [],
        sourceLabel: item.sourceLabel ? String(item.sourceLabel).trim() : undefined,
        sourceUrl: item.sourceUrl ? String(item.sourceUrl).trim() : undefined,
        featured: Boolean(item.featured),
        sourceId: 'handraw-style',
      }
      allCases.push(normCase)
      if (normCase.category) categoriesSet.add(normCase.category)
      for (const s of normCase.styles) stylesSet.add(s)
    }
  } catch (err) {
    // Graceful fallback
  }

  cachedCatalog = {
    sources,
    cases: allCases,
    categories: Array.from(categoriesSet).sort(),
    styles: Array.from(stylesSet).sort(),
  }

  return cachedCatalog
}

/**
 * Searches the inspiration prompt catalog.
 *
 * @param {object} params
 * @param {string} [params.query] Keywords to search in title, prompt, styles, scenes, category
 * @param {string} [params.category] Category filter (substring or exact)
 * @param {string} [params.style] Style tag filter (substring or exact)
 * @param {string} [params.scene] Scene tag filter (substring or exact)
 * @param {'all'|'awesome-gpt-image-2'|'handraw-style'} [params.source='all'] Source filter
 * @param {string|number} [params.caseId] Specific case ID lookup
 * @param {boolean} [params.random=false] Randomly shuffle matching results
 * @param {number} [params.count=5] Number of results to return (1-50)
 * @param {number} [params.offset=0] Pagination offset
 * @returns {Promise<{
 *   totalMatches: number,
 *   returnedCount: number,
 *   sourceCount: number,
 *   cases: InspirationCase[],
 *   sources: Array<{ id: string, label: string, count: number }>
 * }>}
 */
export async function searchInspiration({
  query,
  category,
  style,
  scene,
  source = 'all',
  caseId,
  random = false,
  count = 5,
  offset = 0,
} = {}) {
  const catalog = await loadInspirationCatalog()
  let filtered = catalog.cases

  // 1. Filter by specific case ID if requested
  if (caseId !== undefined && caseId !== null && String(caseId).trim() !== '') {
    const targetId = String(caseId).trim().toLowerCase()
    const match = catalog.cases.find(c => String(c.id).toLowerCase() === targetId)
    return {
      totalMatches: match ? 1 : 0,
      returnedCount: match ? 1 : 0,
      sourceCount: catalog.cases.length,
      cases: match ? [match] : [],
      sources: catalog.sources,
    }
  }

  // 2. Filter by source
  if (source && source !== 'all') {
    filtered = filtered.filter(c => c.sourceId === source)
  }

  // 3. Filter by category
  if (category && String(category).trim() !== '') {
    const catLower = String(category).trim().toLowerCase()
    filtered = filtered.filter(c => c.category && c.category.toLowerCase().includes(catLower))
  }

  // 4. Filter by style
  if (style && String(style).trim() !== '') {
    const styleLower = String(style).trim().toLowerCase()
    filtered = filtered.filter(c => c.styles.some(s => s.toLowerCase().includes(styleLower)))
  }

  // 5. Filter by scene
  if (scene && String(scene).trim() !== '') {
    const sceneLower = String(scene).trim().toLowerCase()
    filtered = filtered.filter(c => c.scenes.some(sc => sc.toLowerCase().includes(sceneLower)))
  }

  // 6. Filter by query / keywords across fields
  if (query && String(query).trim() !== '') {
    const terms = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean)
    filtered = filtered.filter(c => {
      const searchTarget = [
        c.title,
        c.prompt,
        c.category,
        ...(c.styles || []),
        ...(c.scenes || []),
        c.sourceLabel || '',
      ].join(' ').toLowerCase()
      return terms.every(term => searchTarget.includes(term))
    })
  }

  const totalMatches = filtered.length

  // Randomize if requested
  let results = [...filtered]
  if (random && results.length > 1) {
    for (let i = results.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const temp = results[i]
      results[i] = results[j]
      results[j] = temp
    }
  }

  const safeCount = Math.max(1, Math.min(50, Number(count) || 5))
  const safeOffset = Math.max(0, Number(offset) || 0)
  const sliced = results.slice(safeOffset, safeOffset + safeCount)

  return {
    totalMatches,
    returnedCount: sliced.length,
    sourceCount: catalog.cases.length,
    cases: sliced,
    sources: catalog.sources,
  }
}

/**
 * Returns taxonomy and summary information for the catalog.
 *
 * @param {'all'|'awesome-gpt-image-2'|'handraw-style'} [source='all']
 * @returns {Promise<{
 *   totalCases: number,
 *   sources: Array<{ id: string, label: string, count: number }>,
 *   categories: string[],
 *   styles: string[]
 * }>}
 */
export async function getCatalogTaxonomy(source = 'all') {
  const catalog = await loadInspirationCatalog()
  let cases = catalog.cases
  if (source && source !== 'all') {
    cases = cases.filter(c => c.sourceId === source)
  }
  const categoriesSet = new Set()
  const stylesSet = new Set()
  for (const c of cases) {
    if (c.category) categoriesSet.add(c.category)
    for (const s of c.styles) stylesSet.add(s)
  }
  return {
    totalCases: cases.length,
    sources: catalog.sources,
    categories: Array.from(categoriesSet).sort(),
    styles: Array.from(stylesSet).sort(),
  }
}

/**
 * Formats inspiration cases into a human- and agent-readable Markdown report.
 *
 * @param {{
 *   totalMatches: number,
 *   cases: InspirationCase[],
 *   query?: string,
 *   category?: string,
 *   style?: string
 * }} results
 * @returns {string}
 */
export function formatInspirationMarkdown(results) {
  const { totalMatches = 0, cases = [], query, category, style } = results

  const filterNotes = []
  if (query) filterNotes.push(`query: "${query}"`)
  if (category) filterNotes.push(`category: "${category}"`)
  if (style) filterNotes.push(`style: "${style}"`)
  const filterDesc = filterNotes.length > 0 ? ` (${filterNotes.join(', ')})` : ''

  if (cases.length === 0) {
    return `### 💡 Inspiration Prompt Catalog\n\nNo prompts found matching your criteria${filterDesc}. Try broadening your search terms or browsing categories.`
  }

  const lines = [
    `### 💡 Inspiration Prompt Catalog (${cases.length} of ${totalMatches} matches${filterDesc})`,
    '',
  ]

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]
    lines.push(`#### ${i + 1}. ${c.title} \`#${c.id}\``)
    lines.push(`- **Category:** ${c.category} | **Source:** \`${c.sourceId}\`${c.sourceLabel ? ` (${c.sourceLabel})` : ''}`)
    if (c.styles && c.styles.length > 0) {
      lines.push(`- **Styles:** ${c.styles.join(', ')}`)
    }
    if (c.scenes && c.scenes.length > 0) {
      lines.push(`- **Scenes:** ${c.scenes.join(', ')}`)
    }
    lines.push('', '**Prompt Template:**', '```', c.prompt, '```', '')
  }

  lines.push('> **Tip:** Copy the prompt above and customize any bracketed `[PLACEHOLDERS]`, then pass directly to `generate_image` or `compare_models_matrix`.')

  return lines.join('\n')
}

/**
 * Formats taxonomy categories and styles for discovery.
 *
 * @param {{ totalCases: number, categories: string[], styles: string[], sources: Array<{ id: string, label: string, count: number }> }} taxonomy
 * @returns {string}
 */
export function formatInspirationTaxonomyMarkdown(taxonomy) {
  const lines = [
    `### 📚 Inspiration Catalog Taxonomy (${taxonomy.totalCases} Curated Prompts)`,
    '',
    '**Bundled Collections:**',
  ]
  for (const s of taxonomy.sources) {
    lines.push(`- **${s.label}**: ${s.count} prompts (\`${s.id}\`)`)
  }

  lines.push('', '**Available Categories:**')
  for (const cat of taxonomy.categories.slice(0, 30)) {
    lines.push(`- \`${cat}\``)
  }
  if (taxonomy.categories.length > 30) {
    lines.push(`- *...and ${taxonomy.categories.length - 30} more categories*`)
  }

  lines.push('', '**Popular Style Tags:**')
  for (const st of taxonomy.styles.slice(0, 30)) {
    lines.push(`- \`${st}\``)
  }
  if (taxonomy.styles.length > 30) {
    lines.push(`- *...and ${taxonomy.styles.length - 30} more styles*`)
  }

  lines.push('', '> **Next Step:** Search specific styles with `search_inspiration_prompts({ category: "...", query: "..." })`.')
  return lines.join('\n')
}
