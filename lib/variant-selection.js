import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Variant Comparison & Winner Selection Workflow (#438)
 * Manages side-by-side variant comparisons, winner/refine/discard tagging,
 * and continuation payload construction for downstream editing or upscaling.
 */

export function getVariantStoragePath(customPath) {
  if (customPath) return customPath
  if (process.env.DSH_VARIANT_STORAGE_PATH) return process.env.DSH_VARIANT_STORAGE_PATH
  const home = os.homedir() || '/tmp'
  return path.join(home, '.dsh', 'dsh-image-gen', 'variant-selections.json')
}

export function loadVariantSessions(storagePath) {
  const filePath = getVariantStoragePath(storagePath)
  try {
    if (!fs.existsSync(filePath)) return []
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    return []
  }
}

export function saveVariantSession(session, storagePath) {
  const filePath = getVariantStoragePath(storagePath)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const existing = loadVariantSessions(storagePath)
  const index = existing.findIndex((s) => s.selectionId === session.selectionId)
  if (index >= 0) {
    existing[index] = session
  } else {
    existing.push(session)
  }
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8')
  return session
}

export function getVariantSession(selectionId, storagePath) {
  const sessions = loadVariantSessions(storagePath)
  return sessions.find((s) => s.selectionId === selectionId) || null
}

/**
 * Creates a new variant evaluation session.
 */
export function createVariantSession(params, storagePath) {
  const {
    name = 'Variant Shootout',
    variants = [],
    criteria = {},
  } = params

  if (!Array.isArray(variants) || variants.length < 2) {
    throw new Error('Variant evaluation requires at least 2 image variants to compare.')
  }

  const selectionId = `vs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const preparedVariants = variants.map((v, idx) => ({
    index: idx,
    id: v.id || `v_${idx + 1}`,
    path: v.path || v.url || '',
    label: v.label || `Option ${idx + 1}`,
    seed: v.seed !== undefined ? v.seed : null,
    prompt: v.prompt || '',
    params: v.params || {},
    status: 'undecided', // 'undecided' | 'winner' | 'refine' | 'discard'
  }))

  const session = {
    selectionId,
    name,
    status: 'evaluating', // 'evaluating' | 'decided' | 'discarded'
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    criteria,
    winnerIndex: null,
    continuationPayload: null,
    variants: preparedVariants,
  }

  return saveVariantSession(session, storagePath)
}

/**
 * Selects the winning variant and constructs continuation payload for next step.
 */
export function selectVariantWinner(selectionId, options = {}, storagePath) {
  const session = getVariantSession(selectionId, storagePath)
  if (!session) {
    return { ok: false, error: `Variant session "${selectionId}" not found.` }
  }

  const {
    winnerIndex,
    winnerPath,
    refineIndexes = [],
    nextAction = 'none',
    actionParams = {},
  } = options

  // Find winner
  let winner = null
  if (typeof winnerIndex === 'number' && session.variants[winnerIndex]) {
    winner = session.variants[winnerIndex]
  } else if (winnerPath) {
    winner = session.variants.find((v) => v.path === winnerPath) || null
  }

  if (!winner) {
    return { ok: false, error: 'Valid winnerIndex or winnerPath must be specified.' }
  }

  // Update statuses
  for (const v of session.variants) {
    if (v.id === winner.id) {
      v.status = 'winner'
    } else if (refineIndexes.includes(v.index)) {
      v.status = 'refine'
    } else {
      v.status = 'discard'
    }
  }

  session.winnerIndex = winner.index
  session.status = 'decided'
  session.updatedAt = new Date().toISOString()

  // Construct continuation payload
  let continuationPayload = null
  if (nextAction && nextAction !== 'none') {
    continuationPayload = {
      action: nextAction,
      sourceImage: winner.path,
      parentImageId: winner.path,
      inheritedPrompt: winner.prompt,
      inheritedSeed: winner.seed,
      params: {
        ...winner.params,
        ...actionParams,
        image: winner.path,
      },
    }
  }

  session.continuationPayload = continuationPayload
  saveVariantSession(session, storagePath)

  return {
    ok: true,
    selectionId,
    status: 'decided',
    winner: {
      index: winner.index,
      id: winner.id,
      path: winner.path,
      label: winner.label,
    },
    continuationPayload,
  }
}
