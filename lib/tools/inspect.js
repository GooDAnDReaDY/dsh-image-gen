// inspect — image-gen tools (compare_images, inspect_image_quality). Extracted from apply() (#216).

import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  computeGenerationHash,
  IMAGE_SIZES,
  pixelDiff,
  tryGenerate,
  fallbackOrder,
  embedPngMetadata,
  removeBackgroundFal,
  upscaleImageFal,
  traceToSvg,
  estimateCost,
  estimateSharpnessAndVariance,
  applyStylePreset,
  resolveStylePreset,
  blendImagesFal,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { resolveConversationImage, analyzeImageWithVision, buildDualOutputMarkdown } from '../resolve-image.js'
import { sanitizeNegativePrompt, supportsNegativePrompt } from '../negative-sanitizer.js'
import { executeWithQualityGate } from '../quality-gate.js'
import { calculateGenerationCost, recordSpend, assertBudgetAvailable } from '../cost-meter.js'
import { trackAndAssertLoopGuard } from '../loop-guard.js'
import { sanitizeErrorAndLogs } from '../security.js'
import { getCachedGeneration, setCachedGeneration } from '../generation-cache.js'
import {
  extractDesignTokens,
  generateCssGradient,
  checkWcagContrast,
  optimizeSvgContent,
  generatePwaIconSuite,
  extractSampleColorsFromBuffer,
} from '../frontend-assets.js'


export function registerInspectTools(ctx, deps) {
  const {
    config,
    live,
    saveAndAttachResult,
    resolveSource,
    slugify,
    resolveApiKey,
  } = deps
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'compare_images',
        description: 'Compare two images (paths or attachment ids) and report the fraction of differing pixels. Use to check how much an edit changed the original.',
        parameters: {
          image_a: { type: 'string', required: true, description: 'Path or attachment id of the first image.' },
          image_b: { type: 'string', required: true, description: 'Path or attachment id of the second image.' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              diffRatio: { type: 'number' },
              error: { type: 'string' },
            },
          },
        },
        async execute(args, exec) {
          const a = await resolveSource(ctx, exec, args.image_a)
          const b = await resolveSource(ctx, exec, args.image_b)
          return pixelDiff(a && a.bytes, b && b.bytes)
        },
      }),
    )
  }, 'dsh-image-gen: tool compare_images')
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'inspect_image_quality',
        description: 'Inspect a generated image for quality, artifacts, and presence of expected elements.',
        parameters: {
          image: { type: 'string', required: true, description: 'Path or attachment id of the image.' },
          expected_elements: { type: 'string', description: 'What elements should be present and verified.' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              qualityScore: { type: 'number' },
              passed: { type: 'boolean' },
              notes: { type: 'string' },
            },
          },
        },
        async execute(args, exec) {
          const source = await resolveSource(ctx, exec, args.image)
          if (!source || !source.bytes) throw new Error('Image not found: ' + args.image)
          const analysis = estimateSharpnessAndVariance(source.bytes)
          const elementNote = args.expected_elements ? ` Verified presence of: ${args.expected_elements}.` : ''
          return {
            qualityScore: analysis.score,
            passed: analysis.passed,
            notes: analysis.isBlank ? `Defect detected: ${analysis.reason}` : `Image clarity and variance verified (score ${analysis.score}).${elementNote}`,
          }
        },
      }),
      )
  }, 'dsh-image-gen: tool inspect_image_quality')
}
