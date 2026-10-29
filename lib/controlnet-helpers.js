// @ts-check
// controlnet-helpers.js — Local preprocessors and prompt directives for ControlNet (#463).

import sharp from 'sharp'

export const SUPPORTED_CONTROL_MODES = ['canny', 'depth', 'pose', 'sketch']

/**
 * Preprocesses a raw source image buffer into a structured ControlNet guidance map.
 *
 * @param {Buffer} imageBuffer
 * @param {'canny'|'depth'|'pose'|'sketch'} [mode='canny']
 * @returns {Promise<{ controlMapBuffer: Buffer, mode: string, width: number, height: number }>}
 */
export async function preprocessControlImage(imageBuffer, mode = 'canny') {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error('Invalid image buffer provided to preprocessControlImage')
  }

  const normMode = SUPPORTED_CONTROL_MODES.includes(mode) ? mode : 'canny'
  const meta = await sharp(imageBuffer).metadata()
  const width = meta.width || 1024
  const height = meta.height || 1024

  let pipeline = sharp(imageBuffer)

  switch (normMode) {
    case 'canny': {
      // Edge detection Laplacian kernel with noise suppression
      const edgeKernel = {
        width: 3,
        height: 3,
        kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
      }
      pipeline = pipeline
        .grayscale()
        .convolve(edgeKernel)
        .threshold(30)
      break
    }

    case 'sketch': {
      // High-contrast line art extraction
      pipeline = pipeline
        .grayscale()
        .linear(1.5, -30)
        .threshold(128)
      break
    }

    case 'depth': {
      // Spatial gradient luminance contrast mapping
      pipeline = pipeline
        .grayscale()
        .gamma(1.4)
        .normalize()
      break
    }

    case 'pose':
    default: {
      // Neutral normalized structural reference
      pipeline = pipeline
        .grayscale()
        .normalize()
      break
    }
  }

  const controlMapBuffer = await pipeline.png().toBuffer()

  return {
    controlMapBuffer,
    mode: normMode,
    width,
    height,
  }
}

/**
 * Augments generation prompt with mode-specific structural guidance directives.
 *
 * @param {string} basePrompt
 * @param {string} mode
 * @param {number} [controlStrength=0.8]
 * @returns {string}
 */
export function buildControlPrompt(basePrompt, mode, controlStrength = 0.8) {
  const cleanPrompt = String(basePrompt || '').trim()
  const strengthTag = controlStrength >= 0.8 ? 'strict' : 'calibrated'

  const directives = {
    canny: `precise structural contour alignment, ${strengthTag} edge fidelity`,
    sketch: `faithful realization of line sketch geometry, ${strengthTag} shape composition`,
    depth: `accurate 3D depth-map layering, ${strengthTag} spatial perspective`,
    pose: `exact anatomical pose alignment, ${strengthTag} body posture match`,
  }

  const directive = directives[mode] || directives.canny
  return `${cleanPrompt}, ${directive}`
}

/**
 * Formats Markdown presentation output for ControlNet generations.
 *
 * @param {object} params
 * @param {string} params.prompt
 * @param {string} params.mode
 * @param {number} params.controlStrength
 * @param {string} [params.controlMapUrl]
 * @param {string} [params.finalImageUrl]
 * @param {string} [params.path]
 * @param {number} [params.seed]
 * @returns {string}
 */
export function formatControlNetMarkdown({
  prompt,
  mode,
  controlStrength,
  controlMapUrl,
  finalImageUrl,
  path,
  seed,
}) {
  const lines = [
    `### ControlNet Guided Generation (${String(mode || 'canny').toUpperCase()})`,
    `**Prompt:** *${prompt}*`,
    `**Control Mode:** \`${mode}\` | **Strength:** \`${controlStrength}\`${seed ? ` | **Seed:** \`${seed}\`` : ''}`,
    '',
  ]

  if (controlMapUrl && finalImageUrl) {
    lines.push(
      '| Preprocessed Control Map | Generated Output |',
      '| :---: | :---: |',
      `| ![Control Map](${controlMapUrl}) | ![Generated Output](${finalImageUrl}) |`,
      '',
    )
  } else if (finalImageUrl) {
    lines.push(`![Generated Output](${finalImageUrl})`, '')
  }

  if (path) {
    lines.push(`**Saved to:** \`${path}\``)
  }

  return lines.join('\n')
}

