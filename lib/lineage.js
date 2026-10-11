/**
 * Image Lineage & Version Branching (#439)
 * Traverses parent-child relationships across revisions, provides DAG queries,
 * branching support, and sanitized parameter replay payloads.
 */

/**
 * Sanitizes parameters to remove credentials and internal server paths.
 */
export function sanitizeLineageParams(params = {}) {
  if (!params || typeof params !== 'object') return {}
  const sanitized = {}
  for (const [key, val] of Object.entries(params)) {
    const lowerKey = key.toLowerCase()
    // Exclude API keys and secrets
    if (
      lowerKey.includes('key') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('token') ||
      lowerKey.includes('auth') ||
      lowerKey.includes('password')
    ) {
      continue
    }

    if (typeof val === 'string') {
      // Clean host absolute paths (e.g. /mnt/external/... -> filename)
      if (val.startsWith('/mnt/') || val.startsWith('/home/') || val.includes(':\\')) {
        sanitized[key] = val.split(/[/\\]/).pop()
      } else {
        sanitized[key] = val
      }
    } else if (typeof val === 'object' && val !== null) {
      sanitized[key] = sanitizeLineageParams(val)
    } else {
      sanitized[key] = val
    }
  }
  return sanitized
}

/**
 * Normalizes history entry into standard lineage node.
 */
export function normalizeLineageNode(entry, idx = 0) {
  if (!entry) return null
  const revisionId = entry.revisionId || entry.id || entry.attachmentId || `rev_${entry.timestamp || idx}`
  const parentId = entry.parentId || entry.parentImageId || null
  const branchId = entry.branchId || 'main'
  const operation = entry.operation || (parentId ? 'edit' : 'generate')

  return {
    revisionId: String(revisionId),
    parentId: parentId ? String(parentId) : null,
    branchId: String(branchId),
    operation,
    timestamp: entry.timestamp || new Date().toISOString(),
    prompt: entry.prompt || '',
    seed: entry.seed !== undefined ? entry.seed : null,
    provider: entry.provider || 'unknown',
    model: entry.model || 'unknown',
    path: entry.path || entry.url || '',
    appliedProfile: entry.appliedProfile || null,
    params: sanitizeLineageParams(entry.params || {
      size: entry.size || entry.image_size,
      aspectRatio: entry.aspectRatio || entry.aspect_ratio,
      format: entry.format,
    }),
  }
}

/**
 * Builds Lineage DAG map from array of history entries.
 */
export function buildLineageDAG(historyEntries = []) {
  const nodes = new Map()
  const childrenMap = new Map()

  for (let i = 0; i < historyEntries.length; i++) {
    const node = normalizeLineageNode(historyEntries[i], i)
    if (node) {
      nodes.set(node.revisionId, node)
      // Also index by path or attachmentId for backward compatibility
      if (historyEntries[i].path) {
        nodes.set(historyEntries[i].path, node)
      }
      if (historyEntries[i].attachmentId) {
        nodes.set(historyEntries[i].attachmentId, node)
      }
    }
  }

  // Build children relationships
  for (const node of new Set(nodes.values())) {
    if (node.parentId) {
      const parent = nodes.get(node.parentId)
      const parentKey = parent ? parent.revisionId : node.parentId
      if (!childrenMap.has(parentKey)) {
        childrenMap.set(parentKey, [])
      }
      childrenMap.get(parentKey).push(node)
    }
  }

  return { nodes, childrenMap }
}

/**
 * Retrieves the full ancestry chain and child branches for a revision.
 */
export function getImageLineage(targetId, historyEntries = []) {
  if (!targetId) return null
  const { nodes, childrenMap } = buildLineageDAG(historyEntries)

  const targetNode = nodes.get(String(targetId))
  if (!targetNode) return null

  // 1. Ancestry chain (upward traversal from target to root)
  const ancestry = []
  let curr = targetNode
  const visited = new Set()

  while (curr && curr.parentId && !visited.has(curr.revisionId)) {
    visited.add(curr.revisionId)
    const parent = nodes.get(curr.parentId)
    if (parent) {
      ancestry.unshift(parent)
      curr = parent
    } else {
      // Parent exists outside current history limit
      ancestry.unshift({
        revisionId: curr.parentId,
        parentId: null,
        branchId: 'unknown',
        operation: 'unknown',
        prompt: '[Historical ancestor not in current window]',
        missing: true,
      })
      break
    }
  }

  // 2. Direct children and branches
  const children = childrenMap.get(targetNode.revisionId) || []
  const branches = [...new Set(children.map((c) => c.branchId))]

  return {
    target: targetNode,
    ancestry,
    children,
    branches,
    depth: ancestry.length,
  }
}

/**
 * Produces a sanitized replay payload for re-running generation from a specific revision.
 */
export function getReplayPayload(revisionId, historyEntries = []) {
  const lineage = getImageLineage(revisionId, historyEntries)
  if (!lineage) {
    return { ok: false, error: `Revision "${revisionId}" not found in history.` }
  }

  const node = lineage.target
  const toolName = node.operation === 'edit' ? 'edit_image' : 'generate_image'

  const replayParams = {
    prompt: node.prompt,
    ...(node.seed !== null ? { seed: node.seed } : {}),
    ...node.params,
  }

  if (node.parentId && node.operation === 'edit') {
    replayParams.image = node.parentId
  }

  return {
    ok: true,
    revisionId: node.revisionId,
    tool: toolName,
    provider: node.provider,
    model: node.model,
    params: replayParams,
    reproducibilityNotes:
      'Cloud models may exhibit minor pixel variations across runs with identical seed; ComfyUI/local models provide deterministic outputs when models and workflow match.',
  }
}
