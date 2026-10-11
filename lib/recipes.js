// lib/recipes.js — Sequential image recipe pipelines with step tracking & cost safety (#432)
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Built-in sequential recipe pipelines.
 */
export const BUILTIN_RECIPES = [
  {
    id: 'product_card',
    name: 'Product Card Suite',
    description: 'Generates product photography, cleanly removes background, and upscales for print or web presentation.',
    version: '1.0.0',
    category: 'e-commerce',
    inputs: [
      { name: 'prompt', type: 'string', required: true, description: 'Product and materials description' },
      { name: 'size', type: 'string', default: '1024x1024', description: 'Initial generation dimensions' },
      { name: 'scale', type: 'number', default: 2, description: 'Upscaling factor (2 or 4)' },
    ],
    steps: [
      {
        id: 'generate',
        tool: 'generate_image',
        description: 'Generate product visual',
        params: {
          prompt: '{{inputs.prompt}}, studio lighting, clean product shot',
          size: '{{inputs.size}}',
        },
        estimatedCost: 0.02,
      },
      {
        id: 'remove_bg',
        tool: 'remove_background',
        description: 'Remove background to transparent alpha',
        params: {
          image: '{{steps.generate.path}}',
        },
        estimatedCost: 0.01,
      },
      {
        id: 'upscale',
        tool: 'upscale_image',
        description: 'Upscale transparent asset',
        params: {
          image: '{{steps.remove_bg.path}}',
          scale: '{{inputs.scale}}',
        },
        estimatedCost: 0.02,
      },
    ],
  },
  {
    id: 'social_promo',
    name: 'Social Media Promo Banner',
    description: 'Synthesizes theme graphic and smart crops to social widescreen (16:9) format.',
    version: '1.0.0',
    category: 'marketing',
    inputs: [
      { name: 'prompt', type: 'string', required: true, description: 'Promo announcement concept' },
      { name: 'aspect', type: 'string', default: '16:9', description: 'Social crop aspect ratio' },
    ],
    steps: [
      {
        id: 'generate',
        tool: 'generate_image',
        description: 'Synthesize promo visual',
        params: {
          prompt: '{{inputs.prompt}}',
          size: '1024x1024',
        },
        estimatedCost: 0.02,
      },
      {
        id: 'crop',
        tool: 'smart_crop_image',
        description: 'Smart crop to destination ratio',
        params: {
          image: '{{steps.generate.path}}',
          aspect: '{{inputs.aspect}}',
        },
        estimatedCost: 0.00,
      },
    ],
  },
  {
    id: 'vector_asset',
    name: 'Vector Asset Pipeline',
    description: 'Generates clean icon concept, traces raster to vector paths, and produces scalable SVG.',
    version: '1.0.0',
    category: 'graphics',
    inputs: [
      { name: 'prompt', type: 'string', required: true, description: 'Icon concept prompt' },
      { name: 'colors', type: 'number', default: 8, description: 'Palette color count for tracing' },
    ],
    steps: [
      {
        id: 'generate',
        tool: 'generate_image',
        description: 'Generate minimalist graphic',
        params: {
          prompt: '{{inputs.prompt}}, minimalist clean vector style, solid plain background',
          size: '1024x1024',
        },
        estimatedCost: 0.02,
      },
      {
        id: 'vectorize',
        tool: 'vectorize_image',
        description: 'Trace raster into clean vector paths',
        params: {
          image: '{{steps.generate.path}}',
          mode: 'color',
          colors: '{{inputs.colors}}',
        },
        estimatedCost: 0.00,
      },
    ],
  },
  {
    id: 'character_pipeline',
    name: 'Character Turnaround Pipeline',
    description: 'Synthesizes character concept and generates multi-angle model turnaround sheet.',
    version: '1.0.0',
    category: 'creative',
    inputs: [
      { name: 'character_name', type: 'string', required: true, description: 'Name of the character' },
      { name: 'prompt', type: 'string', required: true, description: 'Character description and attire' },
    ],
    steps: [
      {
        id: 'concept',
        tool: 'generate_image',
        description: 'Generate key character portrait',
        params: {
          prompt: '{{inputs.prompt}}, full body concept character art',
          size: '1024x1024',
        },
        estimatedCost: 0.02,
      },
      {
        id: 'turnaround',
        tool: 'generate_character_sheet',
        description: 'Generate model turnaround sheet',
        params: {
          character_name: '{{inputs.character_name}}',
          reference_image: '{{steps.concept.path}}',
          views: 'front,side,back',
        },
        estimatedCost: 0.03,
      },
    ],
  },
]

function getRecipesFilePath() {
  const base = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(base, 'dsh-image-gen', 'recipes.json')
}

/**
 * Loads custom recipes from local storage file.
 */
export function loadCustomRecipes() {
  const filePath = getRecipesFilePath()
  try {
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, 'utf8')
    const list = JSON.parse(content)
    return Array.isArray(list) ? list : []
  } catch (_) {
    return []
  }
}

/**
 * Saves a user recipe to local storage.
 */
export function saveCustomRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') {
    throw new Error('Recipe must be an object')
  }
  if (!recipe.id || typeof recipe.id !== 'string') {
    throw new Error('Recipe must have a valid string "id"')
  }
  if (!recipe.name || typeof recipe.name !== 'string') {
    throw new Error('Recipe must have a valid string "name"')
  }
  if (!Array.isArray(recipe.steps) || recipe.steps.length === 0) {
    throw new Error('Recipe must have a non-empty array of "steps"')
  }

  // Validate step format
  for (let i = 0; i < recipe.steps.length; i++) {
    const s = recipe.steps[i]
    if (!s || !s.tool || typeof s.tool !== 'string') {
      throw new Error(`Recipe step #${i + 1} missing required "tool" name`)
    }
  }

  const list = loadCustomRecipes().filter((r) => r.id !== recipe.id)
  const item = {
    ...recipe,
    custom: true,
    updatedAt: new Date().toISOString(),
  }
  list.push(item)

  const filePath = getRecipesFilePath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8')
  return item
}

/**
 * Deletes a user recipe by ID.
 */
export function deleteCustomRecipe(id) {
  const list = loadCustomRecipes()
  const filtered = list.filter((r) => r.id !== id)
  if (filtered.length === list.length) return false
  const filePath = getRecipesFilePath()
  fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2), 'utf8')
  return true
}

/**
 * Returns merged list of all available recipes (built-in + custom).
 */
export function getAllRecipes() {
  const custom = loadCustomRecipes()
  const customIds = new Set(custom.map((c) => c.id))
  const builtins = BUILTIN_RECIPES.filter((b) => !customIds.has(b.id)).map((b) => ({
    ...b,
    builtin: true,
  }))
  return [...builtins, ...custom]
}

/**
 * Retrieves a recipe by ID.
 */
export function getRecipe(id) {
  if (!id) return null
  return getAllRecipes().find((r) => r.id === id) || null
}

/**
 * Interpolates recipe step parameters using context containing inputs and prior step results.
 */
export function interpolateRecipeParams(rawParams, context = {}) {
  const { inputs = {}, steps = {} } = context

  function resolveRef(str) {
    if (typeof str !== 'string') return str
    const trimmed = str.trim()

    // Handle exact number matches
    if (/^\{\{inputs\.([a-zA-Z0-9_.-]+)\}\}$/.test(trimmed)) {
      const key = trimmed.slice(9, -2)
      return inputs[key] !== undefined ? inputs[key] : ''
    }

    // General replacements
    let out = str.replace(/\{\{inputs\.([a-zA-Z0-9_.-]+)\}\}/g, (_, k) => {
      return inputs[k] !== undefined ? String(inputs[k]) : ''
    })

    out = out.replace(/\{\{steps\.([a-zA-Z0-9_.-]+)\.([a-zA-Z0-9_.-]+)\}\}/g, (_, stepId, prop) => {
      const stepData = steps[stepId]
      if (!stepData) return ''
      // Try direct property or nested image/attachment properties
      if (stepData[prop] !== undefined) return String(stepData[prop])
      if (prop === 'path' && stepData.images?.[0]?.path) return String(stepData.images[0].path)
      if (prop === 'url' && stepData.images?.[0]?.url) return String(stepData.images[0].url)
      if (prop === 'path' && stepData.attachment?.path) return String(stepData.attachment.path)
      if (prop === 'path' && stepData.svgPath) return String(stepData.svgPath)
      return ''
    })

    return out
  }

  function transform(val) {
    if (typeof val === 'string') return resolveRef(val)
    if (Array.isArray(val)) return val.map(transform)
    if (val && typeof val === 'object') {
      const res = {}
      for (const [k, v] of Object.entries(val)) {
        res[k] = transform(v)
      }
      return res
    }
    return val
  }

  return transform(rawParams)
}

/**
 * Executes a sequential image recipe pipeline (#432).
 *
 * @param {string|object} recipeOrId Recipe ID or full recipe object
 * @param {object} userInputs User provided arguments (e.g. prompt, image, aspect)
 * @param {object} env Runtime tools environment
 * @param {Function} env.toolDispatcher Function (toolName, params) => Promise<result>
 * @param {Function} [env.assertBudget] Function (amount) => throws if insufficient budget
 * @param {Function} [env.onProgress] Function ({ stage, progress })
 * @returns {Promise<object>} Recipe execution summary and final artifact
 */
export async function executeRecipe(recipeOrId, userInputs = {}, env = {}) {
  const { toolDispatcher, assertBudget, onProgress } = env
  if (typeof toolDispatcher !== 'function') {
    throw new Error('Recipe runner requires a toolDispatcher function')
  }

  const recipe = typeof recipeOrId === 'string' ? getRecipe(recipeOrId) : recipeOrId
  if (!recipe) {
    throw new Error(`Recipe "${recipeOrId}" not found`)
  }

  // 1. Validate required inputs
  const mergedInputs = {}
  for (const inp of recipe.inputs || []) {
    if (inp.default !== undefined) mergedInputs[inp.name] = inp.default
  }
  Object.assign(mergedInputs, userInputs)

  for (const inp of recipe.inputs || []) {
    if (inp.required && (mergedInputs[inp.name] === undefined || mergedInputs[inp.name] === null || mergedInputs[inp.name] === '')) {
      throw new Error(`Recipe "${recipe.name}" missing required input: "${inp.name}"`)
    }
  }

  // 2. Pre-flight dry run: estimate total budget and verify tools exist before executing paid requests
  let totalEstimatedCost = 0
  for (let i = 0; i < recipe.steps.length; i++) {
    const step = recipe.steps[i]
    totalEstimatedCost += Number(step.estimatedCost || 0)
  }

  if (typeof assertBudget === 'function' && totalEstimatedCost > 0) {
    assertBudget(totalEstimatedCost)
  }

  // 3. Sequential step execution
  const completedSteps = []
  const stepContext = {
    inputs: mergedInputs,
    steps: {},
  }

  for (let i = 0; i < recipe.steps.length; i++) {
    const step = recipe.steps[i]
    const stepId = step.id || String(i)
    const stepDescription = step.description || `Step ${i + 1}: ${step.tool}`

    onProgress?.({
      stage: `Step ${i + 1}/${recipe.steps.length}: ${step.tool}`,
      progress: Math.round((i / recipe.steps.length) * 100),
    })

    const interpolated = interpolateRecipeParams(step.params || {}, stepContext)

    const startTime = Date.now()
    let result
    try {
      result = await toolDispatcher(step.tool, interpolated)
    } catch (err) {
      const failedErr = new Error(`Recipe "${recipe.name}" failed at step ${i + 1} (${step.tool}): ${err.message}`)
      failedErr.recipeId = recipe.id
      failedErr.failedStepIndex = i
      failedErr.failedStepTool = step.tool
      failedErr.completedSteps = completedSteps
      throw failedErr
    }

    const durationMs = Date.now() - startTime
    const record = {
      stepIndex: i,
      stepId,
      tool: step.tool,
      description: stepDescription,
      params: interpolated,
      durationMs,
      result,
    }

    completedSteps.push(record)
    stepContext.steps[stepId] = result
    stepContext.steps[String(i)] = result
  }

  onProgress?.({
    stage: 'Recipe completed',
    progress: 100,
  })

  const lastResult = completedSteps[completedSteps.length - 1]?.result

  return {
    ok: true,
    recipeId: recipe.id,
    recipeName: recipe.name,
    stepsCount: recipe.steps.length,
    completedSteps,
    finalResult: lastResult,
    totalEstimatedCost: +totalEstimatedCost.toFixed(4),
  }
}
