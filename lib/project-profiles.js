import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Visual Project & Series Profiles (#435)
 * Manages persistent project visual profiles with explicit scope,
 * parameter cascade (defaults -> profile -> request), and immutable history tagging.
 */

export const BUILTIN_PROJECT_PROFILES = [
  {
    id: 'cyberpunk_neon',
    name: 'Cyberpunk Neon',
    version: '1.0.0',
    description: 'High contrast neon lighting and dark futuristic styling.',
    palette: ['#00f0ff', '#ff003c', '#ffe600', '#0a0a12'],
    stylePrompt: 'cyberpunk aesthetic, volumetric atmospheric lighting, raytracing, sharp neon accents, highly detailed 8k',
    negativePrompt: 'washed out, vintage, pastel, desaturated, noisy',
    format: { size: '1024x1024', aspect: '1:1', format: 'webp' },
    rules: {
      background: 'dark cityscapes or moody interior',
      typography: 'clean monospace or futuristic geometric',
    },
    allowedModels: ['fal-ai/flux/dev', 'sdxl_base'],
    builtin: true,
  },
  {
    id: 'minimal_nordic',
    name: 'Scandinavian Minimalist',
    version: '1.0.0',
    description: 'Warm daylight, matte textures, and understated earthy tones.',
    palette: ['#f4f1de', '#e07a5f', '#3d405b', '#81b29a'],
    stylePrompt: 'scandinavian minimalism, clean composition, soft natural daylight, matte surfaces, earthy organic elegance',
    negativePrompt: 'cluttered, neon, heavy shadows, oversaturated, glossy plastic',
    format: { size: '1024x1024', aspect: '1:1', format: 'png' },
    rules: {
      background: 'plain textured warm neutral',
      typography: 'light grotesque sans',
    },
    allowedModels: ['fal-ai/flux/dev', 'imagen-3.0-generate-002'],
    builtin: true,
  },
  {
    id: 'corporate_editorial',
    name: 'Corporate Editorial',
    version: '1.0.0',
    description: 'High-end business magazine photography with crisp studio lighting.',
    palette: ['#0f172a', '#3b82f6', '#64748b', '#f8fafc'],
    stylePrompt: 'high-end corporate magazine editorial, crisp balanced studio lighting, premium commercial photography',
    negativePrompt: 'anime, cartoon, oversaturated, exaggerated distortions, amateur',
    format: { size: '1024x1024', aspect: '16:9', format: 'webp' },
    rules: {
      background: 'architectural soft blur or pristine studio',
      typography: 'editorial serif / humanistic sans',
    },
    allowedModels: ['fal-ai/flux/dev', 'black-forest-labs/flux-1.1-pro'],
    builtin: true,
  },
]

export function getProfilesStoragePath(customPath) {
  if (customPath) return customPath
  if (process.env.DSH_PROJECT_PROFILES_PATH) return process.env.DSH_PROJECT_PROFILES_PATH
  const home = os.homedir() || '/tmp'
  return path.join(home, '.dsh', 'dsh-image-gen', 'project-profiles.json')
}

export function loadCustomProfiles(storagePath) {
  const filePath = getProfilesStoragePath(storagePath)
  try {
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    return []
  }
}

export function saveCustomProfile(profile, storagePath) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Invalid project profile: object required')
  }
  if (!profile.id || typeof profile.id !== 'string') {
    throw new Error('Project profile requires a string "id"')
  }
  if (!profile.name || typeof profile.name !== 'string') {
    throw new Error('Project profile requires a string "name"')
  }

  const filePath = getProfilesStoragePath(storagePath)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const existing = loadCustomProfiles(storagePath)
  const index = existing.findIndex((p) => p.id === profile.id)
  const prepared = {
    ...profile,
    version: profile.version || '1.0.0',
    builtin: false,
    updatedAt: new Date().toISOString(),
  }

  if (index >= 0) {
    existing[index] = prepared
  } else {
    existing.push(prepared)
  }

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8')
  return prepared
}

export function deleteCustomProfile(id, storagePath) {
  const filePath = getProfilesStoragePath(storagePath)
  const existing = loadCustomProfiles(storagePath)
  const filtered = existing.filter((p) => p.id !== id)
  if (filtered.length === existing.length) {
    return false
  }
  fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2), 'utf8')
  return true
}

export function getAllProjectProfiles(storagePath) {
  const custom = loadCustomProfiles(storagePath)
  const customIds = new Set(custom.map((c) => c.id))
  const builtins = BUILTIN_PROJECT_PROFILES.filter((b) => !customIds.has(b.id))
  return [...builtins, ...custom]
}

export function getProjectProfileById(id, storagePath) {
  if (!id) return null
  const all = getAllProjectProfiles(storagePath)
  return all.find((p) => p.id === id) || null
}

/**
 * Parameter resolution cascade (#435):
 * Priority: Request parameters > Project Profile > System Defaults.
 * Returns effective params, provenance mapping, and immutable profile tag for history.
 */
export function resolveEffectiveParams(requestParams = {}, profileId = null, storagePath = null) {
  const profile = profileId ? getProjectProfileById(profileId, storagePath) : null
  const provenance = {}
  const effective = {}

  // 1. Defaults
  const defaults = {
    size: '1024x1024',
    format: 'webp',
    negativePrompt: '',
    steps: 25,
    cfg: 7,
  }

  for (const [key, val] of Object.entries(defaults)) {
    effective[key] = val
    provenance[key] = 'default'
  }

  // 2. Profile layer
  if (profile) {
    if (profile.format?.size) {
      effective.size = profile.format.size
      provenance.size = 'profile'
    }
    if (profile.format?.format) {
      effective.format = profile.format.format
      provenance.format = 'profile'
    }
    if (profile.negativePrompt) {
      effective.negativePrompt = profile.negativePrompt
      provenance.negativePrompt = 'profile'
    }
    if (profile.stylePrompt) {
      effective.stylePrompt = profile.stylePrompt
      provenance.stylePrompt = 'profile'
    }
    if (Array.isArray(profile.palette) && profile.palette.length > 0) {
      effective.palette = [...profile.palette]
      provenance.palette = 'profile'
    }
    if (profile.rules) {
      effective.rules = { ...profile.rules }
      provenance.rules = 'profile'
    }
  }

  // 3. Request layer (highest precedence)
  for (const [key, val] of Object.entries(requestParams)) {
    if (val !== undefined && val !== null) {
      if (key === 'prompt') {
        // Synthesize prompt with profile style if available
        if (effective.stylePrompt) {
          effective.prompt = `${val}, ${effective.stylePrompt}`
          provenance.prompt = 'request+profile'
        } else {
          effective.prompt = val
          provenance.prompt = 'request'
        }
      } else if (key === 'negativePrompt') {
        if (effective.negativePrompt && val) {
          effective.negativePrompt = `${effective.negativePrompt}, ${val}`
          provenance.negativePrompt = 'request+profile'
        } else {
          effective.negativePrompt = val || effective.negativePrompt
          provenance.negativePrompt = 'request'
        }
      } else {
        effective[key] = val
        provenance[key] = 'request'
      }
    }
  }

  // Immutable applied profile metadata snapshot for history
  const appliedProfile = profile
    ? {
        id: profile.id,
        name: profile.name,
        version: profile.version || '1.0.0',
      }
    : null

  return {
    effectiveParams: effective,
    provenance,
    appliedProfile,
  }
}
