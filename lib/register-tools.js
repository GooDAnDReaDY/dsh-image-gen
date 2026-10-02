// register-tools.js — orchestrates all image-gen tool registrations (#216, #337).
// Supports 'minimal' (default: <= 3 core tools), 'all' (all 30 tools), and 'custom' (toggled toolsets).

import { registerGenerationTools } from './tools/generation.js'
import { registerProcessingTools } from './tools/processing-basic.js'
import { registerProcessingAdvancedTools } from './tools/processing-advanced.js'
import { registerEditingTools } from './tools/editing.js'
import { registerInspectTools } from './tools/inspect.js'
import { registerFrontendTools } from './tools/frontend.js'
import { registerSketchTools } from './tools/sketch.js'
import { registerSpritesheetTools } from './tools/spritesheet.js'
import { registerPatternTools } from './tools/pattern.js'
import { registerResponsiveTools } from './tools/responsive.js'
import { registerAnchorTools } from './tools/anchor.js'
import { registerUiAssetTools } from './tools/ui-asset.js'
import { registerStyleMatrixTools } from './tools/style-matrix.js'
import { registerThemePairTools } from './tools/theme-pair.js'
import { registerCharacterSheetTools } from './tools/character-sheet.js'
import { registerVisionOcrTools } from './tools/vision-ocr.js'
import { registerDiagramTools } from './tools/diagram.js'

/**
 * Registers every image-gen tool on the host tools service according to toolsetProfile (#337).
 *
 * @param {object} ctx cordis context
 * @param {object} deps shared runtime from apply()
 */
export function registerAllTools(ctx, deps) {
  const originalToolsRegister = ctx?.tools?.register ? ctx.tools.register.bind(ctx.tools) : null
  const wrappedTools = originalToolsRegister ? Object.create(ctx.tools, {
    register: {
      value: (def) => {
        const originalExecute = def.execute
        const wrappedDef = {
          ...def,
          execute: async (args, exec) => {
            const currentCfg = typeof deps.live === 'function' ? deps.live() : (deps.config || {})
            if (currentCfg && currentCfg.enabled === false) {
              throw new Error('Image generation is disabled in settings (dsh-image-gen.enabled is false); enable it in Settings → Image generation.')
            }
            return originalExecute(args, exec)
          },
        }
        return originalToolsRegister(wrappedDef)
      },
      writable: true,
      configurable: true,
    },
  }) : ctx?.tools

  const targetCtx = originalToolsRegister ? Object.create(ctx, {
    tools: { value: wrappedTools, writable: true, configurable: true }
  }) : ctx
  const cfg = typeof deps.live === 'function' ? deps.live() : (deps.config || {})
  const profile = cfg.toolsetProfile || 'minimal'
  const isAll = profile === 'all'
  const sets = cfg.toolsets || {}
  const design = isAll || Boolean(sets.design || cfg.toolsetDesign)
  const processing = isAll || Boolean(sets.processing || cfg.toolsetProcessing)
  const frontend = isAll || Boolean(sets.frontend || cfg.toolsetFrontend)
  const creative = isAll || Boolean(sets.creative || cfg.toolsetCreative)

  // 1. Core tools: generate_image, edit_image, inspect_image_quality (<= 3 tools in minimal)
  registerGenerationTools(targetCtx, deps, { coreOnly: !creative })
  registerEditingTools(targetCtx, deps, { coreOnly: !processing })
  registerInspectTools(targetCtx, deps, { coreOnly: !processing })

  // 2. Processing toolset
  if (processing) {
    registerProcessingTools(targetCtx, deps)
    registerProcessingAdvancedTools(targetCtx, deps)
    registerVisionOcrTools(targetCtx, deps)
  }

  // 3. Design toolset
  if (design) {
    registerAnchorTools(targetCtx, deps)
    registerUiAssetTools(targetCtx, deps)
    registerStyleMatrixTools(targetCtx, deps)
    registerThemePairTools(targetCtx, deps)
    registerCharacterSheetTools(targetCtx, deps)
    registerDiagramTools(targetCtx, deps)
  }

  // 4. Frontend toolset
  if (frontend) {
    registerFrontendTools(targetCtx, deps)
    registerResponsiveTools(targetCtx, deps)
  }

  // 5. Creative toolset
  if (creative) {
    registerSketchTools(targetCtx, deps)
    registerSpritesheetTools(targetCtx, deps)
    registerPatternTools(targetCtx, deps)
  }
}
