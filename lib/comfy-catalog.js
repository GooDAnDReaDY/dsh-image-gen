// lib/comfy-catalog.js — Vetted ComfyUI workflow catalog with dependency validation (#433)
import { interpolateComfyWorkflow, validateComfyWorkflow } from './comfy-workflow-helpers.js'

/**
 * Catalog of vetted ComfyUI workflow templates.
 * Based on official Comfy-Org workflow templates under Apache-2.0 license.
 */
export const COMFY_TEMPLATES = [
  {
    id: 'txt2img_sdxl',
    name: 'SDXL Text to Image',
    description: 'High-quality direct text-to-image synthesis using SDXL Base architecture.',
    version: '1.0.0',
    source: 'Comfy-Org/workflow_templates',
    license: 'Apache-2.0',
    category: 'generation',
    requiredNodes: [
      'KSampler',
      'CheckpointLoaderSimple',
      'EmptyLatentImage',
      'CLIPTextEncode',
      'VAEDecode',
      'SaveImage',
    ],
    requiredModels: [
      'sd_xl_base_1.0.safetensors',
    ],
    inputs: [
      { name: 'prompt', type: 'string', required: true, description: 'Positive prompt description' },
      { name: 'negativePrompt', type: 'string', default: 'blurry, low quality, artifacts', description: 'Negative prompt' },
      { name: 'width', type: 'number', default: 1024, description: 'Image width in pixels' },
      { name: 'height', type: 'number', default: 1024, description: 'Image height in pixels' },
      { name: 'steps', type: 'number', default: 25, description: 'Sampling steps' },
      { name: 'cfg', type: 'number', default: 7.0, description: 'Classifier-free guidance scale' },
      { name: 'seed', type: 'number', default: 0, description: 'RNG seed' },
    ],
    graph: {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: '{{seed}}',
          steps: '{{steps}}',
          cfg: '{{cfg}}',
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
        inputs: { ckpt_name: '{{model}}' },
      },
      '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: '{{prompt}}', clip: ['4', 1] },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: { text: '{{negativePrompt}}', clip: ['4', 1] },
      },
      '8': {
        class_type: 'VAEDecode',
        inputs: { samples: ['3', 0], vae: ['4', 2] },
      },
      '9': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'dsh_sdxl', images: ['8', 0] },
      },
    },
  },
  {
    id: 'img2img_sdxl',
    name: 'SDXL Image to Image Refinement',
    description: 'Refines and restyles existing images with guided prompt and adjustable denoise strength.',
    version: '1.0.0',
    source: 'Comfy-Org/workflow_templates',
    license: 'Apache-2.0',
    category: 'editing',
    requiredNodes: [
      'KSampler',
      'CheckpointLoaderSimple',
      'LoadImage',
      'VAEEncode',
      'CLIPTextEncode',
      'VAEDecode',
      'SaveImage',
    ],
    requiredModels: [
      'sd_xl_base_1.0.safetensors',
    ],
    inputs: [
      { name: 'image', type: 'string', required: true, description: 'Base image path or base64' },
      { name: 'prompt', type: 'string', required: true, description: 'Refinement guidance prompt' },
      { name: 'negativePrompt', type: 'string', default: 'low quality, artifacts' },
      { name: 'denoise', type: 'number', default: 0.65, description: 'Denoising transformation strength' },
      { name: 'steps', type: 'number', default: 25 },
      { name: 'cfg', type: 'number', default: 7.0 },
      { name: 'seed', type: 'number', default: 0 },
    ],
    graph: {
      '1': {
        class_type: 'LoadImage',
        inputs: { image: '{{image}}' },
      },
      '2': {
        class_type: 'VAEEncode',
        inputs: { pixels: ['1', 0], vae: ['4', 2] },
      },
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: '{{seed}}',
          steps: '{{steps}}',
          cfg: '{{cfg}}',
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: '{{denoise}}',
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['2', 0],
        },
      },
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: '{{model}}' },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: '{{prompt}}', clip: ['4', 1] },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: { text: '{{negativePrompt}}', clip: ['4', 1] },
      },
      '8': {
        class_type: 'VAEDecode',
        inputs: { samples: ['3', 0], vae: ['4', 2] },
      },
      '9': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'dsh_img2img', images: ['8', 0] },
      },
    },
  },
  {
    id: 'face_instantid',
    name: 'Facial Identity InstantID Transfer',
    description: 'Transfers facial identity and likeness from reference photo onto synthesized character.',
    version: '1.0.0',
    source: 'InstantID/ComfyUI',
    license: 'Apache-2.0',
    category: 'identity',
    requiredNodes: [
      'KSampler',
      'CheckpointLoaderSimple',
      'LoadImage',
      'ApplyInstantID',
      'InstantIDModelLoader',
      'SaveImage',
    ],
    requiredModels: [
      'ip-adapter-instantid_sdxl.bin',
    ],
    inputs: [
      { name: 'face_image', type: 'string', required: true, description: 'Source portrait image for identity extraction' },
      { name: 'prompt', type: 'string', required: true, description: 'Scene and clothing prompt' },
      { name: 'face_weight', type: 'number', default: 0.8, description: 'Facial identity similarity weight (0.0 - 1.0)' },
      { name: 'steps', type: 'number', default: 30 },
      { name: 'seed', type: 'number', default: 0 },
    ],
    graph: {
      '1': {
        class_type: 'LoadImage',
        inputs: { image: '{{face_image}}' },
      },
      '2': {
        class_type: 'InstantIDModelLoader',
        inputs: { instantid_file: 'ip-adapter-instantid_sdxl.bin' },
      },
      '3': {
        class_type: 'ApplyInstantID',
        inputs: {
          instantid: ['2', 0],
          image: ['1', 0],
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          weight: '{{face_weight}}',
        },
      },
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: '{{model}}' },
      },
      '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width: 1024, height: 1024, batch_size: 1 },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: '{{prompt}}', clip: ['4', 1] },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: { text: '{{negativePrompt}}', clip: ['4', 1] },
      },
      '8': {
        class_type: 'KSampler',
        inputs: {
          seed: '{{seed}}',
          steps: '{{steps}}',
          cfg: 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          model: ['3', 0],
          positive: ['3', 1],
          negative: ['3', 2],
          latent_image: ['5', 0],
        },
      },
      '9': {
        class_type: 'VAEDecode',
        inputs: { samples: ['8', 0], vae: ['4', 2] },
      },
      '10': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'dsh_faceid', images: ['9', 0] },
      },
    },
  },
  {
    id: 'upscale_esrgan',
    name: 'Real-ESRGAN Model Upscaler',
    description: 'High-fidelity 4x super-resolution restoration via dedicated Real-ESRGAN neural upscaler.',
    version: '1.0.0',
    source: 'Comfy-Org/workflow_templates',
    license: 'Apache-2.0',
    category: 'upscale',
    requiredNodes: [
      'LoadImage',
      'UpscaleModelLoader',
      'ImageUpscaleWithModel',
      'SaveImage',
    ],
    requiredModels: [
      'RealESRGAN_x4plus.pth',
    ],
    inputs: [
      { name: 'image', type: 'string', required: true, description: 'Source low-resolution image' },
      { name: 'upscale_model', type: 'string', default: 'RealESRGAN_x4plus.pth', description: 'Upscaler model filename' },
    ],
    graph: {
      '1': {
        class_type: 'LoadImage',
        inputs: { image: '{{image}}' },
      },
      '2': {
        class_type: 'UpscaleModelLoader',
        inputs: { model_name: '{{upscale_model}}' },
      },
      '3': {
        class_type: 'ImageUpscaleWithModel',
        inputs: {
          upscale_model: ['2', 0],
          image: ['1', 0],
        },
      },
      '4': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'dsh_upscale', images: ['3', 0] },
      },
    },
  },
]

/**
 * Returns summary list of all vetted ComfyUI templates.
 */
export function getComfyTemplates() {
  return COMFY_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    version: t.version,
    source: t.source,
    license: t.license,
    category: t.category,
    requiredNodes: [...t.requiredNodes],
    requiredModels: [...t.requiredModels],
    inputs: t.inputs.map((inp) => ({ ...inp })),
  }))
}

/**
 * Returns full template definition by ID or null.
 */
export function getComfyTemplate(id) {
  if (!id) return null
  return COMFY_TEMPLATES.find((t) => t.id === id) || null
}

/**
 * Validates whether the ComfyUI server satisfies the dependencies required by a workflow template (#433).
 * Explicitly distinguishes server reachability failures from missing node/model dependencies.
 *
 * @param {string} baseURL ComfyUI server address (e.g. http://127.0.0.1:8188)
 * @param {object} template Template definition from getComfyTemplate
 * @param {object} options
 * @returns {Promise<{ ok: boolean, missingNodes: string[], missingModels: string[], error?: string }>}
 */
export function createComfyDependencyValidator({ fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  return async function validateComfyServerDependencies(baseURL, template) {
    const base = String(baseURL || '').replace(/\/+$/, '')
    if (!base) {
      throw new Error('ComfyUI server URL is not configured')
    }
    if (!template) {
      throw new Error('Template is required for dependency validation')
    }

    let objectInfo
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
      const timer = controller ? setTimeout(() => controller.abort(new Error('timeout')), timeoutMs) : null
      const res = await fetchImpl(`${base}/object_info`, {
        signal: controller ? controller.signal : undefined,
      })
      if (timer) clearTimeout(timer)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from /object_info`)
      }
      objectInfo = await res.json()
    } catch (err) {
      // Re-throw server reachability error without masking it as a missing model error
      const msg = err?.name === 'AbortError' ? 'connection timed out' : (err?.message || String(err))
      throw new Error(`ComfyUI server is unreachable at ${base} (${msg})`)
    }

    if (!objectInfo || typeof objectInfo !== 'object') {
      throw new Error(`ComfyUI server at ${base} returned invalid object_info`)
    }

    const availableNodes = new Set(Object.keys(objectInfo))
    const missingNodes = (template.requiredNodes || []).filter((node) => !availableNodes.has(node))

    // Model validation: inspect choices provided in CheckpointLoaderSimple or UpscaleModelLoader
    const missingModels = []
    if (template.requiredModels && template.requiredModels.length > 0) {
      const ckptInfo = objectInfo.CheckpointLoaderSimple
      const availableCkpts = Array.isArray(ckptInfo?.input?.required?.ckpt_name?.[0])
        ? new Set(ckptInfo.input.required.ckpt_name[0])
        : null

      const upscaleInfo = objectInfo.UpscaleModelLoader
      const availableUpscalers = Array.isArray(upscaleInfo?.input?.required?.model_name?.[0])
        ? new Set(upscaleInfo.input.required.model_name[0])
        : null

      for (const model of template.requiredModels) {
        if (model.endsWith('.pth') || model.endsWith('.pt')) {
          if (availableUpscalers && !availableUpscalers.has(model)) {
            missingModels.push(model)
          }
        } else if (model.endsWith('.safetensors') || model.endsWith('.ckpt')) {
          if (availableCkpts && !availableCkpts.has(model)) {
            missingModels.push(model)
          }
        }
      }
    }

    if (missingNodes.length > 0 || missingModels.length > 0) {
      const errors = []
      if (missingNodes.length > 0) errors.push(`missing custom nodes: ${missingNodes.join(', ')}`)
      if (missingModels.length > 0) errors.push(`missing model files: ${missingModels.join(', ')}`)
      return {
        ok: false,
        missingNodes,
        missingModels,
        error: `ComfyUI dependencies missing for template "${template.name}": ${errors.join('; ')}`,
      }
    }

    return {
      ok: true,
      missingNodes: [],
      missingModels: [],
    }
  }
}

/**
 * Prepares an executable ComfyUI workflow graph from a vetted template and user parameters.
 *
 * @param {string} templateId
 * @param {object} params
 * @returns {object} validated, interpolated workflow graph
 */
export function prepareComfyWorkflowFromTemplate(templateId, params = {}) {
  const template = getComfyTemplate(templateId)
  if (!template) {
    throw new Error(`ComfyUI template "${templateId}" not found`)
  }

  // Validate required inputs
  for (const input of template.inputs) {
    if (input.required && (params[input.name] === undefined || params[input.name] === null || params[input.name] === '')) {
      throw new Error(`Template "${template.name}" requires input "${input.name}"`)
    }
  }

  // Apply default inputs if omitted
  const merged = {}
  for (const input of template.inputs) {
    if (input.default !== undefined) {
      merged[input.name] = input.default
    }
  }
  Object.assign(merged, params)

  const graph = interpolateComfyWorkflow(template.graph, merged)
  return validateComfyWorkflow(graph)
}
