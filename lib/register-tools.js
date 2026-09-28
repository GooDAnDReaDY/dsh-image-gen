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
  const cfg = typeof deps.live === 'function' ? deps.live() : (deps.config || {})
  const profile = cfg.toolsetProfile || 'minimal'
  const isAll = profile === 'all'
  const sets = cfg.toolsets || {}
  const design = isAll || Boolean(sets.design || cfg.toolsetDesign)
  const processing = isAll || Boolean(sets.processing || cfg.toolsetProcessing)
  const frontend = isAll || Boolean(sets.frontend || cfg.toolsetFrontend)
  const creative = isAll || Boolean(sets.creative || cfg.toolsetCreative)

  // 1. Core tools: generate_image, edit_image, inspect_image_quality (<= 3 tools in minimal)
  registerGenerationTools(ctx, deps, { coreOnly: !creative })
  registerEditingTools(ctx, deps, { coreOnly: !processing })
  registerInspectTools(ctx, deps, { coreOnly: !processing })

  // 2. Processing toolset
  if (processing) {
    registerProcessingTools(ctx, deps)
    registerProcessingAdvancedTools(ctx, deps)
    registerVisionOcrTools(ctx, deps)
  }

  // 3. Design toolset
  if (design) {
    registerAnchorTools(ctx, deps)
    registerUiAssetTools(ctx, deps)
    registerStyleMatrixTools(ctx, deps)
    registerThemePairTools(ctx, deps)
    registerCharacterSheetTools(ctx, deps)
    registerDiagramTools(ctx, deps)
  }

  // 4. Frontend toolset
  if (frontend) {
    registerFrontendTools(ctx, deps)
    registerResponsiveTools(ctx, deps)
  }

  // 5. Creative toolset
  if (creative) {
    registerSketchTools(ctx, deps)
    registerSpritesheetTools(ctx, deps)
    registerPatternTools(ctx, deps)
  }
}
