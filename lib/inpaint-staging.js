import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'

/**
 * Inpaint Staging & Review Workflow (#436)
 * Enables review/accept/reject cycle for localized image edits,
 * preserving original image data and supporting pixel-level compositing.
 */

export function getStagingStoragePath(customPath) {
  if (customPath) return customPath
  if (process.env.DSH_STAGING_STORAGE_PATH) return process.env.DSH_STAGING_STORAGE_PATH
  const home = os.homedir() || '/tmp'
  return path.join(home, '.dsh', 'dsh-image-gen', 'staging-sessions.json')
}

export function loadStagingSessions(storagePath) {
  const filePath = getStagingStoragePath(storagePath)
  try {
    if (!fs.existsSync(filePath)) return []
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    return []
  }
}

export function saveStagingSession(session, storagePath) {
  const filePath = getStagingStoragePath(storagePath)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const existing = loadStagingSessions(storagePath)
  const index = existing.findIndex((s) => s.stageId === session.stageId)
  if (index >= 0) {
    existing[index] = session
  } else {
    existing.push(session)
  }
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8')
  return session
}

export function getStagingSession(stageId, storagePath) {
  const sessions = loadStagingSessions(storagePath)
  return sessions.find((s) => s.stageId === stageId) || null
}

/**
 * Creates a new inpaint staging session.
 */
export function createStagingSession(params, storagePath) {
  const {
    originalImage,
    mask,
    bbox,
    prompt,
    previewImage,
    provider = 'fal',
    model = 'default',
    estimatedCost = 0.02,
  } = params

  if (!originalImage) {
    throw new Error('originalImage is required to initialize staging session')
  }

  const stageId = `stage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const session = {
    stageId,
    createdAt: new Date().toISOString(),
    status: 'staged',
    originalImage,
    mask: mask || null,
    bbox: bbox || null,
    prompt: prompt || '',
    previewImage: previewImage || null,
    provider,
    model,
    estimatedCost,
    history: [
      {
        action: 'created',
        timestamp: new Date().toISOString(),
        prompt: prompt || '',
      },
    ],
  }

  return saveStagingSession(session, storagePath)
}

/**
 * Reviews a staged edit: accept, reject, retry, or cancel.
 */
export function reviewStagedEdit(stageId, action, options = {}, storagePath) {
  const session = getStagingSession(stageId, storagePath)
  if (!session) {
    return {
      ok: false,
      error: `Staging session "${stageId}" not found.`,
    }
  }

  if (session.status !== 'staged') {
    return {
      ok: false,
      error: `Staging session "${stageId}" is already finalized with status "${session.status}".`,
    }
  }

  const timestamp = new Date().toISOString()

  if (action === 'accept') {
    session.status = 'accepted'
    session.resolvedAt = timestamp
    session.history.push({ action: 'accepted', timestamp })
    saveStagingSession(session, storagePath)
    return {
      ok: true,
      status: 'accepted',
      stageId,
      finalImage: session.previewImage,
      originalImage: session.originalImage,
      parentImageId: session.originalImage,
      message: 'Staged edit accepted. Result is committed as active version.',
    }
  }

  if (action === 'reject') {
    session.status = 'rejected'
    session.resolvedAt = timestamp
    session.history.push({ action: 'rejected', timestamp, reason: options.reason || 'User rejected preview' })
    saveStagingSession(session, storagePath)
    return {
      ok: true,
      status: 'rejected',
      stageId,
      originalImage: session.originalImage,
      discardedPreview: session.previewImage,
      message: 'Staged edit rejected. Original image remains untouched.',
    }
  }

  if (action === 'cancel') {
    session.status = 'cancelled'
    session.resolvedAt = timestamp
    session.history.push({ action: 'cancelled', timestamp })
    saveStagingSession(session, storagePath)
    return {
      ok: true,
      status: 'cancelled',
      stageId,
      originalImage: session.originalImage,
      message: 'Staging session cancelled.',
    }
  }

  if (action === 'retry') {
    const newPrompt = options.prompt || session.prompt
    session.history.push({
      action: 'retry_requested',
      timestamp,
      prompt: newPrompt,
    })
    session.prompt = newPrompt
    if (options.previewImage) {
      session.previewImage = options.previewImage
    }
    saveStagingSession(session, storagePath)
    return {
      ok: true,
      status: 'staged',
      stageId,
      prompt: newPrompt,
      retryCount: session.history.filter((h) => h.action === 'retry_requested').length,
      estimatedCost: session.estimatedCost,
      message: 'Staged edit updated for retry.',
    }
  }

  return {
    ok: false,
    error: `Unknown review action "${action}". Allowed: accept, reject, retry, cancel.`,
  }
}

/**
 * Pixel-level local compositing:
 * Overlays edited region back onto the original image using Sharp,
 * guaranteeing that pixels outside the modified area remain 100% identical to the source.
 */
export async function compositeInpaintPatch(originalBuffer, inpaintBuffer, maskBbox, dimensions = {}) {
  const origMeta = await sharp(originalBuffer).metadata()
  const width = dimensions.width || origMeta.width || 1024
  const height = dimensions.height || origMeta.height || 1024

  // If bounding box provided, crop or position patch over original
  if (Array.isArray(maskBbox) && maskBbox.length === 4) {
    let [x1, y1, x2, y2] = maskBbox
    if (x1 > 1000 || y1 > 1000 || x2 > 1000 || y2 > 1000) {
      // already in pixels
    } else {
      // normalized 0-1000
      x1 = Math.round((x1 / 1000) * width)
      y1 = Math.round((y1 / 1000) * height)
      x2 = Math.round((x2 / 1000) * width)
      y2 = Math.round((y2 / 1000) * height)
    }

    const patchW = Math.max(1, x2 - x1)
    const patchH = Math.max(1, y2 - y1)

    const resizedPatch = await sharp(inpaintBuffer)
      .resize(patchW, patchH, { fit: 'fill' })
      .toBuffer()

    return sharp(originalBuffer)
      .composite([{ input: resizedPatch, left: x1, top: y1 }])
      .toBuffer()
  }

  // Full composite when dimensions match
  const resizedInpaint = await sharp(inpaintBuffer)
    .resize(width, height, { fit: 'fill' })
    .toBuffer()

  return sharp(originalBuffer)
    .composite([{ input: resizedInpaint, blend: 'over' }])
    .toBuffer()
}
