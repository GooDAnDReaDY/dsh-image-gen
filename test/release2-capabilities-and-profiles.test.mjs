import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import {
  getCapabilityRegistry,
  filterModelsByCapabilities,
  recommendModelForTask,
  validateModelCapability,
} from '../lib/capabilities.js'

import {
  BUILTIN_PROJECT_PROFILES,
  getAllProjectProfiles,
  getProjectProfileById,
  saveCustomProfile,
  deleteCustomProfile,
  resolveEffectiveParams,
} from '../lib/project-profiles.js'

import { registerCapabilityTools } from '../lib/tools/capabilities.js'
import { registerProjectProfileTools } from '../lib/tools/project-profiles.js'

test('capabilities (#434): registry contains valid metadata, pricing, and verification dates', () => {
  const registry = getCapabilityRegistry()
  assert.ok(registry.length >= 8, 'Registry must contain documented models')

  for (const model of registry) {
    assert.ok(model.provider, 'Model must have provider')
    assert.ok(model.modelId, 'Model must have modelId')
    assert.ok(model.displayName, 'Model must have displayName')
    assert.ok(Array.isArray(model.capabilities), 'Model must have capabilities array')
    assert.ok(typeof model.features === 'object', 'Model must have features map')
    assert.ok(typeof model.estimatedCostUSD === 'number', 'Model must have numeric cost')
    assert.ok(typeof model.pricingSource === 'string', 'Model must state pricing source')
    assert.ok(typeof model.verifiedDate === 'string', 'Model must state verification date')
    assert.ok(model.maxResolution >= 1024, 'Model maxResolution must be >= 1024')
  }
})

test('capabilities (#434): filtering treats unknown capabilities as unsupported and respects constraints', () => {
  // 1. Text rendering requirement
  const textModels = filterModelsByCapabilities({ textRendering: true })
  const compatibleText = textModels.filter((m) => m.compatible)
  assert.ok(compatibleText.length > 0)
  for (const m of compatibleText) {
    assert.equal(m.features.textRendering, true)
  }

  // 2. Inpainting requirement
  const inpaintModels = filterModelsByCapabilities({ maskInpainting: true })
  const compatibleInpaint = inpaintModels.filter((m) => m.compatible)
  assert.ok(compatibleInpaint.length > 0)
  for (const m of compatibleInpaint) {
    assert.equal(m.features.maskInpainting, true)
  }

  // 3. Strict unknown operation
  const unknownModels = filterModelsByCapabilities({ operations: ['non_existent_magic_quantum_render'] })
  const compatibleUnknown = unknownModels.filter((m) => m.compatible)
  assert.equal(compatibleUnknown.length, 0, 'Unknown operation must have 0 compatible models')
  assert.ok(unknownModels[0].missingCapabilities.includes('operation:non_existent_magic_quantum_render'))
})

test('capabilities (#434): recommendation selects cost-effective model and provides rationale', () => {
  const rec = recommendModelForTask({
    operations: ['txt2img'],
    textRendering: true,
  })

  assert.equal(rec.ok, true)
  assert.ok(rec.recommended)
  assert.ok(rec.recommendationReason.length > 0)
  assert.ok(Array.isArray(rec.alternatives))

  // Impossible requirements return helpful alternatives
  const impossible = recommendModelForTask({
    operations: ['txt2img'],
    facePreservation: true,
    maxCostUSD: 0.0001,
    configuredProviders: ['replicate'],
  })
  assert.equal(impossible.ok, false)
  assert.ok(impossible.alternatives.length > 0)
})

test('capabilities (#434): pre-flight validation prevents submitting unsupported features to provider', () => {
  // FLUX schnell does not support inpaint/masks
  const invalidMask = validateModelCapability('fal', 'fal-ai/flux/schnell', {
    requiresMask: true,
  })
  assert.equal(invalidMask.valid, false)
  assert.equal(invalidMask.status, 'unsupported_feature')
  assert.match(invalidMask.reason, /Mask inpainting is requested but not supported/i)

  // Unknown model produces unknown_model status
  const unknown = validateModelCapability('unknown_provider', 'mystery_model_v9')
  assert.equal(unknown.valid, false)
  assert.equal(unknown.status, 'unknown_model')

  // Supported model passes
  const valid = validateModelCapability('fal', 'fal-ai/flux/dev', {
    operation: 'txt2img',
    requiresTextRender: true,
  })
  assert.equal(valid.valid, true)
  assert.equal(valid.status, 'supported')
})

test('project-profiles (#435): built-in profiles provide aesthetic styling and palette', () => {
  assert.ok(BUILTIN_PROJECT_PROFILES.length >= 3)
  for (const p of BUILTIN_PROJECT_PROFILES) {
    assert.ok(p.id)
    assert.ok(p.name)
    assert.ok(p.stylePrompt)
    assert.ok(Array.isArray(p.palette) && p.palette.length >= 3)
    assert.ok(p.format?.size)
  }
})

test('project-profiles (#435): CRUD operations and isolation using custom storage path', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-profiles-test-'))
  const tempFile = path.join(tempDir, 'profiles.json')

  try {
    const custom = {
      id: 'brand_aurora',
      name: 'Aurora Brand Identity',
      palette: ['#10b981', '#3b82f6', '#8b5cf6'],
      stylePrompt: 'vibrant northern lights aurora aesthetic, organic clean geometry',
      negativePrompt: 'harsh industrial textures',
      format: { size: '1280x720', aspect: '16:9', format: 'png' },
    }

    // Save
    const saved = saveCustomProfile(custom, tempFile)
    assert.equal(saved.id, 'brand_aurora')
    assert.equal(saved.version, '1.0.0')

    // Get
    const retrieved = getProjectProfileById('brand_aurora', tempFile)
    assert.equal(retrieved.name, 'Aurora Brand Identity')

    // List includes builtins + custom
    const all = getAllProjectProfiles(tempFile)
    assert.ok(all.some((p) => p.id === 'brand_aurora'))
    assert.ok(all.some((p) => p.id === 'cyberpunk_neon'))

    // Delete
    const deleted = deleteCustomProfile('brand_aurora', tempFile)
    assert.equal(deleted, true)
    assert.equal(getProjectProfileById('brand_aurora', tempFile), null)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('project-profiles (#435): parameter cascade resolves defaults, profile, and explicit request overrides with provenance', () => {
  // Cascading over cyberpunk_neon profile
  const resolved = resolveEffectiveParams(
    {
      prompt: 'futuristic flying courier car',
      size: '1920x1080', // explicit override
    },
    'cyberpunk_neon'
  )

  const { effectiveParams, provenance, appliedProfile } = resolved

  // Prompt should be merged with profile style
  assert.match(effectiveParams.prompt, /futuristic flying courier car/)
  assert.match(effectiveParams.prompt, /cyberpunk aesthetic/)
  assert.equal(provenance.prompt, 'request+profile')

  // Explicit size wins over profile size
  assert.equal(effectiveParams.size, '1920x1080')
  assert.equal(provenance.size, 'request')

  // Format and negativePrompt inherited from profile
  assert.equal(effectiveParams.format, 'webp')
  assert.equal(provenance.format, 'profile')
  assert.match(effectiveParams.negativePrompt, /washed out/)
  assert.equal(provenance.negativePrompt, 'profile')

  // Steps came from default
  assert.equal(effectiveParams.steps, 25)
  assert.equal(provenance.steps, 'default')

  // Applied profile snapshot is immutable
  assert.deepEqual(appliedProfile, {
    id: 'cyberpunk_neon',
    name: 'Cyberpunk Neon',
    version: '1.0.0',
  })
})

test('tools (#434, #435): tool definitions register cleanly with strict schemas and renderers', async () => {
  const registered = []
  const mockCtx = {
    tools: {
      register(def) {
        registered.push(def)
      },
    },
  }

  registerCapabilityTools(mockCtx, { cfg: { provider: 'fal' } })
  registerProjectProfileTools(mockCtx, {})

  assert.equal(registered.length, 4)

  const toolNames = registered.map((t) => t.name)
  assert.ok(toolNames.includes('select_image_model'))
  assert.ok(toolNames.includes('validate_model_features'))
  assert.ok(toolNames.includes('manage_project_profiles'))
  assert.ok(toolNames.includes('resolve_project_profile_params'))

  for (const t of registered) {
    assert.ok(t.parameters, `${t.name} must have parameters`)
    assert.equal(t.parameters.type, 'object')
    assert.equal(t.parameters.additionalProperties, false, `${t.name} root additionalProperties must be false`)
    assert.ok(typeof t.output?.render === 'function', `${t.name} must have output.render`)
  }

  // Execute select_image_model
  const selectTool = registered.find((t) => t.name === 'select_image_model')
  const selectRes = await selectTool.execute({ operations: ['txt2img'] })
  assert.equal(selectRes.ok, true)
  const rendered = selectTool.output.render({}, selectRes)
  assert.ok(rendered[0].text.includes('Recommended Model'))
})
