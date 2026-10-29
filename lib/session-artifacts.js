// lib/session-artifacts.js — Session-scoped asset cataloging and semantic file naming (#453)

import path from 'node:path'
import { resolveInside } from './security.js'

/**
 * Common English and Russian stop words, directives, and quality buzzwords
 * that carry low semantic value in generated filenames.
 */
export const STOP_WORDS = new Set([
  // English articles, prepositions, conjunctions, pronouns
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'with', 'in', 'on', 'at', 'by',
  'to', 'of', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
  'should', 'this', 'that', 'these', 'those', 'my', 'your', 'our', 'their',
  // Common generation directives & filler keywords
  'generate', 'generating', 'create', 'creating', 'make', 'making', 'draw',
  'drawing', 'render', 'rendering', 'photo', 'photograph', 'photography',
  'picture', 'image', 'artwork', 'art', 'illustration', 'graphic', 'shot',
  'ultra', 'high', 'quality', 'realistic', 'hyperrealistic', 'detailed',
  'masterpiece', 'best', 'award', 'winning', 'trending', 'artstation',
  '4k', '8k', 'hd', 'wallpaper', 'background', 'foreground', 'view',
  // Russian articles, prepositions, particles, verbs
  'и', 'в', 'во', 'на', 'с', 'со', 'по', 'к', 'ко', 'у', 'о', 'об', 'обо',
  'от', 'ото', 'из', 'изо', 'за', 'под', 'подо', 'над', 'надо', 'для',
  'как', 'так', 'что', 'это', 'этот', 'эта', 'эти', 'то', 'тот', 'та', 'те',
  'создать', 'сделай', 'нарисуй', 'изобрази', 'сгенерируй', 'генерация',
  'рисунок', 'картинка', 'картина', 'фото', 'фотография', 'изображение',
  'арт', 'иллюстрация', 'стиль', 'качестве', 'качество', 'высокое',
  'шедевр', 'обои', 'фон', 'вид', 'детализированный', 'детализированное',
  'реалистичный', 'реалистичное', 'реалистичная', 'реалистичные',
  'красивый', 'красивое', 'красивая', 'красивые',
])

/**
 * Basic slugify: lowercases, converts non-alphanumeric characters to hyphens,
 * trims repeated/edge hyphens, and truncates.
 */
export function slugifyText(input, maxLen = 48) {
  const stem = String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04FF]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/^-+|-+$/g, '')
  return stem
}

/**
 * Builds a clean, human-readable semantic slug from a generation prompt (#453).
 * Extracts key domain entities while eliminating boilerplate stop words.
 *
 * Example:
 *   buildSemanticSlug("A futuristic hero banner in cyberpunk neon style", "image", 0)
 *   => "futuristic-hero-banner-cyberpunk-v1"
 *
 * @param {string} prompt - Raw prompt or description
 * @param {string} [tool='image'] - Tool or action name fallback
 * @param {number|string} [index] - Optional batch/variant index
 * @param {number} [maxKeywords=4] - Maximum significant words to retain
 * @returns {string} Semantic slug
 */
export function buildSemanticSlug(prompt, tool = 'image', index = undefined, maxKeywords = 4) {
  const raw = String(prompt ?? '').trim()
  const rawWords = raw
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04FF]+/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)

  const significant = rawWords.filter((w) => {
    if (w.length <= 1 && !/^\d+$/.test(w)) return false
    return !STOP_WORDS.has(w)
  })

  let tokens = significant.slice(0, maxKeywords)
  if (tokens.length === 0) {
    const fallbackTool = slugifyText(tool, 24) || 'asset'
    tokens = [fallbackTool]
  }

  let slug = tokens.join('-')
  if (slug.length > 50) {
    slug = slug.slice(0, 50).replace(/-+$/, '')
  }

  if (index !== undefined && index !== null && String(index).trim() !== '') {
    if (typeof index === 'number' || /^\d+$/.test(String(index).trim())) {
      slug = `${slug}-v${Number(index) + 1}`
    } else {
      const idxStr = String(index).trim().replace(/^-+/, '')
      slug = idxStr.startsWith('v') ? `${slug}-${idxStr}` : `${slug}-v${idxStr}`
    }
  }

  return slug || 'asset-v1'
}

/**
 * Resolves a safe, URL-friendly slug representing the current conversation session (#453).
 *
 * @param {object} [session] - DSH session object from exec?.agent?.session
 * @returns {string} Session slug (e.g. "task-auth-redesign" or "session-b23d3ee0")
 */
export function resolveSessionSlug(session) {
  if (!session) return 'default-session'
  const candidate = session.header?.slug
    || session.header?.title
    || session.header?.name
    || session.slug
    || session.title
    || session.id
    || session.sessionId

  const slug = slugifyText(candidate, 40)
  return slug || 'default-session'
}

/**
 * Computes destination directory for saving generated assets (#453).
 * If `organizeBySession` is enabled (default true) and no explicit `output_dir` was specified,
 * routes to `<sessionCwd>/assets/images/<sessionSlug>/`.
 *
 * @param {object} options
 * @param {string} [options.cwd]
 * @param {string} [options.sessionCwd]
 * @param {object} [options.session]
 * @param {object} [options.cfg]
 * @param {object} [options.args]
 * @returns {string} Absolute resolved path to output directory
 */
export function resolveAssetOutputDir(options = {}) {
  const { cwd, sessionCwd, session, cfg = {}, args = {} } = options
  const root = sessionCwd || cwd || process.cwd()

  // 1. Explicit tool argument overrides defaults
  if (args.output_dir && String(args.output_dir).trim()) {
    return resolveInside(root, String(args.output_dir).trim())
  }

  // 2. Session-scoped organization (default: true)
  if (cfg.organizeBySession !== false) {
    const sessionSlug = resolveSessionSlug(session)
    return resolveInside(root, path.join('assets', 'images', sessionSlug))
  }

  // 3. Flat legacy output directory
  return resolveInside(root, cfg.outputDir || 'generated/images')
}

