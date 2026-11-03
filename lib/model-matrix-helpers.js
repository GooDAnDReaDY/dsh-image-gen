// @ts-check
// model-matrix-helpers.js — Model shootout comparison matrix helpers (#503).
// Handles multi-model parsing, target settings adaptation, and Sharp contact sheet compositing.

import sharp from 'sharp'
import { ASPECT_RATIOS } from './providers.js'

/**
 * Model resolution and ratio capabilities map.
 */
export const MODEL_CAPABILITIES = {
  'gemini': {
    defaultModel: 'imagen-3',
    supportedRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
    label: 'Google Imagen 3',
  },
  'fal': {
    defaultModel: 'flux-dev',
    supportedRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
    label: 'FAL FLUX',
  },
  'replicate': {
    defaultModel: 'flux-schnell',
    supportedRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2'],
    label: 'Replicate FLUX',
  },
  'seedream': {
    defaultModel: 'seedream-3',
    supportedRatios: ['1:1', '16:9', '4:3', '3:4', '9:16'],
    label: 'Seedream 3.0',
  },
  'openai': {
    defaultModel: 'dall-e-3',
    supportedRatios: ['1:1', '16:9', '9:16'],
    label: 'OpenAI DALL-E 3',
  },
  'custom': {
    defaultModel: 'default',
    supportedRatios: ['1:1', '16:9', '4:3', '3:4'],
    label: 'Custom OpenAI-Compat',
  },
  'local': {
    defaultModel: 'sd-xl',
    supportedRatios: ['1:1', '16:9', '4:3', '3:4'],
    label: 'Local ComfyUI / SD',
  },
}

/**
 * Known model aliases to provider mapping.
 */
const MODEL_ALIASES = {
  'imagen-3': { provider: 'gemini', model: 'imagen-3', label: 'Google Imagen 3' },
  'imagen-3.0': { provider: 'gemini', model: 'imagen-3', label: 'Google Imagen 3' },
  'gemini/imagen-3': { provider: 'gemini', model: 'imagen-3', label: 'Google Imagen 3' },
  'flux-dev': { provider: 'fal', model: 'flux-dev', label: 'FLUX Dev (FAL)' },
  'fal/flux-dev': { provider: 'fal', model: 'flux-dev', label: 'FLUX Dev (FAL)' },
  'flux-schnell': { provider: 'replicate', model: 'flux-schnell', label: 'FLUX Schnell (Replicate)' },
  'replicate/flux-schnell': { provider: 'replicate', model: 'flux-schnell', label: 'FLUX Schnell (Replicate)' },
  'seedream': { provider: 'seedream', model: 'seedream-3', label: 'Seedream 3.0' },
  'seedream/seedream-3': { provider: 'seedream', model: 'seedream-3', label: 'Seedream 3.0' },
  'dall-e-3': { provider: 'openai', model: 'dall-e-3', label: 'OpenAI DALL-E 3' },
  'dalle3': { provider: 'openai', model: 'dall-e-3', label: 'OpenAI DALL-E 3' },
  'openai/dall-e-3': { provider: 'openai', model: 'dall-e-3', label: 'OpenAI DALL-E 3' },
}

/**
 * Parses raw model identifier string into provider and model.
 *
 * @param {string} raw
 * @param {string} [fallbackProvider='fal']
 * @returns {{ provider: string, model: string, label: string }}
 */
export function parseModelIdentifier(raw, fallbackProvider = 'fal') {
  const s = String(raw || '').trim().toLowerCase()
  if (MODEL_ALIASES[s]) {
    return { ...MODEL_ALIASES[s] }
  }

  if (s.includes('/')) {
    const [p, ...rest] = s.split('/')
    const m = rest.join('/')
    const cap = MODEL_CAPABILITIES[p]
    return {
      provider: p,
      model: m || cap?.defaultModel || 'default',
      label: `${cap?.label || p} (${m})`,
    }
  }

  if (MODEL_CAPABILITIES[s]) {
    const cap = MODEL_CAPABILITIES[s]
    return {
      provider: s,
      model: cap.defaultModel,
      label: cap.label,
    }
  }

  return {
    provider: fallbackProvider,
    model: s || 'default',
    label: `${fallbackProvider.toUpperCase()} (${s || 'default'})`,
  }
}

/**
 * Builds adapted comparison targets for multi-model shootout.
 *
 * @param {object} params
 * @param {string[]} [params.models]
 * @param {string} [params.requestedRatio='1:1']
 * @param {string} [params.requestedQuality='standard']
 * @param {object} [params.cfg]
 * @returns {Array<{
 *   id: string,
 *   provider: string,
 *   model: string,
 *   label: string,
 *   ratio: string,
 *   aspectPixels: [number, number],
 *   quality: string,
 *   adjusted: boolean
 * }>}
 */
export function buildComparisonTargets({
  models,
  requestedRatio = '1:1',
  requestedQuality = 'standard',
  cfg = {},
} = {}) {
  let targetList = Array.isArray(models) && models.length > 0 ? models : []

  // If no models provided, use intelligent defaults based on configured providers
  if (targetList.length === 0) {
    const active = cfg.provider || 'fal'
    const popularCandidates = ['fal/flux-dev', 'gemini/imagen-3', 'replicate/flux-schnell', 'seedream/seedream-3']
    targetList = [active, ...popularCandidates.filter(c => !c.startsWith(active))].slice(0, 3)
  }

  const seenKeys = new Set()
  const result = []

  for (const raw of targetList) {
    const parsed = parseModelIdentifier(raw, cfg.provider || 'fal')
    const uniqueKey = `${parsed.provider}:${parsed.model}`
    if (seenKeys.has(uniqueKey)) continue
    seenKeys.add(uniqueKey)

    const cap = MODEL_CAPABILITIES[parsed.provider]
    const supportedRatios = cap?.supportedRatios || ['1:1', '16:9', '4:3', '3:4']
    let ratio = requestedRatio
    let adjusted = false

    if (!supportedRatios.includes(ratio)) {
      ratio = supportedRatios.includes('1:1') ? '1:1' : supportedRatios[0]
      adjusted = true
    }

    const aspectPixels = ASPECT_RATIOS[ratio] || [1024, 1024]

    result.push({
      id: `M${result.length + 1}`,
      provider: parsed.provider,
      model: parsed.model,
      label: parsed.label,
      ratio,
      aspectPixels,
      quality: requestedQuality,
      adjusted,
    })
  }

  return result
}

/**
 * Creates SVG label badge overlay for comparison contact sheet.
 *
 * @param {string} title Model label
 * @param {string} subtitle Latency & Cost info
 * @param {number} [width=260]
 * @param {number} [height=44]
 * @returns {Buffer}
 */
export function createModelBadgeSvg(title, subtitle, width = 260, height = 44) {
  const safeTitle = String(title || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const safeSubtitle = String(subtitle || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const titleY = height > 32 ? Math.round(height * 0.44) : Math.round(height * 0.65)
  const subY = Math.round(height * 0.78)
  const showSub = height > 32 && safeSubtitle.length > 0

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" rx="6" fill="#0A0D14" fill-opacity="0.88" stroke="#38BDF8" stroke-opacity="0.5" stroke-width="1.2"/>
  <circle cx="12" cy="${Math.round(height / 2)}" r="4" fill="#10B981" />
  <text x="22" y="${titleY}" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="11" letter-spacing="0.3">${safeTitle}</text>
  ${showSub ? `<text x="22" y="${subY}" fill="#94A3B8" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="500" font-size="9.5">${safeSubtitle}</text>` : ''}
</svg>`
  return Buffer.from(svg)
}

/**
 * Composites successful shootout candidates into a side-by-side contact sheet.
 *
 * @param {object} params
 * @param {Array<{ bytes: Buffer, label: string, durationMs: number, cost?: number }>} params.tiles
 * @param {number} [params.tileWidth=512]
 * @param {number} [params.tileHeight=512]
 * @returns {Promise<Buffer>}
 */
export async function compositeModelMatrixContactSheet({
  tiles,
  tileWidth = 512,
  tileHeight = 512,
}) {
  const validTiles = tiles.filter(t => t && t.bytes)
  if (validTiles.length === 0) {
    throw new Error('No valid image tiles provided to composite comparison contact sheet.')
  }

  const count = validTiles.length
  let cols = count
  let rows = 1

  if (count === 4) {
    cols = 2
    rows = 2
  } else if (count > 3) {
    cols = Math.ceil(Math.sqrt(count))
    rows = Math.ceil(count / cols)
  }

  const totalW = cols * tileWidth
  const totalH = rows * tileHeight

  const compositeInputs = []

  for (let idx = 0; idx < count; idx++) {
    const tile = validTiles[idx]
    const r = Math.floor(idx / cols)
    const c = idx % cols
    const top = r * tileHeight
    const left = c * tileWidth

    const resized = await sharp(tile.bytes)
      .resize(tileWidth, tileHeight, { fit: 'cover' })
      .toBuffer()

    compositeInputs.push({
      input: resized,
      top,
      left,
    })

    const durationSec = Math.round((tile.durationMs || 0) / 100) / 10
    const costStr = tile.cost !== undefined ? ` · $${tile.cost.toFixed(3)}` : ''
    const subtitle = `${durationSec}s latency${costStr}`

    const badgeW = Math.max(60, Math.min(260, tileWidth - 20))
    const badgeH = Math.max(20, Math.min(44, Math.round(tileHeight * 0.3)))
    const badgeBuffer = createModelBadgeSvg(tile.label, subtitle, badgeW, badgeH)

    compositeInputs.push({
      input: badgeBuffer,
      top: top + 8,
      left: left + 8,
    })
  }

  const sheet = await sharp({
    create: {
      width: totalW,
      height: totalH,
      channels: 4,
      background: { r: 10, g: 13, b: 20, alpha: 1 },
    },
  })
    .composite(compositeInputs)
    .png()
    .toBuffer()

  return sheet
}

/**
 * Formats Markdown presentation table for model comparison matrix.
 *
 * @param {object} params
 * @param {string} params.prompt
 * @param {number} params.totalDurationMs
 * @param {string} [params.contactSheetUrl]
 * @param {Array<{
 *   id: string,
 *   provider: string,
 *   model: string,
 *   label: string,
 *   success: boolean,
 *   durationMs: number,
 *   cost?: number,
 *   url?: string,
 *   path?: string,
 *   error?: string
 * }>} params.results
 * @returns {string}
 */
export function formatModelMatrixMarkdown({
  prompt,
  totalDurationMs,
  contactSheetUrl,
  results = [],
}) {
  const successCount = results.filter(r => r.success).length
  const totalSec = Math.round(totalDurationMs / 100) / 10

  const lines = [
    `### 🏁 Multi-Model Shootout Matrix (${successCount}/${results.length} Succeeded in ${totalSec}s)`,
    `**Prompt:** *${prompt}*`,
    '',
  ]

  if (contactSheetUrl) {
    lines.push(`![Multi-Model Comparison Grid](${contactSheetUrl})`, '')
  }

  lines.push(
    '| Model | Provider | Status | Latency | Est. Cost | Asset |',
    '| :--- | :---: | :---: | :---: | :---: | :--- |',
  )

  for (const r of results) {
    const status = r.success ? '✅ Success' : '❌ Failed'
    const latency = r.durationMs ? `${(r.durationMs / 1000).toFixed(2)}s` : '-'
    const cost = r.cost !== undefined ? `$${r.cost.toFixed(3)}` : '-'
    const asset = r.url || r.path ? `[View Image](${r.url || r.path})` : (r.error ? `*${r.error.slice(0, 40)}*` : '-')
    lines.push(
      `| **${r.label}** | \`${r.provider}\` | ${status} | ${latency} | ${cost} | ${asset} |`,
    )
  }

  // Find fastest and most cost-effective among successful models
  const successful = results.filter(r => r.success)
  if (successful.length > 1) {
    const fastest = [...successful].sort((a, b) => a.durationMs - b.durationMs)[0]
    lines.push(
      '',
      `> ⚡ **Speed Champion:** **${fastest.label}** (${(fastest.durationMs / 1000).toFixed(2)}s).`,
    )
  }

  return lines.join('\n')
}
