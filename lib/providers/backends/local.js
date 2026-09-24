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

/**
 * @param {fetchImpl: Function, resolveKey: Function, cfg: object} deps
 * @param {prompt?: string, size?: string, format?: string, seed?: number, signal?: AbortSignal,
 *   negativePrompt?: string, guidanceScale?: number, source?: object, mask?: object, strength?: number,
 *   quality?: string, style?: string, aspectPixels?: number[], aspectRatio?: string} job
 */
export function createLocalGenerator(deps, job) {
  const { fetchImpl, resolveKey, cfg } = deps
  const { prompt, size, format, seed, signal, negativePrompt, guidanceScale, source, mask, strength, quality, style, aspectPixels, aspectRatio } = job

  async function local(seedArg = seed, promptArg = prompt) {
    const base = String(cfg.localBaseURL || '').replace(/\/+$/, '')
    if (!base) throw new Error('Local image provider: server address is not configured (Settings → Image generation)')
    const [width, height] = pxSize(aspectPixels, size)
    const kind = cfg.localKind === 'a1111' ? 'a1111' : 'comfyui'

    if (kind === 'a1111') {
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

    const workflow = { prompt: workflowGraph }
    const submit = await fetchImpl(`${base}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: promptId }),
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
  }
  return local
}