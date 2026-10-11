import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import {
  createVariantSession,
  selectVariantWinner,
  getVariantSession,
} from '../lib/variant-selection.js'

import {
  sanitizeLineageParams,
  normalizeLineageNode,
  buildLineageDAG,
  getImageLineage,
  getReplayPayload,
} from '../lib/lineage.js'

import { registerVariantTools } from '../lib/tools/variant-selection.js'
import { registerLineageTools } from '../lib/tools/lineage.js'

test('variants (#438): create session, validate minimum count, tag winner, and construct continuation payload', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-variants-test-'))
  const tempFile = path.join(tempDir, 'variants.json')

  try {
    // 1. Minimum count assertion
    assert.throws(() => {
      createVariantSession({ variants: [{ path: '/tmp/one.png' }] }, tempFile)
    }, /at least 2 image variants/i)

    // 2. Valid session creation
    const session = createVariantSession(
      {
        name: 'Logo Options',
        variants: [
          { path: '/tmp/logo_a.png', label: 'Option A', seed: 101, prompt: 'minimal geometric logo' },
          { path: '/tmp/logo_b.png', label: 'Option B', seed: 202, prompt: 'organic curved logo' },
          { path: '/tmp/logo_c.png', label: 'Option C', seed: 303, prompt: 'bold emblem logo' },
        ],
      },
      tempFile
    )

    assert.ok(session.selectionId)
    assert.equal(session.status, 'evaluating')
    assert.equal(session.variants.length, 3)

    // 3. Select winner with continuation action
    const selectRes = selectVariantWinner(
      session.selectionId,
      {
        winnerIndex: 1, // Option B
        refineIndexes: [0], // Keep A for refine
        nextAction: 'vectorize',
        actionParams: { mode: 'color', colors: 4 },
      },
      tempFile
    )

    assert.equal(selectRes.ok, true)
    assert.equal(selectRes.status, 'decided')
    assert.equal(selectRes.winner.index, 1)
    assert.equal(selectRes.winner.path, '/tmp/logo_b.png')

    // Continuation payload verification
    const cont = selectRes.continuationPayload
    assert.ok(cont)
    assert.equal(cont.action, 'vectorize')
    assert.equal(cont.sourceImage, '/tmp/logo_b.png')
    assert.equal(cont.params.image, '/tmp/logo_b.png')
    assert.equal(cont.params.mode, 'color')
    assert.equal(cont.params.colors, 4)

    // Check updated statuses in storage
    const updatedSession = getVariantSession(session.selectionId, tempFile)
    assert.equal(updatedSession.variants[1].status, 'winner')
    assert.equal(updatedSession.variants[0].status, 'refine')
    assert.equal(updatedSession.variants[2].status, 'discard')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('lineage (#439): parameter sanitization strips secrets and internal host paths', () => {
  const dirty = {
    apiKey: 'fal_secret_12345',
    authorization: 'Bearer xyz',
    prompt: 'a majestic mountain',
    image: '/mnt/external/Project/DEV/dhsplugins/source.png',
    windowsPath: 'C:\\Users\\admin\\test.jpg',
    nested: {
      userToken: 'token_abc',
      safeParam: 'allowed',
    },
  }

  const clean = sanitizeLineageParams(dirty)

  assert.equal(clean.apiKey, undefined)
  assert.equal(clean.authorization, undefined)
  assert.equal(clean.prompt, 'a majestic mountain')
  assert.equal(clean.image, 'source.png')
  assert.equal(clean.windowsPath, 'test.jpg')
  assert.equal(clean.nested.userToken, undefined)
  assert.equal(clean.nested.safeParam, 'allowed')
})

test('lineage (#439): builds DAG, handles legacy entries, resolves ancestry and child branches', () => {
  const historyFixture = [
    // 1. Root generation (legacy entry without revisionId)
    {
      id: 'gen_001',
      prompt: 'cyberpunk street corner',
      seed: 42,
      path: '/media/gen_001.webp',
      provider: 'fal',
      model: 'fal-ai/flux/dev',
    },
    // 2. Inpaint modification of gen_001
    {
      revisionId: 'rev_edit_002',
      parentId: 'gen_001',
      branchId: 'main',
      operation: 'edit',
      prompt: 'add neon sign saying CYBER',
      path: '/media/edit_002.webp',
      provider: 'fal',
    },
    // 3. Upscale of rev_edit_002
    {
      revisionId: 'rev_upscale_003',
      parentId: 'rev_edit_002',
      branchId: 'main',
      operation: 'upscale',
      prompt: 'add neon sign saying CYBER',
      path: '/media/upscale_003.webp',
      provider: 'fal',
    },
    // 4. Alternative branch directly from gen_001
    {
      revisionId: 'rev_alt_004',
      parentId: 'gen_001',
      branchId: 'mood_daylight',
      operation: 'edit',
      prompt: 'convert to sunny daytime street',
      path: '/media/alt_004.webp',
      provider: 'fal',
    },
  ]

  // Test ancestry of rev_upscale_003
  const lineage = getImageLineage('rev_upscale_003', historyFixture)
  assert.ok(lineage)
  assert.equal(lineage.target.revisionId, 'rev_upscale_003')
  assert.equal(lineage.depth, 2)
  assert.equal(lineage.ancestry[0].revisionId, 'gen_001') // root
  assert.equal(lineage.ancestry[1].revisionId, 'rev_edit_002') // intermediate

  // Test children of gen_001
  const rootLineage = getImageLineage('gen_001', historyFixture)
  assert.equal(rootLineage.children.length, 2)
  assert.ok(rootLineage.branches.includes('main'))
  assert.ok(rootLineage.branches.includes('mood_daylight'))

  // Test replay payload
  const replay = getReplayPayload('rev_edit_002', historyFixture)
  assert.equal(replay.ok, true)
  assert.equal(replay.tool, 'edit_image')
  assert.equal(replay.params.prompt, 'add neon sign saying CYBER')
  assert.ok(replay.reproducibilityNotes.includes('Cloud models may exhibit minor pixel variations'))
})

test('tools (#438, #439): tools register cleanly with schemas and renderers', async () => {
  const registered = []
  const mockCtx = {
    tools: {
      register(def) {
        registered.push(def)
      },
    },
  }

  registerVariantTools(mockCtx, {})
  registerLineageTools(mockCtx, {})

  assert.equal(registered.length, 4)
  const names = registered.map((t) => t.name)
  assert.ok(names.includes('evaluate_image_variants'))
  assert.ok(names.includes('select_variant_winner'))
  assert.ok(names.includes('inspect_image_lineage'))
  assert.ok(names.includes('get_image_replay_payload'))

  for (const t of registered) {
    assert.equal(t.parameters.type, 'object')
    assert.equal(t.parameters.additionalProperties, false, `${t.name} must have additionalProperties: false`)
    assert.ok(typeof t.output?.render === 'function', `${t.name} must have output.render`)
  }
})
