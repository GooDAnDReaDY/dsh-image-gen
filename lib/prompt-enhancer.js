// prompt-enhancer.js — Prompt enhancement via LLM (#4 fix)
// Extracted from index.js to avoid circular dependency with tools/generation.js

/** Collect text chunks from llm.stream iterator. */
export async function collectText(iterable) {
  let out = ''
  let sawDelta = false
  for await (const chunk of iterable) {
    if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      out += chunk.text
      sawDelta = true
    } else if (
      !sawDelta && chunk && chunk.type === 'block-end'
      && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string'
    ) {
      out += chunk.block.text
    }
  }
  return out.trim()
}

/** Build system message for prompt enhancement. */
export function buildEnhancePromptSystemMessage(provider, model) {
  const isFlux = String(model || '').toLowerCase().includes('flux') || provider === 'fal'
  if (isFlux) {
    return 'You are an expert prompt engineer for FLUX image models. Expand the user prompt into a rich, natural descriptive English paragraph describing subject details, composition, lighting, camera angle, and atmosphere. Reply with ONLY the expanded prompt, no commentary, no markdown quotes.'
  }
  return 'You are an expert prompt engineer for Stable Diffusion models. Expand the user prompt into detailed comma-separated descriptive visual tags including subject, composition, studio lighting, materials, and artistic medium. Reply with ONLY the expanded prompt, no commentary.'
}

/** Expand short prompt via chat model; return original prompt on error. */
export async function enhancePrompt(ctx, cfg, prompt, signal, provider) {
  if (!cfg.enhancePrompt) return { prompt, enhanced: false }
  if (String(prompt).length >= (cfg.enhanceBelowChars || 200)) return { prompt, enhanced: false }
  try {
    const sysMsg = buildEnhancePromptSystemMessage(provider || cfg.provider, cfg.enhanceModel || cfg.model)
    const chunks = ctx.llm.stream({
      ...(signal ? { signal } : {}),
      ...(cfg.enhanceModel ? { model: cfg.enhanceModel } : {}),
      messages: [
        { role: 'system', content: sysMsg },
        { role: 'user', content: prompt },
      ],
    })
    const text = await collectText(chunks)
    if (!text) return { prompt, enhanced: false }
    return { prompt: text, enhanced: true }
  } catch (_) {
    return { prompt, enhanced: false }
  }
}
