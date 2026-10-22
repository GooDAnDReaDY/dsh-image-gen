// @ts-check
import path from 'node:path'
import fs from 'node:fs/promises'
import { isTrustedLocalRequest, resolveInside, getRouteRejectionStatus, getRouteWriteRejectionStatus, getConnection, safeJsonHandler } from './security.js'

/**
 * Format image buffer or SVG string into targeted design clipboard payloads.
 *
 * @param {object} params
 * @param {Buffer} params.buffer Image bytes
 * @param {string} [params.mimeType] MIME type (image/png, image/jpeg, image/svg+xml, etc.)
 * @param {string} [params.name] Asset name or filename
 * @param {number} [params.width] Width in px
 * @param {number} [params.height] Height in px
 * @param {string} [params.target] 'all' | 'opendesign' | 'clipboard_svg' | 'clipboard_dataurl' | 'penpot_snippet' | 'figma_html'
 * @returns {object} Formatted design payloads
 */
export function formatDesignExportPayload({
  buffer,
  mimeType = 'image/png',
  name = 'design-asset',
  width = 1024,
  height = 1024,
  target = 'all',
}) {
  const isSvg = mimeType.includes('svg') || (buffer && buffer.subarray(0, 100).toString('utf8').includes('<svg'))
  const base64Data = buffer ? buffer.toString('base64') : ''
  const effectiveMime = isSvg ? 'image/svg+xml' : (mimeType || 'image/png')
  const dataUrl = `data:${effectiveMime};base64,${base64Data}`
  const svgMarkup = isSvg && buffer ? buffer.toString('utf8') : ''

  const safeName = String(name || 'asset').replace(/[^a-zA-Z0-9_-]/g, '_')

  // HTML clipboard snippet compatible with Figma / Penpot / browser paste
  const figmaHtml = isSvg && svgMarkup
    ? svgMarkup
    : `<img src="${dataUrl}" alt="${safeName}" width="${width}" height="${height}" style="max-width:100%;height:auto;" />`

  // Penpot-friendly snippet (SVG wrapper or embedded image object)
  const penpotSnippet = isSvg && svgMarkup
    ? svgMarkup
    : `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="${dataUrl}" width="${width}" height="${height}"/></svg>`

  // CSS snippet
  const cssBackground = `background-image: url("${dataUrl}");\nbackground-size: contain;\nbackground-repeat: no-repeat;`

  return {
    name: safeName,
    mimeType: effectiveMime,
    isSvg,
    width,
    height,
    dataUrl,
    svgMarkup: svgMarkup || null,
    figmaHtml,
    penpotSnippet,
    cssBackground,
  }
}

/**
 * Push an asset directly into an OpenDesign project folder if the daemon / project directory exists.
 *
 * @param {object} params
 * @param {Buffer} params.buffer Asset bytes
 * @param {string} params.filename Target filename (e.g. hero-illustration.png)
 * @param {string} params.projectId OpenDesign project id or name
 * @param {string} [params.openDesignRoot] Path to .od/projects directory
 * @returns {Promise<{ ok: boolean, savedPath?: string, error?: string }>}
 */
export async function pushAssetToOpenDesignProject({
  buffer,
  filename,
  projectId,
  openDesignRoot = path.join(process.env.HOME || '/home/vadim', 'open-design', '.od', 'projects'),
}) {
  if (!buffer || !buffer.length) {
    return { ok: false, error: 'Empty buffer provided for design asset export' }
  }
  if (!projectId) {
    return { ok: false, error: 'Missing projectId for OpenDesign export' }
  }

  const safeProjectId = path.basename(projectId)
  const safeFilename = path.basename(filename || `asset-${Date.now()}.png`)
  const projectDir = path.join(openDesignRoot, safeProjectId)

  try {
    const stats = await fs.stat(projectDir)
    if (!stats.isDirectory()) {
      return { ok: false, error: `OpenDesign project path is not a directory: ${projectDir}` }
    }
  } catch (err) {
    return { ok: false, error: `OpenDesign project not found on disk: ${safeProjectId} (${err?.message || err})` }
  }

  const targetPath = resolveInside(projectDir, safeFilename)
  try {
    await fs.writeFile(targetPath, buffer)
    return {
      ok: true,
      savedPath: targetPath,
      filename: safeFilename,
      bytes: buffer.length,
      projectId: safeProjectId,
    }
  } catch (err) {
    return { ok: false, error: `Failed to write file to OpenDesign project: ${err?.message || err}` }
  }
}

/**
 * Register design export routes on DSH web server.
 *
 * @param {object} ctx Cordis context
 * @param {object} deps Dependencies ({ resolveSource })
 */
export function registerDesignExportRoutes(ctx, deps) {
  const { resolveSource } = deps

  ctx.effect(() => {
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-image-gen/design/export',
      handler: safeJsonHandler(async (req, res) => {
        if (!isTrustedLocalRequest(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'forbidden: local trusted requests only' }))
          return
        }

        if (req.method === 'POST') {
          const writeRejection = getRouteWriteRejectionStatus(req, { connection: getConnection(ctx) })
          if (writeRejection !== undefined) {
            res.writeHead(writeRejection, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: writeRejection === 401 ? 'unauthorized' : 'forbidden' }))
            return
          }
        } else if (req.method === 'GET') {
          const rejection = getRouteRejectionStatus(req, { connection: getConnection(ctx) })
          if (rejection !== undefined) {
            res.writeHead(rejection, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' }))
            return
          }
        }

        if (req.method === 'GET' || req.method === 'POST') {
          try {
            const url = new URL(req.url, 'http://localhost')
            let image = url.searchParams.get('image') || url.searchParams.get('id')
            let target = url.searchParams.get('target') || 'all'
            let projectId = url.searchParams.get('projectId') || url.searchParams.get('project') || ''
            let name = url.searchParams.get('name') || 'exported-asset'

            if (req.method === 'POST') {
              let bodyStr = ''
              for await (const chunk of req) bodyStr += chunk
              if (bodyStr) {
                try {
                  const parsed = JSON.parse(bodyStr)
                  if (parsed.image) image = parsed.image
                  if (parsed.target) target = parsed.target
                  if (parsed.projectId) projectId = parsed.projectId
                  if (parsed.name) name = parsed.name
                } catch (_) { /* ignore JSON parse error */ }
              }
            }

            if (!image) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Missing image or id parameter' }))
              return
            }

            const source = await resolveSource(ctx, null, image)
            if (!source || !source.bytes) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: `Image source not found: ${image}` }))
              return
            }

            const formatted = formatDesignExportPayload({
              buffer: source.bytes,
              mimeType: source.mediaType || 'image/png',
              name,
              width: source.width || 1024,
              height: source.height || 1024,
              target,
            })

            let openDesignResult = null
            if (projectId) {
              const ext = formatted.isSvg ? '.svg' : '.png'
              const fn = name.endsWith(ext) ? name : `${name}${ext}`
              openDesignResult = await pushAssetToOpenDesignProject({
                buffer: source.bytes,
                filename: fn,
                projectId,
              })
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              ok: true,
              export: formatted,
              openDesign: openDesignResult,
            }))
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
          }
          return
        }

        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }))
      }, ctx),
    })
  }, 'dsh-image-gen: route /dsh-image-gen/design/export')
}
