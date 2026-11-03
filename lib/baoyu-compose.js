// @ts-check
// baoyu-compose.js — 5-dimension style & composition prompt assembler (#505).
// Assembles precise artistic, editorial, and cover image prompts using the 5-dimensional
// design system (Type, Palette with calibrated hex codes, Rendering, Mood, and Text Hierarchy).

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_PATH = path.join(__dirname, 'inspiration', 'data', 'baoyu-compose.json')

let cachedData = null

async function loadData() {
  if (cachedData) return cachedData
  try {
    const raw = await readFile(DATA_PATH, 'utf8')
    cachedData = JSON.parse(raw)
  } catch (_err) {
    cachedData = {
      types: [],
      palettes: [],
      renderings: [],
      moods: [],
      textLevels: [],
    }
  }
  return cachedData
}

export const BAOYU_LABELS_ZH = {
  hero: '主视觉大图',
  conceptual: '概念抽象',
  typography: '文字主导',
  metaphor: '隐喻象征',
  scene: '氛围场景',
  minimal: '极简留白',
  warm: '暖色',
  cool: '冷色',
  dark: '暗色',
  earth: '大地色',
  elegant: '优雅',
  macaron: '马卡龙',
  mono: '单色',
  pastel: '粉彩',
  retro: '复古',
  duotone: '双色调',
  vivid: '高饱和',
  'flat-vector': '扁平矢量',
  pixel: '像素风',
  digital: '数字插画',
  'hand-drawn': '手绘',
  painterly: '绘画感',
  chalk: '粉笔',
  'screen-print': '丝网印刷',
  none: '无文字',
  'title-only': '仅标题',
  'title-subtitle': '标题+副标题',
  'text-rich': '丰富文字',
  subtle: '含蓄',
  balanced: '均衡',
  bold: '强烈',
}

export const BAOYU_DEFAULT_SELECTION = {
  type: 'metaphor',
  palette: 'warm',
  rendering: 'flat-vector',
  text: 'title-only',
  mood: 'balanced',
  title: '',
}

/**
 * Returns full taxonomy of Baoyu design dimensions.
 *
 * @returns {Promise<{
 *   types: Array<{ id: string, description: string, composition: string }>,
 *   palettes: Array<{ id: string, tagline: string, colors: Array<{ role: string, name: string, hex: string }> }>,
 *   renderings: Array<{ id: string, tagline: string, lines: string[], texture: string[], depth: string[], elements: string[] }>,
 *   moods: Array<{ id: string, application: string }>,
 *   textLevels: Array<{ id: string, area: string }>,
 *   labelsZh: Record<string, string>
 * }>}
 */
export async function getBaoyuTaxonomy() {
  const data = await loadData()
  return {
    types: data.types || [],
    palettes: data.palettes || [],
    renderings: data.renderings || [],
    moods: data.moods || [],
    textLevels: data.textLevels || [],
    labelsZh: BAOYU_LABELS_ZH,
  }
}

/**
 * Assembles 5-dimensional selection into a high-precision prompt.
 *
 * @param {object} params
 * @param {string} [params.title='']
 * @param {string} [params.type='metaphor']
 * @param {string} [params.palette='warm']
 * @param {string} [params.rendering='flat-vector']
 * @param {string} [params.text='title-only']
 * @param {string} [params.mood='balanced']
 * @returns {Promise<{
 *   prompt: string,
 *   selection: { title: string, type: string, palette: string, rendering: string, text: string, mood: string },
 *   summary: string
 * }>}
 */
export async function composeBaoyuPrompt({
  title = '',
  type = 'metaphor',
  palette = 'warm',
  rendering = 'flat-vector',
  text = 'title-only',
  mood = 'balanced',
} = {}) {
  const data = await loadData()

  const chosenType = data.types.find(t => t.id === type) || data.types.find(t => t.id === 'metaphor') || data.types[0]
  const chosenPalette = data.palettes.find(p => p.id === palette) || data.palettes.find(p => p.id === 'warm') || data.palettes[0]
  const chosenRendering = data.renderings.find(r => r.id === rendering) || data.renderings.find(r => r.id === 'flat-vector') || data.renderings[0]
  const chosenText = data.textLevels.find(tl => tl.id === text) || data.textLevels.find(tl => tl.id === 'title-only') || data.textLevels[0]
  const chosenMood = data.moods.find(m => m.id === mood) || data.moods.find(m => m.id === 'balanced') || data.moods[0]

  const cleanTitle = String(title || '').trim()

  const primaryColors = (chosenPalette?.colors || []).filter(c => c.role?.startsWith('Primary'))
  const backgroundColors = (chosenPalette?.colors || []).filter(c => c.role?.startsWith('Background'))
  const accentColors = (chosenPalette?.colors || []).filter(c => c.role?.startsWith('Accent'))
  const swatch = (colors) => colors.map(c => `${c.name} ${c.hex}`).join(', ')

  let textElements = 'No text elements; the full area stays purely visual.'
  if (chosenText?.id !== 'none' && cleanTitle) {
    const lines = [`Title: "${cleanTitle}"`]
    if (chosenText.id === 'title-subtitle' || chosenText.id === 'text-rich') {
      lines.push('Subtitle: derive one short supporting line from the title')
    }
    if (chosenText.id === 'text-rich') {
      lines.push('Tags: derive 2-3 keyword badges from the title')
    }
    textElements = lines.join('\n')
  }

  const pairNote = chosenPalette?.pairs && chosenPalette.pairs.length > 0
    ? `\n- Duotone pair: pick ONE dominant two-color pair from ${chosenPalette.pairs.map(p => `${p.name} (${p.a} + ${p.b})`).join('; ')}`
    : ''

  const prompt = [
    'Cover image.',
    '',
    '# Visual Design',
    `- Type: ${chosenType?.id || type} — ${chosenType?.composition || ''}`,
    `- Palette: ${chosenPalette?.id || palette} (${chosenPalette?.tagline || ''})`,
    `- Rendering: ${chosenRendering?.id || rendering} — ${chosenRendering?.tagline || ''}`,
    `- Text level: ${chosenText?.id || text} (${chosenText?.area || ''})`,
    `- Mood: ${chosenMood?.id || mood} — ${chosenMood?.application || ''}`,
    '',
    '# Text Elements',
    textElements,
    '',
    '# Composition',
    `- Type composition: ${chosenType?.composition || ''}`,
    '- Layout: generous whitespace (40-60% breathing room); one dominant focal point with 1-2 supporting elements plus decorative accents; main visual centered or slightly left, reserving the right side for the title when included.',
    `- Decorative: ${(chosenPalette?.decorativeHints || []).join('; ')}`,
    '',
    '# Color Scheme',
    `- Primary: ${swatch(primaryColors) || 'balanced primary'}`,
    `- Background: ${swatch(backgroundColors) || 'light neutral'}`,
    `- Accent: ${swatch(accentColors) || 'vibrant accent'}${pairNote}`,
    `- Mood adjustment: ${chosenMood?.application || ''}`,
    '- Color constraint: Color values (#hex) and color names are rendering guidance only — do NOT display color names, hex codes, or palette labels as visible text in the image.',
    '',
    `# Rendering Notes (${chosenRendering?.id || rendering})`,
    `- Lines: ${(chosenRendering?.lines || []).join('; ')}`,
    `- Texture: ${(chosenRendering?.texture || []).join('; ')}`,
    `- Depth: ${(chosenRendering?.depth || []).join('; ')}`,
    `- Elements: ${(chosenRendering?.elements || []).join('; ')}`,
    '',
    '# Core Principles',
    '- Ample whitespace, highlight the core message, avoid cluttered layouts.',
    '- Simplified silhouettes for any characters — no realistic human faces or bodies.',
    '- Icon-based vocabulary: represent concepts with simple, recognizable icons.',
  ].join('\n')

  const selection = {
    title: cleanTitle,
    type: chosenType?.id || type,
    palette: chosenPalette?.id || palette,
    rendering: chosenRendering?.id || rendering,
    text: chosenText?.id || text,
    mood: chosenMood?.id || mood,
  }

  const summary = [
    `### 🎨 Baoyu 5D Prompt Assembled: *"${cleanTitle || selection.type}"*`,
    `- **Type:** \`${selection.type}\` (${chosenType?.description || ''})`,
    `- **Palette:** \`${selection.palette}\` (${chosenPalette?.tagline || ''})`,
    `- **Rendering:** \`${selection.rendering}\` (${chosenRendering?.tagline || ''})`,
    `- **Mood:** \`${selection.mood}\` | **Text Level:** \`${selection.text}\``,
    '',
    '```markdown',
    prompt,
    '```',
    '',
    '> **Tip:** Pass this assembled prompt to `generate_image` or `compare_models_matrix` for production rendering.',
  ].join('\n')

  return {
    prompt,
    selection,
    summary,
  }
}
