import {
  getAllProjectProfiles,
  getProjectProfileById,
  saveCustomProfile,
  deleteCustomProfile,
  resolveEffectiveParams,
} from '../project-profiles.js'

/**
 * Registers project visual profile management tools (#435).
 */
export function registerProjectProfileTools(ctx, deps = {}) {
  ctx.tools.register({
    name: 'manage_project_profiles',
    description: 'Manages visual project and series profiles (list, get, save, delete) for consistent styling across generation sets.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'save', 'delete'],
          description: 'Action to perform: list all profiles, get by id, save (create/update), or delete.',
        },
        id: {
          type: 'string',
          description: 'Profile ID for get or delete actions.',
        },
        profile: {
          type: 'object',
          additionalProperties: true,
          description: 'Profile specification object for save action (id, name, palette, stylePrompt, negativePrompt, format, rules).',
        },
      },
      required: ['action'],
    },
    output: {
      render(args, value) {
        if (args.action === 'list') {
          const list = Array.isArray(value) ? value : []
          return [
            {
              type: 'text',
              text: `Project Profiles (${list.length}):\n` +
                list.map((p) => `- [${p.id}] ${p.name} (v${p.version || '1.0.0'}) ${p.builtin ? '(builtin)' : '(custom)'}`).join('\n'),
            },
          ]
        }
        if (args.action === 'get') {
          return [
            {
              type: 'text',
              text: value ? `Profile [${value.id}] ${value.name}:\nStyle: "${value.stylePrompt || ''}"\nPalette: ${(value.palette || []).join(', ')}` : 'Profile not found.',
            },
          ]
        }
        if (args.action === 'save') {
          return [{ type: 'text', text: `Saved profile [${value?.id}] ${value?.name} successfully.` }]
        }
        if (args.action === 'delete') {
          return [{ type: 'text', text: value ? `Deleted profile ${args.id}.` : `Profile ${args.id} not found or cannot be deleted.` }]
        }
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    async execute(args) {
      const storagePath = deps.profilesPath || null
      if (args.action === 'list') {
        return getAllProjectProfiles(storagePath)
      }
      if (args.action === 'get') {
        return getProjectProfileById(args.id, storagePath)
      }
      if (args.action === 'save') {
        return saveCustomProfile(args.profile, storagePath)
      }
      if (args.action === 'delete') {
        return deleteCustomProfile(args.id, storagePath)
      }
      throw new Error(`Unknown action: ${args.action}`)
    },
  })

  ctx.tools.register({
    name: 'resolve_project_profile_params',
    description: 'Calculates effective generation parameters by cascading request overrides over a project visual profile and system defaults.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profileId: {
          type: 'string',
          description: 'Identifier of the project visual profile.',
        },
        prompt: {
          type: 'string',
          description: 'Specific image request prompt.',
        },
        negativePrompt: {
          type: 'string',
          description: 'Specific negative prompt overrides.',
        },
        size: {
          type: 'string',
          description: 'Specific dimensions (e.g. 1024x1024 or 1280x720).',
        },
        format: {
          type: 'string',
          description: 'Output format (webp, png, jpeg).',
        },
      },
      required: ['profileId'],
    },
    output: {
      render(args, value) {
        return [
          {
            type: 'text',
            text: `Effective Parameters for Profile [${value?.appliedProfile?.name || args.profileId}]:\n` +
              `Prompt: "${value?.effectiveParams?.prompt || ''}"\n` +
              `Negative: "${value?.effectiveParams?.negativePrompt || ''}"\n` +
              `Dimensions: ${value?.effectiveParams?.size} (${value?.effectiveParams?.format})\n` +
              `Provenance: ${JSON.stringify(value?.provenance || {})}`,
          },
        ]
      },
    },
    async execute(args) {
      const storagePath = deps.profilesPath || null
      const requestParams = {
        prompt: args.prompt,
        negativePrompt: args.negativePrompt,
        size: args.size,
        format: args.format,
      }
      return resolveEffectiveParams(requestParams, args.profileId, storagePath)
    },
  })
}
