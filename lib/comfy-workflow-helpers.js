// comfy-workflow-helpers.js — ComfyUI workflow JSON parser and placeholder interpolator (#157)

/**
 * Validates whether an input is a valid ComfyUI API workflow object.
 * An API workflow is either { [nodeId]: { class_type, inputs } } or { prompt: { [nodeId]: ... } }.
 *
 * @param {any} raw
 * @returns {object} normalized prompt graph { [nodeId]: { class_type, inputs } }
 */
export function validateComfyWorkflow(raw) {
  let graph = raw
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) throw new Error('ComfyUI workflow JSON is empty')
    try {
      graph = JSON.parse(trimmed)
    } catch (e) {
      throw new Error(`ComfyUI workflow is not valid JSON: ${e.message}`)
    }
  }

  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new Error('ComfyUI workflow must be a JSON object')
  }

  // Handle nested { prompt: { ... } } wrapper
  if (graph.prompt && typeof graph.prompt === 'object' && !Array.isArray(graph.prompt)) {
    graph = graph.prompt
  }

  const nodeIds = Object.keys(graph)
  if (nodeIds.length === 0) {
    throw new Error('ComfyUI workflow contains no nodes')
  }

  for (const id of nodeIds) {
    const node = graph[id]
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error(`ComfyUI node "${id}" must be an object`)
    }
    if (!node.class_type || typeof node.class_type !== 'string') {
      throw new Error(`ComfyUI node "${id}" missing required "class_type" property`)
    }
  }

  return graph
}

/**
 * Recursively replaces placeholders in a ComfyUI workflow template.
 * Supported placeholders:
 * - {{prompt}}
 * - {{negativePrompt}}
 * - {{seed}} (converted to number when exact match)
 * - {{width}} (converted to number when exact match)
 * - {{height}} (converted to number when exact match)
 * - {{steps}} (converted to number when exact match)
 * - {{cfg}} (converted to number when exact match)
 * - {{model}}
 * - {{image}}
 *
 * @param {object} workflowGraph
 * @param {object} ctx
 * @returns {object} interpolated workflow clone
 */
export function interpolateComfyWorkflow(workflowGraph, ctx) {
  const promptVal = String(ctx.prompt ?? '')
  const negVal = String(ctx.negativePrompt ?? '')
  const seedVal = Number.isFinite(ctx.seed) ? ctx.seed : 0
  const widthVal = Number.isFinite(ctx.width) ? ctx.width : 1024
  const heightVal = Number.isFinite(ctx.height) ? ctx.height : 1024
  const stepsVal = Number.isFinite(ctx.steps) ? ctx.steps : 20
  const cfgVal = Number.isFinite(ctx.cfg) ? ctx.cfg : 7
  const modelVal = String(ctx.model ?? 'v1-5-pruned-emaonly.safetensors')
  const imageVal = String(ctx.image ?? '')

  function transformValue(val) {
    if (typeof val === 'string') {
      const trimmed = val.trim()
      // Numeric exact replacements
      if (trimmed === '{{seed}}') return seedVal
      if (trimmed === '{{width}}') return widthVal
      if (trimmed === '{{height}}') return heightVal
      if (trimmed === '{{steps}}') return stepsVal
      if (trimmed === '{{cfg}}') return cfgVal

      // General string replacements
      return val
        .replace(/\{\{prompt\}\}/g, promptVal)
        .replace(/\{\{negativePrompt\}\}/g, negVal)
        .replace(/\{\{negative_prompt\}\}/g, negVal)
        .replace(/\{\{seed\}\}/g, String(seedVal))
        .replace(/\{\{width\}\}/g, String(widthVal))
        .replace(/\{\{height\}\}/g, String(heightVal))
        .replace(/\{\{steps\}\}/g, String(stepsVal))
        .replace(/\{\{cfg\}\}/g, String(cfgVal))
        .replace(/\{\{model\}\}/g, modelVal)
        .replace(/\{\{image\}\}/g, imageVal)
    }
    if (Array.isArray(val)) {
      return val.map(transformValue)
    }
    if (val && typeof val === 'object') {
      const out = {}
      for (const [k, v] of Object.entries(val)) {
        out[k] = transformValue(v)
      }
      return out
    }
    return val
  }

  return transformValue(workflowGraph)
}

/**
 * Builds the default 7-node standard ComfyUI workflow graph.
 */
export function buildDefaultComfyWorkflow({ prompt, negativePrompt, seed, width, height, model, steps, cfg }) {
  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: seed ?? 0,
        steps: steps ?? 20,
        cfg: cfg ?? 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: model || 'v1-5-pruned-emaonly.safetensors' },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt || '', clip: ['4', 1] },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativePrompt || '', clip: ['4', 1] },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['4', 2] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'dsh', images: ['8', 0] },
    },
  }
}