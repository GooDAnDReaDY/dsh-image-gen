import { renderToolOutput } from "../attachment-helper.js"
// frontend — image-gen tools (extract_design_tokens, image_to_css_gradient, check_image_contrast, optimize_vector_svg, generate_pwa_icon_suite). Extracted from apply() (#216).

import { defineTool } from '@deepseek-ai/dsh-tools'
import { toLosslessJson } from '../providers.js'
import { sanitizeErrorAndLogs } from '../security.js'
import {
  extractDesignTokens,
  generateCssGradient,
  checkWcagContrast,
  optimizeSvgContent,
  generatePwaIconSuite,
  extractSampleColorsFromBuffer,
} from '../frontend-assets.js'

export function registerFrontendTools(ctx, deps) {
  const { resolveSource } = deps
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'extract_design_tokens',
        description: 'Extract design tokens (CSS variables, Tailwind colors config, W3C tokens JSON) from an image or palette.',
        parameters: {
          image: { type: 'string', description: 'Path or attachment ID of the image to extract colors from.' },
          colors: { type: 'array', items: { type: 'string' }, description: 'Optional list of hex colors if already known.' },
          prefix: { type: 'string', description: 'Token naming prefix (default: color).' },
        },
        output: {
        render: (_args, value) => renderToolOutput(value),
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              tokens: { type: 'object', additionalProperties: true },
              cssVariables: { type: 'string' },
              tailwindSnippet: { type: 'string' },
              w3cTokens: { type: 'object', additionalProperties: true },
            },
          },
        },
        async execute(args, exec) {
          let colors = args.colors
          if (!colors || colors.length === 0) {
            if (args.image) {
              const source = await resolveSource(ctx, exec, args.image)
              if (!source || !source.bytes) {
                throw new Error('Image not found or unreadable: ' + args.image)
              }
              colors = extractSampleColorsFromBuffer(source.bytes)
            }
          }
          return toLosslessJson(extractDesignTokens(colors, { prefix: args.prefix }))
        },
      }),
    )
  }, 'dsh-image-gen: tool extract_design_tokens')
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'image_to_css_gradient',
        description: 'Convert an image background or color palette into a lightweight pure CSS gradient (< 1KB).',
        parameters: {
          image: { type: 'string', description: 'Path or attachment ID of the image.' },
          colors: { type: 'array', items: { type: 'string' }, description: 'Optional explicit hex colors for the gradient.' },
          type: { type: 'string', enum: ['mesh', 'linear', 'radial'], description: 'Gradient type: mesh, linear, or radial (default: mesh).' },
        },
        output: {
        render: (_args, value) => renderToolOutput(value),
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              type: { type: 'string' },
              fallbackColor: { type: 'string' },
              gradientCss: { type: 'string' },
              completeStyle: { type: 'string' },
              byteSize: { type: 'number' },
            },
          },
        },
        async execute(args, exec) {
          let colors = args.colors
          if (!colors || colors.length === 0) {
            if (args.image) {
              const source = await resolveSource(ctx, exec, args.image)
              if (!source || !source.bytes) {
                throw new Error('Image not found or unreadable: ' + args.image)
              }
              colors = extractSampleColorsFromBuffer(source.bytes)
            }
          }
          return toLosslessJson(generateCssGradient(colors, args.type || 'mesh'))
        },
      }),
    )
  }, 'dsh-image-gen: tool image_to_css_gradient')
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'check_image_contrast',
        description: 'Check image background contrast ratio against text color according to WCAG 2.1 AA/AAA standards and suggest scrim.',
        parameters: {
          image: { type: 'string', description: 'Path or attachment ID of the image.' },
          colors: { type: 'array', items: { type: 'string' }, description: 'Optional list of background hex colors.' },
          text_color: { type: 'string', description: 'Text hex color to test against (default: #ffffff).' },
        },
        output: {
        render: (_args, value) => renderToolOutput(value),
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              textHex: { type: 'string' },
              minContrastRatio: { type: 'number' },
              passedAA: { type: 'boolean' },
              passedAALarge: { type: 'boolean' },
              passedAAA: { type: 'boolean' },
              recommendation: { type: 'string' },
              suggestedScrimCss: { type: 'string' },
              details: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
          },
        },
        async execute(args, exec) {
          let colors = args.colors
          if (!colors || colors.length === 0) {
            if (args.image) {
              const source = await resolveSource(ctx, exec, args.image)
              if (!source || !source.bytes) {
                throw new Error('Image not found or unreadable: ' + args.image)
              }
              colors = extractSampleColorsFromBuffer(source.bytes)
            }
          }
          return toLosslessJson(checkWcagContrast(colors, args.text_color || '#ffffff'))
        },
      }),
    )
  }, 'dsh-image-gen: tool check_image_contrast')
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'optimize_vector_svg',
        description: 'Clean, sanitize, and minify SVG content, normalize viewBox, and export React TSX component.',
        parameters: {
          svg_content: { type: 'string', description: 'Raw SVG markup string to optimize.' },
          image: { type: 'string', description: 'Path or attachment ID of an SVG file if not passing raw string.' },
          component_name: { type: 'string', description: 'React component name for TSX export (default: VectorIcon).' },
        },
        output: {
        render: (_args, value) => renderToolOutput(value),
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              svg: { type: 'string' },
              viewBox: { type: 'string' },
              originalSize: { type: 'number' },
              optimizedSize: { type: 'number' },
              savedBytes: { type: 'number' },
              reductionPercent: { type: 'number' },
              reactTsx: { type: 'string' },
            },
          },
        },
        async execute(args, exec) {
          let svgStr = args.svg_content
          if (!svgStr && args.image) {
            const source = await resolveSource(ctx, exec, args.image)
            if (source && source.bytes) {
              svgStr = source.bytes.toString('utf8')
            }
          }
          if (!svgStr) {
            throw new Error('Either svg_content or image must be provided')
          }
          return optimizeSvgContent(svgStr, { componentName: args.component_name })
        },
      }),
    )
  }, 'dsh-image-gen: tool optimize_vector_svg')
  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'generate_pwa_icon_suite',
        description: 'Generate standard PWA icons specification, HTML meta tags, and web app manifest.json.',
        parameters: {
          image: { type: 'string', description: 'Source icon image path or attachment ID.' },
          name: { type: 'string', description: 'App name (e.g. My Application).' },
          short_name: { type: 'string', description: 'App short name (e.g. MyApp).' },
          theme_color: { type: 'string', description: 'Theme color hex (e.g. #0f172a).' },
          background_color: { type: 'string', description: 'Background color hex (e.g. #ffffff).' },
          icons_dir: { type: 'string', description: 'Directory for icons relative to webroot (default: icons).' },
        },
        output: {
        render: (_args, value) => renderToolOutput(value),
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              name: { type: 'string' },
              shortName: { type: 'string' },
              themeColor: { type: 'string' },
              backgroundColor: { type: 'string' },
              icons: { type: 'array', items: { type: 'object', additionalProperties: true } },
              manifestJson: { type: 'string' },
              htmlHeadSnippet: { type: 'string' },
            },
          },
        },
        async execute(args, exec) {
          const res = await generatePwaIconSuite({
            name: args.name || 'App',
            shortName: args.short_name || args.name || 'App',
            themeColor: args.theme_color || '#0f172a',
            backgroundColor: args.background_color || '#ffffff',
            iconsDir: args.icons_dir || 'icons',
            sourcePath: args.image || null,
          })
          return toLosslessJson(res)
        },
      }),
    )
  }, 'dsh-image-gen: tool generate_pwa_icon_suite')
}
