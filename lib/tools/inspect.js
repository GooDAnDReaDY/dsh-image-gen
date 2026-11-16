import { sanitizeErrorAndLogs } from '../security.js'
import { renderToolOutput } from "../attachment-helper.js"
import { extractComfyMetadataFromPng } from '../comfy-workflow-helpers.js'
// inspect — image-gen tools (compare_images, inspect_image_quality, extract_comfy_workflow). Extracted from apply() (#216, #525).

import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  pixelDiff,
  estimateSharpnessAndVariance,
} from '../providers.js'
import { verifyExpectedElements } from '../resolve-image.js'

export function registerInspectTools(ctx, deps, options = {}) {
  const { resolveSource } = deps
  if (!options.coreOnly) {
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
            render: (_args, value) => renderToolOutput(value),
            schema: {
              type: 'object',
              additionalProperties: true,
              properties: {
                diffRatio: { type: 'number' },
                error: { type: 'string' },
              },
            },
          },
          async execute(args, exec) {
            try {
              const a = await resolveSource(ctx, exec, args.image_a)
              const b = await resolveSource(ctx, exec, args.image_b)
              return await pixelDiff(a && a.bytes, b && b.bytes)
            } catch (err) {
              throw new Error(sanitizeErrorAndLogs(err.message || err))
            }
          },
        }),
      )
    }, 'dsh-image-gen: tool compare_images')

    ctx.effect(() => {
      ctx.tools.register(
        defineTool({
          name: 'extract_comfy_workflow',
          description: 'Extract embedded ComfyUI prompt graph and node workflow JSON from a generated PNG image file or attachment (#525).',
          parameters: {
            image: { type: 'string', required: true, description: 'Path or attachment id of the PNG image.' },
          },
          output: {
            render: (_args, value) => renderToolOutput(value),
            schema: {
              type: 'object',
              additionalProperties: true,
              properties: {
                hasWorkflow: { type: 'boolean' },
                prompt: { type: 'object', additionalProperties: true },
                workflow: { type: 'object', additionalProperties: true },
                nodeCount: { type: 'number' },
                checkpoints: { type: 'array', items: { type: 'string' } },
                loras: { type: 'array', items: { type: 'string' } },
                summary: { type: 'string' },
              },
            },
          },
          async execute(args, exec) {
            try {
              const source = await resolveSource(ctx, exec, args.image)
              if (!source || !source.bytes) throw new Error('Image not found: ' + args.image)
              const meta = extractComfyMetadataFromPng(source.bytes)
              const promptGraph = meta.prompt || {}
              const nodes = Object.values(promptGraph)
              const checkpoints = nodes
                .filter((n) => n?.class_type?.includes('CheckpointLoader') && n.inputs?.ckpt_name)
                .map((n) => n.inputs.ckpt_name)
              const loras = nodes
                .filter((n) => n?.class_type?.includes('LoraLoader') && n.inputs?.lora_name)
                .map((n) => n.inputs.lora_name)

              const hasWorkflow = Boolean(meta.prompt || meta.workflow)
              const summary = hasWorkflow
                ? `Extracted ComfyUI workflow with ${nodes.length} nodes (checkpoints: ${checkpoints.join(', ') || 'default'}, loras: ${loras.join(', ') || 'none'}).`
                : 'No embedded ComfyUI workflow metadata found in PNG.'

              return {
                hasWorkflow,
                prompt: meta.prompt,
                workflow: meta.workflow,
                nodeCount: nodes.length,
                checkpoints,
                loras,
                summary,
              }
            } catch (err) {
              throw new Error(sanitizeErrorAndLogs(err.message || err))
            }
          },
        }),
      )
    }, 'dsh-image-gen: tool extract_comfy_workflow')
  }

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
          render: (_args, value) => renderToolOutput(value),
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              qualityScore: { type: 'number' },
              passed: { type: 'boolean' },
              notes: { type: 'string' },
              elementVerification: { type: 'object', additionalProperties: true },
            },
          },
        },
        async execute(args, exec) {
          try {
            const source = await resolveSource(ctx, exec, args.image)
            if (!source || !source.bytes) throw new Error('Image not found: ' + args.image)
            const analysis = await estimateSharpnessAndVariance(source.bytes)
            // #543: honest element verification — never claim "Verified presence"
            // without an actual vision check. Without a vision service the result
            // reports verified:false with the reason instead.
            let elementVerification = null
            if (args.expected_elements) {
              elementVerification = await verifyExpectedElements(ctx, exec, source, args.expected_elements)
            }
            let passed = analysis.passed
            let notes
            if (elementVerification && elementVerification.verified && elementVerification.present === false) {
              passed = false
              notes = `Defect detected: vision check reports expected elements missing. Verdict: ${elementVerification.verdict}`
            } else {
              const elementNote = elementVerification
                ? elementVerification.verified
                  ? ` Element verification (${elementVerification.method}): presence confirmed by vision check.`
                  : ` Element presence NOT verified (${elementVerification.reason}): "${args.expected_elements}".`
                : ''
              notes = analysis.isBlank ? `Defect detected: ${analysis.reason}` : `Image clarity and variance verified (score ${analysis.score}).${elementNote}`
            }
            const result = {
              qualityScore: analysis.score,
              passed,
              notes,
            }
            if (elementVerification) result.elementVerification = elementVerification
            return result
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool inspect_image_quality')
}
