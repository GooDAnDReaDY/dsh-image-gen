import {
  normalizeMediaType,
  pxSize,
  calculateBackoff,
  extractComfyNodeErrors,
} from '../shared-helpers.js'
import {
  validateComfyWorkflow,
  interpolateComfyWorkflow,
  buildDefaultComfyWorkflow,
} from '../../comfy-workflow-helpers.js'

function resolveWebSocket() {
  if (typeof window !== 'undefined' && window.WebSocket) return window.WebSocket
  try {
    return (new Function('return typeof WebSocket !== "undefined" ? WebSocket : undefined'))()
  } catch (_) {
    return undefined
  }
}

/**
 * @param {fetchImpl: Function, resolveKey: Function, cfg: object} deps
 * @param {prompt?: string, size?: string, format?: string, seed?: number, signal?: AbortSignal,
 *   negativePrompt?: string, guidanceScale?: number, source?: object, mask?: object, strength?: number,
 *   quality?: string, style?: string, aspectPixels?: number[], aspectRatio?: string, onProgress?: Function, callId?: string} job
 */
export function createLocalGenerator(deps, job) {
  const { fetchImpl, resolveKey, cfg } = deps
  const { prompt, size, format, seed, signal, negativePrompt, guidanceScale, source, mask, strength, quality, style, aspectPixels, aspectRatio, onProgress } = job

  async function local(seedArg = seed, promptArg = prompt) {
    const base = String(cfg.localBaseURL || '').replace(/\/+$/, '')
    if (!base) throw new Error('Local image provider: server address is not configured (Settings → Image generation)')
    const [width, height] = pxSize(aspectPixels, size)
    const rawKind = cfg.localKind || 'a1111'
    const kind = (rawKind === 'a1111' || rawKind === 'automatic1111')
      ? 'a1111'
      : (rawKind === 'comfyui' ? 'comfyui' : null)

    if (!kind) {
      throw new Error(`Unknown local generation backend kind "${rawKind}". Expected "a1111" or "comfyui".`)
    }

    if (kind === 'a1111') {
      if (typeof onProgress === 'function') {
        onProgress({ stage: 'Generating...', progress: undefined })
      }
      const isImg2Img = Boolean(source && source.bytes)
      const endpoint = `${base}${isImg2Img ? '/sdapi/v1/img2img' : '/sdapi/v1/txt2img'}`
      const body = {
        prompt: promptArg,
        negative_prompt: negativePrompt,
        width,
        height,
        steps: cfg.localSteps ?? 20,
        cfg_scale: cfg.localCfg ?? 7,
        seed: seedArg ?? -1,
      }
      if (isImg2Img) {
        body.init_images = [Buffer.from(source.bytes).toString('base64')]
        body.denoising_strength = strength ?? (mask ? 0.75 : 0.35)
        if (mask && mask.bytes) {
          body.mask = Buffer.from(mask.bytes).toString('base64')
        }
      }
      if (cfg.localModel) body.override_settings = { sd_model_checkpoint: cfg.localModel }
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) {
        throw new Error(`Local A1111 failed (HTTP ${res.status}): ${String(await res.text().catch(() => '')).slice(0, 300)}`)
      }
      const data = await res.json().catch(() => ({}))
      const b64 = data.images && data.images[0]
      if (!b64) throw new Error('Local A1111 returned no images')
      return {
        bytes: Buffer.from(b64, 'base64'),
        mediaType: normalizeMediaType('image/png', format),
        width,
        height,
        seed: seedArg ?? 0,
        sourceUrl: '',
      }
    }

    // ComfyUI: submit via /prompt, poll /history/{prompt_id} until completed.
    const promptId = `dsh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    let workflowGraph
    if (cfg.comfyWorkflowJson) {
      const template = validateComfyWorkflow(cfg.comfyWorkflowJson)
      workflowGraph = interpolateComfyWorkflow(template, {
        prompt: promptArg,
        negativePrompt: negativePrompt || '',
        seed: seedArg ?? 0,
        width,
        height,
        steps: cfg.localSteps ?? 20,
        cfg: cfg.localCfg ?? 7,
        model: cfg.localModel,
        image: source && source.bytes ? Buffer.from(source.bytes).toString('base64') : '',
      })
    } else {
      workflowGraph = buildDefaultComfyWorkflow({
        prompt: promptArg,
        negativePrompt,
        seed: seedArg,
        width,
        height,
        model: cfg.localModel,
        steps: cfg.localSteps,
        cfg: cfg.localCfg,
      })
    }

    // Validate workflow node shape before submitting to ComfyUI (GH#7)
    if (!workflowGraph || typeof workflowGraph !== 'object' || Array.isArray(workflowGraph)) {
      throw new Error('Local ComfyUI workflow graph must be a valid node object')
    }
    for (const [nodeId, node] of Object.entries(workflowGraph)) {
      if (!node || typeof node !== 'object' || Array.isArray(node) || !node.class_type) {
        throw new Error(`Local ComfyUI workflow node "${nodeId}" is invalid or missing required "class_type" property`)
      }
    }

    let ws
    let wsClosed = false
    const closeWs = () => {
      if (!wsClosed && ws) {
        wsClosed = true
        try {
          ws.close()
        } catch (_err) {
          // Socket close failure ignored
        }
      }
    }

    try {
      const WebSocketClass = resolveWebSocket()
      if (WebSocketClass) {
        const wsUrl = `${base.replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(promptId)}`
        try {
          ws = new WebSocketClass(wsUrl)
          if (signal) {
            signal.addEventListener('abort', closeWs, { once: true })
          }
          ws.onmessage = (event) => {
            if (wsClosed) return
            try {
              if (typeof event.data === 'string') {
                const msg = JSON.parse(event.data)
                if (msg.type === 'progress') {
                  const { value, max } = msg.data || {}
                  const progress = (max > 0) ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : undefined
                  if (typeof onProgress === 'function') {
                    onProgress({ stage: 'Rendering...', step: `${value}/${max}`, progress })
                  }
                } else if (msg.type === 'executing') {
                  const node = msg.data?.node
                  if (typeof onProgress === 'function') {
                    onProgress({ stage: node ? `Executing node ${node}` : 'Finishing...' })
                  }
                } else if (msg.type === 'status') {
                  const q = msg.data?.status?.exec_info?.queue_remaining
                  if (q !== undefined && q > 0 && typeof onProgress === 'function') {
                    onProgress({ stage: `In queue (${q} remaining)` })
                  }
                }
              } else if (event.data) {
                const rawBuf = Buffer.isBuffer(event.data) ? event.data : Buffer.from(event.data)
                let imgBuf = rawBuf
                if (rawBuf.length > 8 && (rawBuf[0] === 0 || rawBuf[0] === 1 || rawBuf[0] === 2)) {
                  imgBuf = rawBuf.subarray(8)
                }
                if (imgBuf.length > 4) {
                  const isPng = imgBuf[0] === 0x89 && imgBuf[1] === 0x50
                  const mime = isPng ? 'image/png' : 'image/jpeg'
                  const draftUrl = `data:${mime};base64,${imgBuf.toString('base64')}`
                  if (typeof onProgress === 'function') {
                    onProgress({ draftUrl })
                  }
                }
              }
            } catch (_err) {
              // Frame parse failure ignored
            }
          }
          ws.onerror = () => {}
          ws.onclose = () => {}
        } catch (_err) {
          // Websocket handshake failure ignored
        }
      }

      if (typeof onProgress === 'function') {
        onProgress({ stage: 'Submitting prompt...', progress: undefined })
      }

      const submit = await fetchImpl(`${base}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflowGraph, client_id: promptId }),
        signal,
      })
      if (!submit.ok) {
        throw new Error(`Local ComfyUI submit failed (HTTP ${submit.status}): ${String(await submit.text().catch(() => '')).slice(0, 300)}`)
      }
      const submitData = await submit.json().catch(() => ({}))
      const pid = submitData.prompt_id
      if (!pid) throw new Error('Local ComfyUI did not return a prompt_id')

      const deadline = Date.now() + cfg.timeoutMs
      let attempt = 0
      for (;;) {
        if (signal?.aborted) throw new Error('Local ComfyUI generation cancelled')
        if (Date.now() > deadline) throw new Error(`Local ComfyUI timed out after ${cfg.timeoutMs} ms`)
        if (attempt > 0) {
          const cDelay = calculateBackoff(attempt - 1, cfg.pollIntervalMs || 1000, 5000)
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, cDelay)
            if (signal) {
              signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
            }
          })
        }
        attempt++
        const hist = await fetchImpl(`${base}/history/${pid}`, { signal })
        if (!hist.ok) continue
        const histData = await hist.json().catch(() => ({}))
        const entry = histData[pid]
        if (entry) {
          const comfyErr = extractComfyNodeErrors(entry)
          if (comfyErr) {
            throw new Error(`Local ComfyUI execution failed: ${comfyErr}`)
          }
        }
        if (entry && entry.outputs) {
          const outputs = entry.outputs
          const img = Object.values(outputs).flatMap((o) => o.images || []).find((i) => i && i.filename)
          if (img) {
            const dl = await fetchImpl(`${base}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`, { signal })
            if (!dl.ok) throw new Error(`Local ComfyUI download failed (HTTP ${dl.status})`)
            return {
              bytes: Buffer.from(await dl.arrayBuffer()),
              mediaType: normalizeMediaType('image/png', format),
              width,
              height,
              seed: seedArg ?? 0,
              sourceUrl: '',
            }
          }
        }
      }
    } finally {
      closeWs()
    }
  }
  return local
}
