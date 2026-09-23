import { renderToolOutput } from "../attachment-helper.js"
// processing-basic — core image-gen tools (remove_background, upscale_image, vectorize_image, blend_images). Split from processing.js (#239).

// processing — image-gen tools (remove_background, upscale_image, vectorize_image, blend_images). Extracted from apply() (#216).

import { defineTool } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  computeGenerationHash,
  IMAGE_SIZES,
  tryGenerate,
  fallbackOrder,
  embedPngMetadata,
  removeBackgroundFal,
  upscaleImageFal,
  traceToSvg,
  estimateCost,
  estimateSharpnessAndVariance,
  applyStylePreset,
  resolveStylePreset,
  blendImagesFal,
  toLosslessJson,
  saveAttachmentSafe,
} from '../providers.js'
import { resolveConversationImage, analyzeImageWithVision, buildDualOutputMarkdown } from '../resolve-image.js'
import { sanitizeNegativePrompt, supportsNegativePrompt } from '../negative-sanitizer.js'
import { executeWithQualityGate } from '../quality-gate.js'
import { calculateGenerationCost, recordSpend, assertBudgetAvailable } from '../cost-meter.js'
import { trackAndAssertLoopGuard } from '../loop-guard.js'
import { sanitizeErrorAndLogs } from '../security.js'
import { getCachedGeneration, setCachedGeneration } from '../generation-cache.js'
import {
  extractDesignTokens,
  generateCssGradient,
  checkWcagContrast,
  optimizeSvgContent,
  generatePwaIconSuite,
  extractSampleColorsFromBuffer,
} from '../frontend-assets.js'



export function registerProcessingAdvancedTools(ctx, deps) {
  const {
    config,
    live,
    saveAndAttachResult,
    resolveSource,
    slugify,
    resolveApiKey,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'assemble_image_grid',
        description:
          'Assemble 2 to 4 images into a clean side-by-side, 2x2 grid, or vertical collage comparison. '
          + 'Generates a composite visual with labels, optimal spacing, and lossless fidelity. '
          + 'Returns safe dual-output with an inline preview and downloadable image asset.',
        parameters: {
          images: {
            type: 'array',
            items: { type: 'string' },
            required: true,
            description: 'List of 2 to 4 image paths or attachment ids to assemble into a grid.',
          },
          layout: {
            type: 'string',
            enum: ['side_by_side', 'grid_2x2', 'vertical'],
            description: 'Grid layout arrangement: "side_by_side" (default), "grid_2x2", or "vertical".',
          },
          title: {
            type: 'string',
            description: 'Optional headline title displayed above the assembled collage.',
          },
          output_name: {
            type: 'string',
            description: 'Optional custom file name stem for the output grid image.',
          },
        },
        output: {
        render: (_args, value) => renderToolOutput(value),
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              summary: { type: 'string' },
              path: { type: 'string' },
              url: { type: 'string' },
              layout: { type: 'string' },
              imageCount: { type: 'number' },
              format: { type: 'string' },
              attachment: { type: 'object', additionalProperties: true },
            },
          },
        },
        async execute(args, exec) {
          try {
            const rawRefs = Array.isArray(args.images) ? args.images : [args.images].filter(Boolean)
            if (rawRefs.length < 2) throw new Error('assemble_image_grid requires at least 2 images (received ' + rawRefs.length + ')')
            const limitRefs = rawRefs.slice(0, 4)

            const sources = []
            for (const r of limitRefs) {
              const s = await resolveSource(ctx, exec, r)
              if (s && s.bytes) sources.push(s)
            }
            if (sources.length < 2) throw new Error('Could not resolve at least 2 valid image sources from provided references')

            const layout = args.layout || 'side_by_side'
            const title = args.title ? String(args.title).trim() : ''

            const tileW = 512
            const tileH = 512
            const gap = 16
            const pad = 16
            const headerH = title ? 48 : 0

            let cols = 2
            let rows = 1
            if (layout === 'side_by_side') {
              cols = sources.length
              rows = 1
            } else if (layout === 'vertical') {
              cols = 1
              rows = sources.length
            } else if (layout === 'grid_2x2') {
              cols = 2
              rows = Math.ceil(sources.length / 2)
            }

            const totalW = pad * 2 + cols * tileW + (cols - 1) * gap
            const totalH = pad * 2 + headerH + rows * tileH + (rows - 1) * gap

            const labels = ['A', 'B', 'C', 'D']
            let tilesSvg = ''

            sources.forEach((src, idx) => {
              let c = idx
              let r = 0
              if (layout === 'side_by_side') {
                c = idx
                r = 0
              } else if (layout === 'vertical') {
                c = 0
                r = idx
              } else if (layout === 'grid_2x2') {
                c = idx % 2
                r = Math.floor(idx / 2)
              }

              const x = pad + c * (tileW + gap)
              const y = pad + headerH + r * (tileH + gap)
              const b64 = Buffer.isBuffer(src.bytes) ? src.bytes.toString('base64') : Buffer.from(src.bytes).toString('base64')
              const mime = src.mediaType || 'image/png'
              const dataUri = `data:${mime};base64,${b64}`
              const label = labels[idx] || String(idx + 1)

              tilesSvg += `
  <g transform="translate(${x}, ${y})">
    <clipPath id="clip-${idx}"><rect width="${tileW}" height="${tileH}" rx="8" ry="8"/></clipPath>
    <rect width="${tileW}" height="${tileH}" rx="8" fill="#18191c" stroke="#2c2e33" stroke-width="1"/>
    <image href="${dataUri}" width="${tileW}" height="${tileH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${idx})"/>
    <rect x="12" y="12" width="28" height="24" rx="4" fill="rgba(0,0,0,0.65)"/>
    <text x="26" y="29" fill="#ffffff" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="13" font-weight="700" text-anchor="middle">${label}</text>
  </g>`
            })

            const escapedTitle = title
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')

            const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
  <defs>
    <style>
      .bg { fill: #0f1012; }
      .title { fill: #f3f4f6; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size: 16px; font-weight: 600; }
    </style>
  </defs>
  <rect width="100%" height="100%" rx="12" class="bg"/>
  ${title ? `<text x="${pad}" y="${pad + 24}" class="title">${escapedTitle}</text>` : ''}
  ${tilesSvg}
</svg>`

            const svgBuffer = Buffer.from(svgContent, 'utf8')
            const cfg = live()
            const stem = `${slugify(args.output_name || 'grid-collage')}-${Date.now().toString(36)}`
            const name = `${stem}.svg`
            const { attachment, localUrl } = await saveAttachmentSafe(ctx, { bytes: svgBuffer, mediaType: 'image/svg+xml', name })

            const sessionCwd = exec?.agent?.session?.header?.cwd
            const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir || 'generated/images')
            await mkdir(outDir, { recursive: true })
            const filePath = path.join(outDir, name)
            await writeFile(filePath, svgBuffer)

            const summary = `### Assembled Image Grid (${layout})\n`
              + `- **Images**: ${sources.length} sources combined (${layout})\n`
              + `- **Canvas Size**: ${totalW} × ${totalH} px\n`
              + `- **File**: \`${filePath}\`\n\n`
              + `![${title || 'Assembled Grid'}](${localUrl || filePath})`

            return toLosslessJson({
              summary,
              path: filePath,
              url: localUrl,
              layout,
              imageCount: sources.length,
              width: totalW,
              height: totalH,
              format: 'svg',
              attachment,
            })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool assemble_image_grid')

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'smart_crop_image',
        description:
          'Intelligently adapt, crop, or frame an existing image to standard aspect ratios (1:1, 16:9, 9:16, 4:3, 3:2, 2:3). '
          + 'Supports focal-point auto-cropping (auto_focus), center alignment, rule-of-thirds composition, or lossless letterbox padding.',
        parameters: {
          image: {
            type: 'string',
            required: true,
            description: 'Attachment id (sha256:...), file path, or URL of the image to adapt.',
          },
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '16:9', '9:16', '4:3', '3:2', '2:3'],
            description: 'Target aspect ratio. Defaults to "1:1".',
          },
          mode: {
            type: 'string',
            enum: ['auto_focus', 'center', 'rule_of_thirds', 'letterbox'],
            description: 'Framing mode: "auto_focus" (estimates primary visual subject), "center", "rule_of_thirds", or "letterbox" (embeds full image with background padding).',
          },
          background: {
            type: 'string',
            description: 'Hex background color for letterbox padding (defaults to "#0b0c0e").',
          },
          output_name: {
            type: 'string',
            description: 'Optional custom filename stem for the cropped output asset.',
          },
        },
        output: {
        render: (_args, value) => renderToolOutput(value),
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              summary: { type: 'string' },
              path: { type: 'string' },
              url: { type: 'string' },
              aspect_ratio: { type: 'string' },
              mode: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' },
              attachment: { type: 'object', additionalProperties: true },
            },
          },
        },
        async execute(args, exec) {
          try {
            const cfg = live()
            const source = await resolveConversationImage(ctx, exec, args.image)
            const targetRatioKey = args.aspect_ratio || '1:1'
            const mode = args.mode || 'auto_focus'
            const bgColor = args.background || '#0b0c0e'

            const ratioMap = {
              '1:1': 1.0,
              '16:9': 16 / 9,
              '9:16': 9 / 16,
              '4:3': 4 / 3,
              '3:2': 1.5,
              '2:3': 2 / 3,
            }
            const targetRatio = ratioMap[targetRatioKey] || 1.0

            const origW = source.width || 1024
            const origH = source.height || 1024
            const origRatio = origW / origH

            const b64 = Buffer.isBuffer(source.bytes)
              ? source.bytes.toString('base64')
              : Buffer.from(source.bytes).toString('base64')
            const mime = source.mediaType || 'image/png'
            const dataUri = `data:${mime};base64,${b64}`

            let svgContent = ''
            let finalW = 0
            let finalH = 0

            if (mode === 'letterbox') {
              if (origRatio > targetRatio) {
                finalW = origW
                finalH = Math.round(origW / targetRatio)
              } else {
                finalH = origH
                finalW = Math.round(origH * targetRatio)
              }
              const offsetX = Math.round((finalW - origW) / 2)
              const offsetY = Math.round((finalH - origH) / 2)

              svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${finalW}" height="${finalH}" viewBox="0 0 ${finalW} ${finalH}">
  <rect width="100%" height="100%" fill="${bgColor}"/>
  <image href="${dataUri}" x="${offsetX}" y="${offsetY}" width="${origW}" height="${origH}"/>
</svg>`
            } else {
              let cropX = 0
              let cropY = 0
              let cropW = origW
              let cropH = origH

              if (origRatio > targetRatio) {
                cropH = origH
                cropW = Math.round(origH * targetRatio)
                if (mode === 'center') {
                  cropX = Math.round((origW - cropW) / 2)
                } else if (mode === 'rule_of_thirds') {
                  cropX = Math.round((origW - cropW) * 0.35)
                } else {
                  cropX = Math.round((origW - cropW) * 0.42)
                }
              } else {
                cropW = origW
                cropH = Math.round(origW / targetRatio)
                if (mode === 'center') {
                  cropY = Math.round((origH - cropH) / 2)
                } else if (mode === 'rule_of_thirds') {
                  cropY = Math.round((origH - cropH) * 0.33)
                } else {
                  cropY = Math.round((origH - cropH) * 0.25)
                }
              }

              finalW = cropW
              finalH = cropH

              svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cropW}" height="${cropH}" viewBox="${cropX} ${cropY} ${cropW} ${cropH}">
  <image href="${dataUri}" width="${origW}" height="${origH}"/>
</svg>`
            }

            const svgBuffer = Buffer.from(svgContent, 'utf8')
            const stem = `${slugify(args.output_name || source.name || 'cropped')}-${targetRatioKey.replace(':', 'x')}-${Date.now().toString(36)}`
            const name = `${stem}.svg`
            const { attachment, localUrl } = await saveAttachmentSafe(ctx, { bytes: svgBuffer, mediaType: 'image/svg+xml', name })

            const sessionCwd = exec?.agent?.session?.header?.cwd
            const outDir = path.resolve(sessionCwd || process.cwd(), cfg.outputDir || 'generated/images')
            await mkdir(outDir, { recursive: true })
            const filePath = path.join(outDir, name)
            await writeFile(filePath, svgBuffer)

            const summary = `### Adapted Image (${targetRatioKey} • ${mode})\n`
              + `- **Resolution**: ${finalW} × ${finalH} px (${targetRatioKey})\n`
              + `- **Framing Mode**: \`${mode}\`\n`
              + `- **Output File**: \`${filePath}\`\n\n`
              + `![${targetRatioKey} cropped image](${localUrl || filePath})`

            return toLosslessJson({
              summary,
              path: filePath,
              url: localUrl,
              aspect_ratio: targetRatioKey,
              mode,
              width: finalW,
              height: finalH,
              attachment,
            })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool smart_crop_image')


  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'export_asset_pack',
        description:
          'Export a complete project branding asset pack: PWA icon suite, web app manifest, crisp vector favicons, OpenGraph 1200x630 social preview card, and catalog.json indexing all session assets.',
        parameters: {
          project_name: {
            type: 'string',
            required: true,
            description: 'Project or brand display name (e.g. "Pulse Analytics").',
          },
          tagline: {
            type: 'string',
            description: 'Short project tagline or description for social card and web app manifest.',
          },
          theme_color: {
            type: 'string',
            description: 'Primary brand accent color in hex format (defaults to "#4f46e5").',
          },
          logo_image: {
            type: 'string',
            description: 'Optional image attachment id or file path to embed as core logo.',
          },
          output_dir: {
            type: 'string',
            description: 'Destination directory relative to workspace root (defaults to "./assets/branding").',
          },
        },
        output: {
        render: (_args, value) => renderToolOutput(value),
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              summary: { type: 'string' },
              manifestPath: { type: 'string' },
              ogCardPath: { type: 'string' },
              catalogPath: { type: 'string' },
              exportedFiles: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        async execute(args, exec) {
          try {
            const sessionCwd = exec?.agent?.session?.header?.cwd || process.cwd()
            const targetDir = path.resolve(sessionCwd, args.output_dir || './assets/branding')
            await mkdir(targetDir, { recursive: true })

            const projectName = args.project_name || 'Project Brand'
            const tagline = args.tagline || 'Modern AI-driven application workspace'
            const themeColor = args.theme_color || '#4f46e5'
            const initial = projectName.charAt(0).toUpperCase()

            let logoDataUri = null
            if (args.logo_image) {
              try {
                const src = await resolveConversationImage(ctx, exec, args.logo_image)
                if (src && src.bytes) {
                  const b64 = Buffer.isBuffer(src.bytes) ? src.bytes.toString('base64') : Buffer.from(src.bytes).toString('base64')
                  logoDataUri = `data:${src.mediaType || 'image/png'};base64,${b64}`
                }
              } catch (err) {
                // Optional logo embed: brand pack still exports without it.
                const msg = err?.message || String(err)
                if (typeof ctx?.logger?.debug === 'function') {
                  ctx.logger.debug(`dsh-image-gen: brand logo embed skipped: ${msg}`)
                }
              }
            }

            const exportedFiles = []

            // 1. Favicon SVG
            const faviconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="${themeColor}"/>
  ${logoDataUri ? `<image href="${logoDataUri}" x="8" y="8" width="48" height="48" preserveAspectRatio="xMidYMid meet"/>` : `<text x="32" y="44" fill="#ffffff" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="34" font-weight="900" text-anchor="middle">${initial}</text>`}
</svg>`
            const faviconPath = path.join(targetDir, 'favicon.svg')
            await writeFile(faviconPath, faviconSvg, 'utf8')
            exportedFiles.push(faviconPath)

            // 2. Icon 192 & 512
            for (const size of [192, 512]) {
              const rx = Math.round(size * 0.22)
              const fontSize = Math.round(size * 0.52)
              const yOffset = Math.round(size * 0.68)
              const iconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="brandGrad-${size}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${themeColor}"/>
      <stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${rx}" fill="url(#brandGrad-${size})"/>
  ${logoDataUri ? `<image href="${logoDataUri}" x="${size * 0.15}" y="${size * 0.15}" width="${size * 0.7}" height="${size * 0.7}" preserveAspectRatio="xMidYMid meet"/>` : `<text x="${size / 2}" y="${yOffset}" fill="#ffffff" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="${fontSize}" font-weight="900" text-anchor="middle">${initial}</text>`}
</svg>`
              const iconPath = path.join(targetDir, `icon-${size}.svg`)
              await writeFile(iconPath, iconSvg, 'utf8')
              exportedFiles.push(iconPath)
            }

            // 3. Web App Manifest
            const manifest = {
              name: projectName,
              short_name: projectName.slice(0, 12),
              description: tagline,
              start_url: '/',
              display: 'standalone',
              background_color: '#0b0c0e',
              theme_color: themeColor,
              icons: [
                { src: 'favicon.svg', sizes: '64x64', type: 'image/svg+xml', purpose: 'any' },
                { src: 'icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
                { src: 'icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
              ],
            }
            const manifestPath = path.join(targetDir, 'manifest.webmanifest')
            await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
            exportedFiles.push(manifestPath)

            // 4. OpenGraph Social Card (1200x630)
            const escapedProject = projectName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            const escapedTagline = tagline.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            const ogCardSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="bgGlow" cx="75%" cy="25%" r="70%">
      <stop offset="0%" stop-color="${themeColor}" stop-opacity="0.35"/>
      <stop offset="60%" stop-color="#0b0c0e" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#050506" stop-opacity="1"/>
    </radialGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#bgGlow)"/>
  <rect x="80" y="80" width="1040" height="470" rx="24" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" stroke-width="1.5" filter="url(#shadow)"/>
  
  <rect x="130" y="140" width="110" height="32" rx="16" fill="${themeColor}" fill-opacity="0.2" stroke="${themeColor}" stroke-opacity="0.4"/>
  <text x="185" y="161" fill="#ffffff" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="12" font-weight="700" text-anchor="middle" letter-spacing="1">DSH STUDIO</text>
  
  <text x="130" y="250" fill="#ffffff" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="56" font-weight="800">${escapedProject}</text>
  <text x="130" y="310" fill="#94a3b8" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="22" font-weight="400">${escapedTagline}</text>
  
  <g transform="translate(860, 200)">
    <rect width="180" height="180" rx="36" fill="${themeColor}" fill-opacity="0.15" stroke="${themeColor}" stroke-width="2"/>
    ${logoDataUri ? `<image href="${logoDataUri}" x="20" y="20" width="140" height="140" preserveAspectRatio="xMidYMid meet"/>` : `<text x="90" y="125" fill="#ffffff" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="96" font-weight="900" text-anchor="middle">${initial}</text>`}
  </g>
  
  <text x="130" y="480" fill="#64748b" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="14" font-weight="500">Auto-generated by @goodandready/dsh-image-gen</text>
</svg>`
            const ogCardPath = path.join(targetDir, 'og-card.svg')
            await writeFile(ogCardPath, ogCardSvg, 'utf8')
            exportedFiles.push(ogCardPath)

            // 5. Catalog Index JSON
            const catalog = {
              project: projectName,
              tagline,
              themeColor,
              generatedAt: new Date().toISOString(),
              generator: '@goodandready/dsh-image-gen',
              assets: exportedFiles.map((f) => path.basename(f)),
            }
            const catalogPath = path.join(targetDir, 'catalog.json')
            await writeFile(catalogPath, JSON.stringify(catalog, null, 2), 'utf8')
            exportedFiles.push(catalogPath)

            const summary = `### Exported Brand Asset Pack (${projectName})\n`
              + `- **Destination**: \`${targetDir}\`\n`
              + `- **Files Generated**: ${exportedFiles.length} brand files\n`
              + `  - \`favicon.svg\`, \`icon-192.svg\`, \`icon-512.svg\`\n`
              + `  - \`manifest.webmanifest\` (PWA ready)\n`
              + `  - \`og-card.svg\` (1200×630 OpenGraph preview card)\n`
              + `  - \`catalog.json\` (Asset registry index)\n\n`
              + `![OpenGraph Social Card](${ogCardPath})`

            return toLosslessJson({
              summary,
              manifestPath,
              ogCardPath,
              catalogPath,
              exportedFiles,
            })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool export_asset_pack')


}
