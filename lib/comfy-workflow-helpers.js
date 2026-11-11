import { sanitizeErrorAndLogs } from './security.js'
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
  const samplerVal = String(ctx.samplerName ?? ctx.sampler_name ?? 'euler')
  const modelVal = String(ctx.model ?? 'v1-5-pruned-emaonly.safetensors')
  const imageVal = String(ctx.image ?? '')
  const faceImageVal = String(ctx.faceImage ?? ctx.face_image ?? '')
  const faceWeightVal = Number.isFinite(ctx.faceWeight ?? ctx.face_weight) ? (ctx.faceWeight ?? ctx.face_weight) : 0.75
  const refImageVal = String(ctx.referenceImage ?? ctx.reference_image ?? '')
  const refWeightVal = Number.isFinite(ctx.referenceWeight ?? ctx.reference_weight) ? (ctx.referenceWeight ?? ctx.reference_weight) : 0.65

  function transformValue(val) {
    if (typeof val === 'string') {
      const trimmed = val.trim()
      // Numeric exact replacements
      if (trimmed === '{{seed}}') return seedVal
      if (trimmed === '{{width}}') return widthVal
      if (trimmed === '{{height}}') return heightVal
      if (trimmed === '{{steps}}') return stepsVal
      if (trimmed === '{{cfg}}') return cfgVal
      if (trimmed === '{{sampler}}' || trimmed === '{{sampler_name}}') return samplerVal
      if (trimmed === '{{face_weight}}' || trimmed === '{{faceWeight}}') return faceWeightVal
      if (trimmed === '{{reference_weight}}' || trimmed === '{{referenceWeight}}') return refWeightVal

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
        .replace(/\{\{face_image\}\}/g, faceImageVal)
        .replace(/\{\{faceImage\}\}/g, faceImageVal)
        .replace(/\{\{face_weight\}\}/g, String(faceWeightVal))
        .replace(/\{\{faceWeight\}\}/g, String(faceWeightVal))
        .replace(/\{\{reference_image\}\}/g, refImageVal)
        .replace(/\{\{referenceImage\}\}/g, refImageVal)
        .replace(/\{\{reference_weight\}\}/g, String(refWeightVal))
        .replace(/\{\{referenceWeight\}\}/g, String(refWeightVal))
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

  const res = transformValue(workflowGraph)
  if (imageVal && res && typeof res === 'object') {
    for (const node of Object.values(res)) {
      if (node && typeof node === 'object' && node.class_type === 'LoadImage' && node.inputs) {
        if (!node.inputs.image || node.inputs.image === 'example.png' || node.inputs.image === '{{image}}') {
          node.inputs.image = imageVal
        }
      }
    }
  }
  return res
}

/**
 * Builds the default 7-node standard ComfyUI workflow graph.
 */
export function buildDefaultComfyWorkflow({ prompt, negativePrompt, seed, width, height, model, steps, cfg, sampler_name, scheduler }) {
  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: seed ?? 0,
        steps: steps ?? 20,
        cfg: cfg ?? 7,
        sampler_name: sampler_name || 'euler',
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
/**
 * Upload one source image to a remote ComfyUI instance via multipart POST /upload/image.
 * Returns the LoadImage-compatible path (subfolder/filename or filename) to inject into workflow graph (#511).
 *
 * @param {string} baseURL
 * @param {{ data: Uint8Array | Buffer, mediaType?: string }} image
 * @param {typeof fetch} [fetchImpl]
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>}
 */
export async function uploadSourceImageToComfyUI(baseURL, image, fetchImpl = fetch, signal) {
  const normBase = String(baseURL || '').replace(/\/+$/, '')
  const mediaType = image.mediaType || 'image/png'
  const ext = mediaType === 'image/jpeg' ? 'jpg' : (mediaType === 'image/webp' ? 'webp' : 'png')
  const filename = `dsh-image-gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const form = new FormData()
  const bytes = Buffer.isBuffer(image.data) ? image.data : Buffer.from(image.data)
  form.append('image', new Blob([bytes], { type: mediaType }), filename)

  const resp = await fetchImpl(`${normBase}/upload/image`, {
    method: 'POST',
    signal,
    headers: { accept: 'application/json' },
    body: form,
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    const safeMsg = sanitizeErrorAndLogs(errText.slice(0, 300))
    throw new Error(`ComfyUI image upload failed (${resp.status}): ${safeMsg}`)
  }

  const payload = await resp.json()
  if (!payload || typeof payload.name !== 'string' || !payload.name) {
    throw new Error('ComfyUI /upload/image returned invalid JSON or missing name')
  }

  const subfolder = typeof payload.subfolder === 'string' && payload.subfolder ? payload.subfolder : ''
  return subfolder ? `${subfolder}/${payload.name}` : payload.name
}

import zlib from 'node:zlib'

/**
 * Extracts embedded ComfyUI prompt graph and workflow JSON from a PNG image buffer (#525).
 * ComfyUI embeds 'prompt' (the execution API graph) and 'workflow' (the UI graph)
 * inside tEXt or iTXt PNG chunks.
 *
 * @param {Buffer|Uint8Array} buf
 * @returns {{ prompt: object | null, workflow: object | null, raw: Record<string, string> }}
 */
export function extractComfyMetadataFromPng(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('Provided buffer is not a valid PNG image')
  }

  const raw = {}
  let pos = 8

  while (pos + 8 <= bytes.length) {
    const chunkLength = bytes.readUInt32BE(pos)
    const chunkType = bytes.toString('ascii', pos + 4, pos + 8)
    const dataStart = pos + 8
    const dataEnd = dataStart + chunkLength

    if (dataEnd > bytes.length) break

    if (chunkType === 'tEXt') {
      const chunkData = bytes.subarray(dataStart, dataEnd)
      const nullIdx = chunkData.indexOf(0)
      if (nullIdx > 0) {
        const keyword = chunkData.subarray(0, nullIdx).toString('latin1')
        const text = chunkData.subarray(nullIdx + 1).toString('utf8')
        raw[keyword] = text
      }
    } else if (chunkType === 'iTXt') {
      const chunkData = bytes.subarray(dataStart, dataEnd)
      const nullIdx = chunkData.indexOf(0)
      if (nullIdx > 0) {
        const keyword = chunkData.subarray(0, nullIdx).toString('utf8')
        const compFlag = chunkData[nullIdx + 1]
        let cur = nullIdx + 3
        const null2 = chunkData.indexOf(0, cur)
        const null3 = null2 > 0 ? chunkData.indexOf(0, null2 + 1) : -1
        if (null3 > 0) {
          const textBytes = chunkData.subarray(null3 + 1)
          let text = ''
          if (compFlag === 1) {
            try {
              text = zlib.inflateSync(textBytes).toString('utf8')
            } catch (_) {
              text = textBytes.toString('utf8')
            }
          } else {
            text = textBytes.toString('utf8')
          }
          raw[keyword] = text
        }
      }
    } else if (chunkType === 'IEND') {
      break
    }

    pos = dataEnd + 4
  }

  let prompt = null
  let workflow = null

  if (raw.prompt) {
    try {
      prompt = JSON.parse(raw.prompt)
    } catch (_) { /* invalid json */ }
  }

  if (raw.workflow) {
    try {
      workflow = JSON.parse(raw.workflow)
    } catch (_) { /* invalid json */ }
  }

  return { prompt, workflow, raw }
}

/**
 * Injects LoRA loader nodes into a ComfyUI workflow graph (#529).
 *
 * @param {object} workflowGraph
 * @param {Array<{ path: string, scale?: number }>} loras
 * @returns {object} updated workflow graph
 */
export function injectLorasIntoComfyWorkflow(workflowGraph, loras) {
  if (!Array.isArray(loras) || loras.length === 0) return workflowGraph
  const graph = JSON.parse(JSON.stringify(workflowGraph))

  let ckptNodeId = null
  for (const [id, node] of Object.entries(graph)) {
    if (node?.class_type === 'CheckpointLoaderSimple' || node?.class_type === 'CheckpointLoader') {
      ckptNodeId = id
      break
    }
  }

  const existingIds = Object.keys(graph).map((id) => Number(id)).filter(Number.isFinite)
  let nextId = (existingIds.length > 0 ? Math.max(...existingIds) : 100) + 1

  let currentModelRef = ckptNodeId ? [ckptNodeId, 0] : null
  let currentClipRef = ckptNodeId ? [ckptNodeId, 1] : null

  for (const lora of loras) {
    const loraPath = lora.path || lora.lora || ''
    if (!loraPath) continue
    const scale = typeof lora.scale === 'number' ? lora.scale : 1.0
    const loraNodeId = String(nextId++)

    graph[loraNodeId] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: loraPath,
        strength_model: scale,
        strength_clip: scale,
        ...(currentModelRef ? { model: currentModelRef } : {}),
        ...(currentClipRef ? { clip: currentClipRef } : {}),
      },
    }

    currentModelRef = [loraNodeId, 0]
    currentClipRef = [loraNodeId, 1]
  }

  if (ckptNodeId && currentModelRef) {
    for (const [id, node] of Object.entries(graph)) {
      if (id === ckptNodeId || Number(id) >= (nextId - loras.length)) continue
      if (!node?.inputs) continue
      for (const [inputKey, inputVal] of Object.entries(node.inputs)) {
        if (Array.isArray(inputVal) && inputVal[0] === ckptNodeId) {
          if (inputVal[1] === 0) {
            node.inputs[inputKey] = currentModelRef
          } else if (inputVal[1] === 1) {
            node.inputs[inputKey] = currentClipRef
          }
        }
      }
    }
  }

  return graph
}
