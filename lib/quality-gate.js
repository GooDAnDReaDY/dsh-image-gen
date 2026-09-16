// lib/quality-gate.js
// Automatic Quality Gate and Silent Re-roll Engine (#166)

import { estimateSharpnessAndVariance } from './providers.js'

/**
 * Inspects generated image bytes for visual defects, blank frames, or low entropy.
 *
 * @param {Buffer|Uint8Array} bytes - Image bytes
 * @param {Object} [options]
 * @param {Object} [options.ctx] - Cordis context for vision bridge integration
 * @param {string} [options.prompt] - Prompt used for generation
 * @returns {Promise<{ passed: boolean, score: number, defect: string|null, details: Object }>}
 */
export async function evaluateImageQuality(bytes, { ctx, prompt } = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || [])

  // 1. Minimum buffer check
  if (!buf || buf.length < 512) {
    return {
      passed: false,
      score: 0,
      defect: 'corrupt_buffer',
      details: { reason: 'Buffer size is too small or corrupt (< 512 bytes)', size: buf.length },
    }
  }

  // 2. Laplacian-like sharpness / variance test
  const heuristic = estimateSharpnessAndVariance(buf)
  if (!heuristic.passed || heuristic.isBlank) {
    return {
      passed: false,
      score: heuristic.score || 0.1,
      defect: 'blank_or_solid_frame',
      details: heuristic,
    }
  }

  // 3. Vision bridge integration (if available and loaded in ctx)
  let visionVerdict = null
  try {
    const visionBridge = ctx && (ctx.get?.('dsh-vision-bridge') || ctx['dsh-vision-bridge'])
    if (visionBridge && typeof visionBridge.inspectQuality === 'function') {
      visionVerdict = await visionBridge.inspectQuality({ bytes: buf, prompt })
      if (visionVerdict && visionVerdict.passed === false) {
        return {
          passed: false,
          score: visionVerdict.score ?? 0.3,
          defect: visionVerdict.defect || 'vision_rejected',
          details: { heuristic, vision: visionVerdict },
        }
      }
    }
  } catch (err) {
    // Non-fatal: if vision bridge fails or throws, fallback gracefully to heuristic result
    visionVerdict = { error: err.message }
  }

  return {
    passed: true,
    score: heuristic.score,
    defect: null,
    details: {
      heuristic,
      ...(visionVerdict ? { vision: visionVerdict } : {}),
    },
  }
}

/**
 * Runs a generation job with silent re-roll if quality gate fails.
 *
 * @param {Function} generateFn - Async function (seed) => Promise<generated>
 * @param {Object} options
 * @param {number} options.initialSeed - Base random seed
 * @param {boolean} [options.enabled=true] - Whether quality gate is enabled
 * @param {number} [options.maxRerolls=2] - Maximum silent retry attempts
 * @param {Object} [options.ctx] - Cordis context
 * @param {string} [options.prompt] - Text prompt
 * @param {Function} [options.logger] - Optional logger callback
 * @returns {Promise<{ generated: Object, qualityReport: Object }>}
 */
export async function executeWithQualityGate(generateFn, {
  initialSeed,
  enabled = true,
  maxRerolls = 2,
  ctx,
  prompt,
  logger = () => {},
}) {
  let currentSeed = initialSeed !== undefined ? initialSeed : Math.floor(Math.random() * 1000000)
  let rerolls = 0
  let lastReport = null
  let lastGenerated = null

  const attempts = enabled ? Math.max(1, maxRerolls + 1) : 1

  for (let attempt = 0; attempt < attempts; attempt++) {
    lastGenerated = await generateFn(currentSeed)

    if (!enabled) {
      return {
        generated: lastGenerated,
        qualityReport: { passed: true, score: 1.0, rerolls: 0, skipped: true },
      }
    }

    const evaluation = await evaluateImageQuality(lastGenerated.bytes, { ctx, prompt })
    lastReport = {
      passed: evaluation.passed,
      score: evaluation.score,
      defect: evaluation.defect,
      details: evaluation.details,
      rerolls,
      seedUsed: currentSeed,
    }

    if (evaluation.passed) {
      return {
        generated: lastGenerated,
        qualityReport: lastReport,
      }
    }

    // Critical defect detected, prepare silent re-roll
    rerolls++
    currentSeed = (currentSeed + 1013) % 2147483647
    logger(`Quality gate failed (${evaluation.defect}, score: ${evaluation.score}). Silent re-roll attempt ${rerolls}/${maxRerolls}...`)
  }

  // If all re-rolls exhausted, return the best we have with clear defect warning in report
  return {
    generated: lastGenerated,
    qualityReport: {
      ...lastReport,
      rerolls,
      exhausted: true,
    },
  }
}
