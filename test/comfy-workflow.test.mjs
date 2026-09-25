import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateComfyWorkflow,
  interpolateComfyWorkflow,
  buildDefaultComfyWorkflow,
} from '../lib/comfy-workflow-helpers.js'
import { createLocalGenerator } from '../lib/providers/backends/local.js'

test('comfy-workflow: validateComfyWorkflow parses valid objects and strings (#157)', () => {
  const valid = {
    '1': { class_type: 'KSampler', inputs: { seed: 123 } },
    '2': { class_type: 'SaveImage', inputs: {} },
  }
  const normalized = validateComfyWorkflow(valid)
  assert.equal(Object.keys(normalized).length, 2)
  assert.equal(normalized['1'].class_type, 'KSampler')

  const validStr = JSON.stringify(valid)
  const normalizedStr = validateComfyWorkflow(validStr)
  assert.equal(Object.keys(normalizedStr).length, 2)

  // Wrapped in { prompt: { ... } }
  const wrapped = { prompt: valid }
  const normalizedWrapped = validateComfyWorkflow(wrapped)
  assert.equal(Object.keys(normalizedWrapped).length, 2)

  // Errors on invalid input
  assert.throws(() => validateComfyWorkflow(''), /empty/)
  assert.throws(() => validateComfyWorkflow('invalid json'), /not valid JSON/)
  assert.throws(() => validateComfyWorkflow([]), /must be a JSON object/)
  assert.throws(() => validateComfyWorkflow({}), /contains no nodes/)
  assert.throws(() => validateComfyWorkflow({ '1': { no_class: 1 } }), /missing required "class_type"/)
})

test('comfy-workflow: interpolateComfyWorkflow substitutes all placeholders with proper types (#157)', () => {
  const template = {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: '{{seed}}',
        steps: '{{steps}}',
        cfg: '{{cfg}}',
        positive: ['6', 0],
      },
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: '{{model}}' },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: '{{width}}', height: '{{height}}' },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'high quality {{prompt}}, masterwork' },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'blurry, {{negativePrompt}}, low quality' },
    },
  }

  const interpolated = interpolateComfyWorkflow(template, {
    prompt: 'cybernetic neon panther',
    negativePrompt: 'watermark',
    seed: 42,
    width: 1280,
    height: 720,
    steps: 25,
    cfg: 6.5,
    model: 'sdxl_base.safetensors',
  })

  // Exact matches should be converted to numbers
  assert.strictEqual(interpolated['3'].inputs.seed, 42)
  assert.strictEqual(interpolated['3'].inputs.steps, 25)
  assert.strictEqual(interpolated['3'].inputs.cfg, 6.5)
  assert.strictEqual(interpolated['5'].inputs.width, 1280)
  assert.strictEqual(interpolated['5'].inputs.height, 720)

  // String substitutions
  assert.equal(interpolated['4'].inputs.ckpt_name, 'sdxl_base.safetensors')
  assert.equal(interpolated['6'].inputs.text, 'high quality cybernetic neon panther, masterwork')
  assert.equal(interpolated['7'].inputs.text, 'blurry, watermark, low quality')
})

test('comfy-workflow: createLocalGenerator uses custom workflow template when provided (#157)', async () => {
  let submittedPayload = null
  const mockFetch = async (url, opts) => {
    if (url.endsWith('/prompt')) {
      submittedPayload = JSON.parse(opts.body)
      return {
        ok: true,
        json: async () => ({ prompt_id: 'mock-pid-1' }),
      }
    }
    if (url.includes('/history/mock-pid-1')) {
      return {
        ok: true,
        json: async () => ({
          'mock-pid-1': {
            outputs: {
              '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] },
            },
          },
        }),
      }
    }
    if (url.includes('/view?filename=')) {
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      }
    }
    return { ok: false, status: 404 }
  }

  const customWorkflow = {
    '10': {
      class_type: 'CustomNode',
      inputs: { user_prompt: '{{prompt}}', seed: '{{seed}}' },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: {},
    },
  }

  const gen = createLocalGenerator(
    {
      fetchImpl: mockFetch,
      resolveKey: () => '',
      cfg: {
        localBaseURL: 'http://127.0.0.1:8188',
        localKind: 'comfyui',
        comfyWorkflowJson: JSON.stringify(customWorkflow),
        timeoutMs: 5000,
        pollIntervalMs: 50,
      },
    },
    {
      prompt: 'futuristic glass skyscraper',
      seed: 999,
      size: '1024x1024',
      format: 'png',
    }
  )

  const res = await gen()
  assert.ok(res.bytes)
  assert.equal(res.seed, 999)

  assert.ok(submittedPayload)
  assert.ok(submittedPayload.prompt)
  assert.equal(submittedPayload.prompt['10'].inputs.user_prompt, 'futuristic glass skyscraper')
  assert.strictEqual(submittedPayload.prompt['10'].inputs.seed, 999)
  assert.equal(submittedPayload.prompt.prompt, undefined, 'no double-nested prompt wrapper')
})

test('comfy-workflow: createLocalGenerator submits valid default workflow graph shape (GH#7)', async () => {
  let submittedPayload = null
  const mockFetch = async (url, opts) => {
    if (url.endsWith('/prompt')) {
      submittedPayload = JSON.parse(opts.body)
      return {
        ok: true,
        json: async () => ({ prompt_id: 'default-pid-1' }),
      }
    }
    if (url.includes('/history/default-pid-1')) {
      return {
        ok: true,
        json: async () => ({
          'default-pid-1': {
            outputs: {
              '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] },
            },
          },
        }),
      }
    }
    if (url.includes('/view?filename=')) {
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([5, 6, 7, 8]).buffer,
      }
    }
    return { ok: false, status: 404 }
  }

  const gen = createLocalGenerator(
    {
      fetchImpl: mockFetch,
      resolveKey: () => '',
      cfg: {
        localBaseURL: 'http://127.0.0.1:8188',
        localKind: 'comfyui',
        localModel: 'v1-5-pruned.safetensors',
        timeoutMs: 5000,
        pollIntervalMs: 50,
      },
    },
    {
      prompt: 'majestic snow mountain',
      seed: 12345,
      size: '512x512',
      format: 'png',
    }
  )

  const res = await gen()
  assert.ok(res.bytes)
  assert.equal(res.seed, 12345)

  assert.ok(submittedPayload, 'payload submitted')
  assert.ok(submittedPayload.prompt, 'prompt object present')
  assert.ok(submittedPayload.client_id, 'client_id present')
  // ComfyUI node IDs must be at top-level of submittedPayload.prompt (no double nesting)
  assert.equal(submittedPayload.prompt['3'].class_type, 'KSampler')
  assert.equal(submittedPayload.prompt['4'].class_type, 'CheckpointLoaderSimple')
  assert.equal(submittedPayload.prompt['5'].class_type, 'EmptyLatentImage')
  assert.equal(submittedPayload.prompt['6'].class_type, 'CLIPTextEncode')
  assert.equal(submittedPayload.prompt['7'].class_type, 'CLIPTextEncode')
  assert.equal(submittedPayload.prompt['8'].class_type, 'VAEDecode')
  assert.equal(submittedPayload.prompt['9'].class_type, 'SaveImage')
  assert.equal(submittedPayload.prompt.prompt, undefined, 'no double-nested prompt wrapper')
})
