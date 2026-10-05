// vision-ocr-helpers.js — OCR text localization and seamless replacement (#180).
import { escapeXml, sanitizeSvgColor } from './security.js'

/**
 * Parses bounding box representations into normalized [x1, y1, x2, y2] (0-1000 scale).
 *
 * @param {Array<number>|string} raw
 * @param {number} [imgWidth=1000]
 * @param {number} [imgHeight=1000]
 * @returns {[number, number, number, number]|null}
 */
export function normalizeBbox(raw, imgWidth = 1000, imgHeight = 1000) {
  if (!raw) return null
  let coords = []
  if (Array.isArray(raw)) {
    coords = raw.map(Number)
  } else if (typeof raw === 'string') {
    coords = raw
      .replace(/[\[\]]/g, '')
      .split(/[,;\s]+/)
      .map(Number)
      .filter((n) => !Number.isNaN(n))
  }

  if (coords.length < 4) return null

  let [x1, y1, x2, y2] = coords
  // If coordinates exceed 1000, normalize from pixel dimensions
  if (x1 > 1000 || x2 > 1000 || y1 > 1000 || y2 > 1000) {
    x1 = Math.round((x1 / imgWidth) * 1000)
    x2 = Math.round((x2 / imgWidth) * 1000)
    y1 = Math.round((y1 / imgHeight) * 1000)
    y2 = Math.round((y2 / imgHeight) * 1000)
  }

  const minX = Math.max(0, Math.min(x1, x2))
  const maxX = Math.min(1000, Math.max(x1, x2))
  const minY = Math.max(0, Math.min(y1, y2))
  const maxY = Math.min(1000, Math.max(y1, y2))

  return [minX, minY, maxX, maxY]
}

/**
 * Builds an SVG inpaint mask from detected text bounding boxes.
 * Solid black background (#000000) with solid white rectangles (#FFFFFF) for text regions to inpaint.
 *
 * @param {number} width Image pixel width
 * @param {number} height Image pixel height
 * @param {Array<[number, number, number, number]>} bboxes Normalized [x1, y1, x2, y2]
 * @param {number} [paddingPx=8]
 * @returns {string} SVG mask document string
 */
export function buildTextInpaintMaskSvg(width, height, bboxes, paddingPx = 8) {
  const w = Math.max(1, width || 1024)
  const h = Math.max(1, height || 1024)

  const rects = (bboxes || []).map((box) => {
    const norm = normalizeBbox(box, w, h)
    if (!norm) return ''
    const [x1n, y1n, x2n, y2n] = norm
    const pxX1 = Math.max(0, Math.round((x1n / 1000) * w) - paddingPx)
    const pxY1 = Math.max(0, Math.round((y1n / 1000) * h) - paddingPx)
    const pxX2 = Math.min(w, Math.round((x2n / 1000) * w) + paddingPx)
    const pxY2 = Math.min(h, Math.round((y2n / 1000) * h) + paddingPx)
    const rectW = Math.max(1, pxX2 - pxX1)
    const rectH = Math.max(1, pxY2 - pxY1)

    return `<rect x="${pxX1}" y="${pxY1}" width="${rectW}" height="${rectH}" fill="#FFFFFF" rx="4" />`
  }).filter(Boolean).join('\n    ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#000000" />
  ${rects}
</svg>`
}

/**
 * Builds an SVG typography overlay with replacement strings placed at original coordinates.
 *
 * @param {number} width
 * @param {number} height
 * @param {Array<{ text: string, bbox: [number, number, number, number], color?: string, fontSize?: number }>} items
 * @param {string} [fontFamily='system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif']
 * @returns {string} SVG overlay document string
 */
export function buildTextOverlaySvg(width, height, items, fontFamily = 'sans-serif') {
  const w = Math.max(1, width || 1024)
  const h = Math.max(1, height || 1024)
  const safeFont = escapeXml(fontFamily)

  const textNodes = (items || []).map((item) => {
    const norm = normalizeBbox(item.bbox, w, h)
    if (!norm || !item.text) return ''
    const [x1n, y1n, x2n, y2n] = norm
    const pxX1 = Math.round((x1n / 1000) * w)
    const pxY1 = Math.round((y1n / 1000) * h)
    const boxW = Math.max(1, Math.round(((x2n - x1n) / 1000) * w))
    const boxH = Math.max(1, Math.round(((y2n - y1n) / 1000) * h))

    const computedFontSize = item.fontSize || Math.max(12, Math.round(boxH * 0.72))
    const color = sanitizeSvgColor(item.color || '#FFFFFF', '#FFFFFF')
    const centerX = pxX1 + Math.round(boxW / 2)
    const baselineY = pxY1 + Math.round(boxH * 0.75)

    // Escape XML entities
    const safeText = escapeXml(item.text)

    return `<text x="${centerX}" y="${baselineY}" text-anchor="middle" font-family="${safeFont}" font-size="${computedFontSize}" font-weight="700" fill="${color}" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.6))">${safeText}</text>`
  }).filter(Boolean).join('\n  ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${textNodes}
</svg>`
}
