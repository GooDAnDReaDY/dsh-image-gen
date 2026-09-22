// register-tools.js — orchestrates all image-gen tool registrations (#216).
// Each tool lives in lib/tools/* and is registered inside a labeled ctx.effect.

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

/**
 * Registers every image-gen tool on the host tools service.
 *
 * @param {object} ctx cordis context
 * @param {object} deps shared runtime from apply()
 */
export function registerAllTools(ctx, deps) {
  registerGenerationTools(ctx, deps)
  registerProcessingTools(ctx, deps)
  registerProcessingAdvancedTools(ctx, deps)
  registerEditingTools(ctx, deps)
  registerInspectTools(ctx, deps)
  registerFrontendTools(ctx, deps)
  registerSketchTools(ctx, deps)
  registerSpritesheetTools(ctx, deps)
  registerPatternTools(ctx, deps)
  registerResponsiveTools(ctx, deps)
  registerAnchorTools(ctx, deps)
  registerUiAssetTools(ctx, deps)
  registerStyleMatrixTools(ctx, deps)
}
