// Pure helpers for generate_seamless_pattern (#178)

export function buildSeamlessPrompt(motif, style, density) {
  const d = String(density || 'medium').toLowerCase()
  const densityHint = d === 'low'
    ? 'sparse motif spacing with generous empty background'
    : d === 'high'
      ? 'dense repeating motif coverage with minimal empty background'
      : 'balanced motif spacing'
  const styleBit = style ? ` Style: ${style}.` : ''
  return `Seamless tileable repeating pattern of ${motif}.${styleBit} `
    + 'Motifs must wrap continuously across left/right and top/bottom edges so the image tiles without visible seams. '
    + `Flat even lighting, orthographic top-down view, ${densityHint}. `
    + 'No vignette, no border frame, no watermark, no text.'
}

export function buildPatternCss({ className, sizePx, imagePath }) {
  const name = className || 'dsh-pattern'
  const size = sizePx || 512
  const url = imagePath || `./${name}.png`
  return `/* dsh-image-gen seamless pattern */
.${name} {
  background-image: url('${url}');
  background-repeat: repeat;
  background-size: ${size}px ${size}px;
}
`
}

export function normalizeDensity(value) {
  const v = String(value || 'medium').toLowerCase()
  if (v === 'low' || v === 'high') return v
  return 'medium'
}


/**
 * Score edge wrap continuity on raw RGBA (or RGB) pixel rows.
 * Returns 0..1 (1 = identical opposite edges). Used as a seam QA helper (#178).
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 * @param {number} [channels=4]
 */
export function scoreEdgeWrap(pixels, width, height, channels = 4) {
  if (!pixels || width < 1 || height < 1) return 0
  const stride = width * channels
  let sum = 0
  let n = 0
  // left vs right columns
  for (let y = 0; y < height; y++) {
    const row = y * stride
    for (let c = 0; c < channels; c++) {
      const l = pixels[row + c]
      const r = pixels[row + (width - 1) * channels + c]
      sum += 1 - Math.abs(l - r) / 255
      n++
    }
  }
  // top vs bottom rows
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < channels; c++) {
      const top = pixels[x * channels + c]
      const bot = pixels[(height - 1) * stride + x * channels + c]
      sum += 1 - Math.abs(top - bot) / 255
      n++
    }
  }
  return n ? sum / n : 0
}

/** Tile RGBA image into cols x rows buffer (for 2x2 / 3x3 seam visual QA). */
export function tilePixels(pixels, width, height, channels, cols, rows) {
  const outW = width * cols
  const outH = height * rows
  const out = new Uint8Array(outW * outH * channels)
  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      for (let y = 0; y < height; y++) {
        const srcOff = y * width * channels
        const dstOff = ((ry * height + y) * outW + cx * width) * channels
        out.set(pixels.subarray(srcOff, srcOff + width * channels), dstOff)
      }
    }
  }
  return { pixels: out, width: outW, height: outH }
}
