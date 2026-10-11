import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMFY_TEMPLATES,
  getComfyTemplates,
  getComfyTemplate,
  createComfyDependencyValidator,
  prepareComfyWorkflowFromTemplate,
} from '../lib/comfy-catalog.js'
import {
  BUILTIN_RECIPES,
  getAllRecipes,
  getRecipe,
  saveCustomRecipe,
  deleteCustomRecipe,
  interpolateRecipeParams,
  executeRecipe,
} from '../lib/recipes.js'

test('comfy-catalog (#433): provides vetted templates with metadata and valid graph structure', () => {
  const templates = getComfyTemplates()
  assert.ok(templates.length >= 4, 'Should provide at least 4 vetted templates')

  const expectedIds = ['txt2img_sdxl', 'img2img_sdxl', 'face_instantid', 'upscale_esrgan']
  for (const id of expectedIds) {
    const tDef = getComfyTemplate(id)
    assert.ok(tDef, `Template ${id} should exist`)
    assert.ok(tDef.version, `Template ${id} must specify version`)
    assert.ok(tDef.source, `Template ${id} must specify source`)
    assert.equal(tDef.license, 'Apache-2.0', `Template ${id} must specify license`)
    assert.ok(Array.isArray(tDef.requiredNodes) && tDef.requiredNodes.length > 0, `Template ${id} must declare requiredNodes`)
    assert.ok(Array.isArray(tDef.inputs) && tDef.inputs.length > 0, `Template ${id} must declare inputs`)
  }
})

test('comfy-catalog (#433): prepareComfyWorkflowFromTemplate enforces required inputs and interpolates node graph', () => {
  // Missing required input throws
  assert.throws(
    () => prepareComfyWorkflowFromTemplate('txt2img_sdxl', {}),
    /requires input "prompt"/
  )

  // Valid inputs produce valid graph
  const graph = prepareComfyWorkflowFromTemplate('txt2img_sdxl', {
    prompt: 'majestic snow lion on mountain peak',
    negativePrompt: 'blurry, low quality',
    width: 1024,
    height: 1024,
    seed: 42,
  })

  assert.ok(graph && typeof graph === 'object', 'Should return graph object')
  assert.equal(graph['6'].class_type, 'CLIPTextEncode')
  assert.equal(graph['6'].inputs.text, 'majestic snow lion on mountain peak')
  assert.equal(graph['3'].inputs.seed, 42)
  assert.equal(graph['5'].inputs.width, 1024)
})

test('comfy-catalog (#433): dependency validator detects missing custom nodes and server reachability errors', async () => {
  const template = getComfyTemplate('face_instantid')

  // 1. Unreachable server throws connection error without masking as missing models
  const failingFetch = async () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:8188')
    err.code = 'ECONNREFUSED'
    throw err
  }

  const validator1 = createComfyDependencyValidator({ fetchImpl: failingFetch })
  await assert.rejects(
    async () => validator1('http://127.0.0.1:8188', template),
    /ComfyUI server is unreachable at http:\/\/127\.0\.0\.1:8188/
  )

  // 2. Server missing required nodes returns missing nodes report
  const partialObjectInfoFetch = async () => ({
    ok: true,
    json: async () => ({
      KSampler: {},
      CheckpointLoaderSimple: {
        input: { required: { ckpt_name: [['sd_xl_base_1.0.safetensors']] } }
      },
      LoadImage: {},
      // Missing ApplyInstantID, InstantIDModelLoader
    }),
  })

  const validator2 = createComfyDependencyValidator({ fetchImpl: partialObjectInfoFetch })
  const result2 = await validator2('http://127.0.0.1:8188', template)
  assert.equal(result2.ok, false)
  assert.ok(result2.missingNodes.includes('ApplyInstantID'), 'Should flag missing ApplyInstantID node')
  assert.ok(result2.missingNodes.includes('InstantIDModelLoader'), 'Should flag missing InstantIDModelLoader node')
  assert.ok(result2.error.includes('missing custom nodes'), 'Should include descriptive error message')

  // 3. Server with all nodes and models succeeds
  const completeObjectInfoFetch = async () => ({
    ok: true,
    json: async () => ({
      KSampler: {},
      CheckpointLoaderSimple: {
        input: { required: { ckpt_name: [['sd_xl_base_1.0.safetensors']] } }
      },
      LoadImage: {},
      ApplyInstantID: {},
      InstantIDModelLoader: {},
      SaveImage: {},
    }),
  })

  const validator3 = createComfyDependencyValidator({ fetchImpl: completeObjectInfoFetch })
  const result3 = await validator3('http://127.0.0.1:8188', template)
  assert.equal(result3.ok, true)
  assert.deepEqual(result3.missingNodes, [])
})

test('recipes (#432): provides built-in recipes and supports custom recipe persistence', () => {
  const recipes = getAllRecipes()
  assert.ok(recipes.length >= 4, 'Should provide at least 4 built-in recipes')

  const productRecipe = getRecipe('product_card')
  assert.ok(productRecipe, 'product_card recipe should exist')
  assert.equal(productRecipe.steps.length, 3, 'product_card should contain 3 steps')
  assert.equal(productRecipe.steps[0].tool, 'generate_image')
  assert.equal(productRecipe.steps[1].tool, 'remove_background')
  assert.equal(productRecipe.steps[2].tool, 'upscale_image')

  // Custom recipe saving and deletion
  const customId = 'test_custom_recipe_' + Math.random().toString(36).slice(2, 8)
  const saved = saveCustomRecipe({
    id: customId,
    name: 'Custom Test Recipe',
    description: 'A test pipeline',
    inputs: [{ name: 'concept', type: 'string', required: true }],
    steps: [
      { id: 'step1', tool: 'generate_image', params: { prompt: '{{inputs.concept}}' } },
    ],
  })

  assert.equal(saved.id, customId)
  assert.equal(getRecipe(customId)?.name, 'Custom Test Recipe')

  const deleted = deleteCustomRecipe(customId)
  assert.equal(deleted, true)
  assert.equal(getRecipe(customId), null)
})

test('recipes (#432): interpolateRecipeParams correctly substitutes inputs and previous step outputs', () => {
  const rawParams = {
    prompt: '{{inputs.prompt}}, professional photography',
    sourceImage: '{{steps.generate.path}}',
    dimensions: { width: 1024, height: 1024 },
  }

  const context = {
    inputs: { prompt: 'luxury leather handbag' },
    steps: {
      generate: {
        images: [{ path: '/tmp/workspace/images/handbag.png', url: 'http://localhost/handbag.png' }],
      },
    },
  }

  const interpolated = interpolateRecipeParams(rawParams, context)
  assert.equal(interpolated.prompt, 'luxury leather handbag, professional photography')
  assert.equal(interpolated.sourceImage, '/tmp/workspace/images/handbag.png')
  assert.equal(interpolated.dimensions.width, 1024)
})

test('recipes (#432): executeRecipe enforces budget pre-check, runs steps sequentially and handles errors safely', async () => {
  const executedCalls = []
  let budgetChecked = false

  const mockToolDispatcher = async (tool, params) => {
    executedCalls.push({ tool, params })
    if (tool === 'generate_image') {
      return {
        path: '/tmp/workspace/product.png',
        images: [{ path: '/tmp/workspace/product.png', width: 1024, height: 1024 }],
      }
    }
    if (tool === 'remove_background') {
      return {
        path: '/tmp/workspace/product_nobg.png',
        images: [{ path: '/tmp/workspace/product_nobg.png', width: 1024, height: 1024 }],
      }
    }
    if (tool === 'upscale_image') {
      return {
        path: '/tmp/workspace/product_2x.png',
        images: [{ path: '/tmp/workspace/product_2x.png', width: 2048, height: 2048 }],
      }
    }
    throw new Error(`Unexpected tool: ${tool}`)
  }

  const mockAssertBudget = (estimatedCost) => {
    budgetChecked = true
    assert.ok(estimatedCost > 0, 'Estimated cost should be positive')
  }

  const progressEvents = []
  const onProgress = (evt) => progressEvents.push(evt)

  // 1. Successful execution
  const res = await executeRecipe('product_card', { prompt: 'ergonomic gaming keyboard' }, {
    toolDispatcher: mockToolDispatcher,
    assertBudget: mockAssertBudget,
    onProgress,
  })

  assert.equal(res.ok, true)
  assert.equal(res.stepsCount, 3)
  assert.equal(res.completedSteps.length, 3)
  assert.equal(budgetChecked, true, 'Budget pre-check should run before any step execution')
  assert.equal(executedCalls.length, 3)
  assert.equal(executedCalls[0].tool, 'generate_image')
  assert.equal(executedCalls[1].tool, 'remove_background')
  assert.equal(executedCalls[1].params.image, '/tmp/workspace/product.png')
  assert.equal(executedCalls[2].tool, 'upscale_image')
  assert.equal(executedCalls[2].params.image, '/tmp/workspace/product_nobg.png')
  assert.ok(progressEvents.length >= 3, 'Should emit progress events')

  // 2. Missing required input throws before running any steps
  executedCalls.length = 0
  await assert.rejects(
    async () => executeRecipe('product_card', {}, { toolDispatcher: mockToolDispatcher }),
    /missing required input: "prompt"/
  )
  assert.equal(executedCalls.length, 0, 'No steps should execute when inputs are invalid')

  // 3. Step failure captures completed steps and reports exact failure step
  const failingDispatcher = async (tool, params) => {
    if (tool === 'generate_image') {
      return { path: '/tmp/workspace/img1.png', images: [{ path: '/tmp/workspace/img1.png' }] }
    }
    if (tool === 'remove_background') {
      throw new Error('CUDA out of memory')
    }
    return {}
  }

  try {
    await executeRecipe('product_card', { prompt: 'test' }, { toolDispatcher: failingDispatcher })
    assert.fail('Should have thrown on step failure')
  } catch (err) {
    assert.ok(err.message.includes('failed at step 2 (remove_background): CUDA out of memory'))
    assert.equal(err.completedSteps.length, 1, 'Should record completed step 1')
    assert.equal(err.failedStepIndex, 1)
  }
})
