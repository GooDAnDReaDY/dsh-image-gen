// lib/tools/recipes.js — Tools for running recipes & validating ComfyUI workflows (#432, #433)
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  getAllRecipes,
  getRecipe,
  saveCustomRecipe,
  deleteCustomRecipe,
  executeRecipe,
} from '../recipes.js'
import {
  getComfyTemplates,
  getComfyTemplate,
  createComfyDependencyValidator,
  prepareComfyWorkflowFromTemplate,
} from '../comfy-catalog.js'

/**
 * Registers recipe execution and workflow catalog tools.
 *
 * @param {object} ctx cordis context
 * @param {object} deps shared runtime dependencies
 */
export function registerRecipeTools(ctx, deps) {
  const { config, toolDispatcher, assertBudget } = deps

  // 1. run_image_recipe (#432)
  ctx.tools.register({
    name: 'run_image_recipe',
    description: 'Executes a repeatable sequential image recipe pipeline (e.g. product_card, social_promo, vector_asset, character_pipeline). Runs each step, validates budget and prerequisites, and provides intermediate and final results.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['recipe_id'],
      properties: {
        recipe_id: {
          type: 'string',
          description: 'Identifier of the recipe (e.g. "product_card", "social_promo", "vector_asset", "character_pipeline", or custom recipe ID).',
        },
        inputs: {
          type: 'object',
          additionalProperties: true,
          description: 'Input arguments required by the recipe (e.g. prompt, image, aspect, scale, character_name).',
        },
      },
    },
    output: {
      render(args, value) {
        const steps = value?.completedSteps || []
        const lines = [
          `### Recipe: ${value?.recipeName || 'Recipe'} (${value?.recipeId || ''})`,
          `Steps completed: ${steps.length}/${value?.stepsCount || 0} (Est. cost: $${value?.totalEstimatedCost || 0})`,
          '',
        ]
        for (const step of steps) {
          lines.push(`- **Step ${step.stepIndex + 1}: ${step.tool}** (${step.durationMs}ms) — ${step.description}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    execute: async (args) => {
      const { recipe_id, inputs = {} } = args || {}
      if (!recipe_id) throw new Error('recipe_id is required')

      const res = await executeRecipe(recipe_id, inputs, {
        toolDispatcher,
        assertBudget,
      })

      return res
    },
    render(args, value) {
      const steps = value?.completedSteps || []
      const lines = [
        `### Recipe: ${value?.recipeName || 'Recipe'} (${value?.recipeId || ''})`,
        `Steps completed: ${steps.length}/${value?.stepsCount || 0} (Est. cost: $${value?.totalEstimatedCost || 0})`,
        '',
      ]
      for (const step of steps) {
        lines.push(`- **Step ${step.stepIndex + 1}: ${step.tool}** (${step.durationMs}ms) — ${step.description}`)
      }
      return [{ type: 'text', text: lines.join('\n') }]
    },
    isConcurrencySafe: () => false,
  })

  // 2. manage_image_recipes (#432)
  ctx.tools.register({
    name: 'manage_image_recipes',
    description: 'Lists, inspects, saves, or deletes sequential image generation recipes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'save', 'delete'],
          description: 'Recipe management action.',
        },
        recipe_id: {
          type: 'string',
          description: 'Recipe ID (required for get and delete).',
        },
        recipe: {
          type: 'object',
          additionalProperties: true,
          description: 'Complete recipe object to save (required for action="save"). Must specify id, name, inputs, and steps.',
        },
      },
    },
    output: {
      render(args, value) {
        if (args?.action === 'list') {
          const list = value?.recipes || []
          const lines = [`Found ${list.length} available image recipes:`, '']
          for (const r of list) {
            lines.push(`- **${r.id}** (${r.name}): ${r.description} [${r.steps?.length || 0} steps]`)
          }
          return [{ type: 'text', text: lines.join('\n') }]
        }
        return [{ type: 'text', text: JSON.stringify(value || {}, null, 2) }]
      },
    },
    execute: async (args) => {
      const { action, recipe_id, recipe } = args || {}
      if (action === 'list') {
        return { ok: true, recipes: getAllRecipes() }
      }
      if (action === 'get') {
        if (!recipe_id) throw new Error('recipe_id is required for action="get"')
        const found = getRecipe(recipe_id)
        if (!found) throw new Error(`Recipe "${recipe_id}" not found`)
        return { ok: true, recipe: found }
      }
      if (action === 'save') {
        if (!recipe) throw new Error('recipe object is required for action="save"')
        const saved = saveCustomRecipe(recipe)
        return { ok: true, recipe: saved, message: `Recipe "${saved.id}" saved successfully` }
      }
      if (action === 'delete') {
        if (!recipe_id) throw new Error('recipe_id is required for action="delete"')
        const deleted = deleteCustomRecipe(recipe_id)
        if (!deleted) throw new Error(`Custom recipe "${recipe_id}" not found or cannot be deleted`)
        return { ok: true, deleted: true, recipe_id }
      }
      throw new Error(`Unsupported action "${action}"`)
    },
    render(args, value) {
      if (args?.action === 'list') {
        const list = value?.recipes || []
        const lines = [`Found ${list.length} available image recipes:`, '']
        for (const r of list) {
          lines.push(`- **${r.id}** (${r.name}): ${r.description} [${r.steps?.length || 0} steps]`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      }
      return [{ type: 'text', text: JSON.stringify(value || {}, null, 2) }]
    },
    isConcurrencySafe: () => true,
  })

  // 3. validate_comfy_workflow (#433)
  ctx.tools.register({
    name: 'validate_comfy_workflow',
    description: 'Validates a vetted ComfyUI template or custom workflow graph against the connected ComfyUI server dependencies and models.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        template_id: {
          type: 'string',
          description: 'Identifier of the vetted ComfyUI template (e.g. "txt2img_sdxl", "img2img_sdxl", "face_instantid", "upscale_esrgan").',
        },
        base_url: {
          type: 'string',
          description: 'ComfyUI server address (defaults to configured localBaseURL).',
        },
      },
    },
    output: {
      render(args, value) {
        if (value?.templateId) {
          const status = value.ok ? 'READY' : 'MISSING DEPENDENCIES'
          const lines = [
            `### ComfyUI Template: ${value.templateName} [${status}]`,
            `Server: ${value.serverUrl}`,
          ]
          if (value.missingNodes?.length) lines.push(`- Missing Nodes: ${value.missingNodes.join(', ')}`)
          if (value.missingModels?.length) lines.push(`- Missing Models: ${value.missingModels.join(', ')}`)
          if (value.ok) lines.push('All required custom nodes and model assets are available on the ComfyUI host.')
          return [{ type: 'text', text: lines.join('\n') }]
        }
        const list = value?.templates || []
        const lines = [`Vetted ComfyUI Templates (${list.length}):`, '']
        for (const t of list) lines.push(`- **${t.id}**: ${t.name} (${t.description})`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    execute: async (args) => {
      const { template_id, base_url } = args || {}
      const targetBase = base_url || config?.localBaseURL || 'http://127.0.0.1:8188'

      if (template_id) {
        const template = getComfyTemplate(template_id)
        if (!template) {
          throw new Error(`ComfyUI template "${template_id}" not found. Available: ${getComfyTemplates().map((t) => t.id).join(', ')}`)
        }

        const validator = createComfyDependencyValidator()
        const check = await validator(targetBase, template)
        return {
          ok: check.ok,
          templateId: template.id,
          templateName: template.name,
          requiredNodes: template.requiredNodes,
          requiredModels: template.requiredModels,
          missingNodes: check.missingNodes,
          missingModels: check.missingModels,
          serverUrl: targetBase,
          error: check.error,
        }
      }

      // If no template specified, return catalog summary
      return {
        ok: true,
        templates: getComfyTemplates(),
        serverUrl: targetBase,
      }
    },
    render(args, value) {
      if (value?.templateId) {
        const status = value.ok ? 'READY' : 'MISSING DEPENDENCIES'
        const lines = [
          `### ComfyUI Template: ${value.templateName} [${status}]`,
          `Server: ${value.serverUrl}`,
        ]
        if (value.missingNodes?.length) lines.push(`- Missing Nodes: ${value.missingNodes.join(', ')}`)
        if (value.missingModels?.length) lines.push(`- Missing Models: ${value.missingModels.join(', ')}`)
        if (value.ok) lines.push('All required custom nodes and model assets are available on the ComfyUI host.')
        return [{ type: 'text', text: lines.join('\n') }]
      }
      const list = value?.templates || []
      const lines = [`Vetted ComfyUI Templates (${list.length}):`, '']
      for (const t of list) lines.push(`- **${t.id}**: ${t.name} (${t.description})`)
      return [{ type: 'text', text: lines.join('\n') }]
    },
    isConcurrencySafe: () => true,
  })
}
