// register-tools.js — orchestrates all image-gen tool registrations (#216, #337, #384).
// Supports 'minimal' (default: <= 3 core tools), 'all' (all 30 tools), and 'custom' (toggled toolsets).
// Reactively updates tool registrations when toolsetProfile or toolsets change.

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
import {
  createLiveProgressSession,
  publishLiveProgress,
  completeLiveProgress,
  abortLiveProgress,
} from './live-progress.js'

/**
 * Registers every image-gen tool on the host tools service according to toolsetProfile (#337, #384).
 *
 * @param {object} ctx cordis context
 * @param {object} deps shared runtime from apply()
 * @returns {object} { sync, dispose, getRegisteredNames }
 */
export function registerAllTools(ctx, deps) {
  let activeDisposers = []
  const registeredNames = new Set()

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
            const safeArgs = args || {}
            const safeExec = exec || {}
            const callId = safeExec.callId || safeExec.rootCallId
            if (callId) {
              createLiveProgressSession(callId, { signal: safeExec.signal })
              safeExec.onProgress = (update) => publishLiveProgress(callId, update)
            }
            try {
              const res = await originalExecute(safeArgs, safeExec)
              if (callId) completeLiveProgress(callId)
              return res
            } catch (err) {
              if (callId) abortLiveProgress(callId, err.message)
              throw err
            }
          },
        }
        const res = originalToolsRegister(wrappedDef)
        registeredNames.add(def.name)
        if (typeof res === 'function') {
          activeDisposers.push(res)
        } else {
          activeDisposers.push(() => {
            if (typeof ctx.tools?.unregister === 'function') {
              ctx.tools.unregister(def.name)
            } else if (typeof ctx.tools?.delete === 'function') {
              ctx.tools.delete(def.name)
            } else if (Array.isArray(ctx.tools?.list)) {
              const idx = ctx.tools.list.findIndex((t) => t.name === def.name)
              if (idx !== -1) ctx.tools.list.splice(idx, 1)
            }
          })
        }
        return res
      },
      writable: true,
      configurable: true,
    },
  }) : ctx?.tools

  const targetCtx = originalToolsRegister ? Object.create(ctx, {
    tools: { value: wrappedTools, writable: true, configurable: true }
  }) : ctx

  function doRegister(cfg) {
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

  function dispose() {
    for (const d of activeDisposers) {
      if (typeof d === 'function') {
        try { d() } catch (err) {
          // Disposer cleanup errors are safely ignored on tool rebuild
        }
      }
    }
    activeDisposers = []
    registeredNames.clear()
  }

  function computeKey(cfg) {
    const profile = cfg.toolsetProfile || 'minimal'
    const isAll = profile === 'all'
    const sets = cfg.toolsets || {}
    return JSON.stringify({
      profile,
      design: isAll || Boolean(sets.design || cfg.toolsetDesign),
      processing: isAll || Boolean(sets.processing || cfg.toolsetProcessing),
      frontend: isAll || Boolean(sets.frontend || cfg.toolsetFrontend),
      creative: isAll || Boolean(sets.creative || cfg.toolsetCreative),
    })
  }

  let currentKey = ''
  function sync() {
    const currentCfg = typeof deps.live === 'function' ? deps.live() : (deps.config || {})
    const key = computeKey(currentCfg)
    if (key === currentKey) return
    currentKey = key
    dispose()
    doRegister(currentCfg)
  }

  // Initial registration
  const initialCfg = typeof deps.live === 'function' ? deps.live() : (deps.config || {})
  currentKey = computeKey(initialCfg)
  doRegister(initialCfg)

  return {
    sync,
    dispose,
    getRegisteredNames: () => Array.from(registeredNames),
  }
}
