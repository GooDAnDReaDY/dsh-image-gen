// lib/config-schema.js — Zod configuration schema and normalization helpers (#317)

import z from '@deepseek-ai/schemastery'
import { IMAGE_SIZES, OUTPUT_FORMATS, PROVIDER_KEYS } from './providers.js'

// Polyfill for .volatile() schema annotation if runtime schemastery lacks it (#295)
if (typeof z.prototype?.volatile !== 'function') {
  z.prototype.volatile = function volatile() {
    if (this.meta && this.meta.volatile) throw new TypeError('volatile schema is already wrapped')
    return typeof this.extra === 'function' ? this.extra('volatile', true) : this
  }
}

export const Config = z.object({
  enabled: z
    .boolean()
    .description('Master switch for image generation. When false, tools refuse to execute.')
    .default(true)
    .volatile(),
  provider: z
    .string()
    .description(`Which provider generates the image. One of: ${PROVIDER_KEYS.join(', ')}. `
      + '"fal" uses the FAL queue below; "custom" uses the OpenAI-compatible API configured under it.')
    .default('fal')
    .volatile(),
  model: z
    .string()
    .description('FAL model id, called as {baseURL}/{model}.')
    .default('fal-ai/flux-2/klein/9b')
    .volatile(),
  apiKeyEnv: z
    .string()
    .role('credential-ref')
    .description('Credential reference / env var holding the FAL API key (the "Key " auth prefix is added automatically when missing).')
    .default('FAL_API_KEY')
    .volatile(),
  baseURL: z
    .string()
    .description('FAL queue base URL.')
    .default('https://queue.fal.run')
    .volatile(),
  defaultSize: z
    .string()
    .description(`Default image size when the tool call omits image_size. One of: ${IMAGE_SIZES.join(', ')}.`)
    .default('landscape_4_3')
    .volatile(),
  defaultFormat: z
    .string()
    .description(`Default image format when the tool call omits output_format. One of: ${OUTPUT_FORMATS.join(', ')}.`)
    .default('png')
    .volatile(),
  defaultAspectRatio: z
    .string()
    .description('Default aspect ratio (square, landscape_16_9, portrait_9_16, etc.) used when prompt does not specify dimensions.')
    .default('square')
    .volatile(),
  toolsetProfile: z
    .string()
    .description('Which toolset profile to register into conversation context: "minimal" (default, <= 3 core tools, saving ~8,000 prompt tokens), "all" (all 30 tools), or "custom".')
    .default('minimal')
    .volatile(),
  toolsets: z
    .object({
      design: z.boolean().default(false).description('Design tools: style_matrix, theme_pair, ui_asset, character_sheet, beautify_diagram, anchor'),
      processing: z.boolean().default(false).description('Processing tools: remove_background, upscale, vectorize, convert, grid, smart_crop, asset_pack, replace_image_text'),
      frontend: z.boolean().default(false).description('Frontend tools: extract_design_tokens, image_to_css_gradient, check_image_contrast, responsive_mockups'),
      creative: z.boolean().default(false).description('Creative tools: spritesheet, seamless_pattern, sketch_to_image, image_pack'),
    })
    .default({ design: false, processing: false, frontend: false, creative: false })
    .volatile(),
  toolsetDesign: z
    .boolean()
    .description('Enable design tools: style_matrix, theme_pair, ui_asset, character_sheet, beautify_diagram, anchor')
    .default(false)
    .volatile(),
  toolsetProcessing: z
    .boolean()
    .description('Enable processing tools: remove_background, upscale, vectorize, convert, grid, smart_crop, asset_pack, replace_image_text')
    .default(false)
    .volatile(),
  toolsetFrontend: z
    .boolean()
    .description('Enable frontend tools: extract_design_tokens, image_to_css_gradient, check_image_contrast, responsive_mockups')
    .default(false)
    .volatile(),
  toolsetCreative: z
    .boolean()
    .description('Enable creative tools: spritesheet, seamless_pattern, sketch_to_image, image_pack')
    .default(false)
    .volatile(),
  deliverAs: z
    .string()
    .description('How generated images are returned: "link" keeps them on disk and embeds an inline preview link; "attachment" embeds full image bytes directly in the chat.')
    .default('link')
    .volatile(),
  outputDir: z
    .string()
    .description('Directory relative to workspace where generated images are saved.')
    .default('generated-images')
    .volatile(),
  pollIntervalMs: z
    .number()
    .min(0)
    .max(60000)
    .step(1)
    .description('Polling interval for FAL queue status in milliseconds.')
    .default(500)
    .volatile(),
  timeoutMs: z
    .number()
    .min(1000)
    .max(600000)
    .step(1)
    .description('Hard timeout for image generation in milliseconds.')
    .default(180000)
    .volatile(),
  customBaseURL: z
    .string()
    .description('Base URL for OpenAI-compatible images API (provider=custom), e.g. https://api.openai.com/v1.')
    .default('https://api.openai.com/v1')
    .volatile(),
  customModel: z
    .string()
    .description('Model name for OpenAI-compatible images API, e.g. dall-e-3 or flux-schnell.')
    .default('dall-e-3')
    .volatile(),
  customKeyEnv: z
    .string()
    .role('credential-ref')
    .description('Credential reference / env var holding the custom provider API key.')
    .default('CUSTOM_IMAGE_API_KEY')
    .volatile(),
  customSize: z
    .string()
    .description('Image size sent to custom API, e.g. 1024x1024.')
    .default('1024x1024')
    .volatile(),
  replicateModel: z
    .string()
    .description('Replicate model identifier in format owner/model or owner/model:version.')
    .default('black-forest-labs/flux-schnell')
    .volatile(),
  replicateKeyEnv: z
    .string()
    .role('credential-ref')
    .description('Credential reference / env var holding the Replicate API token.')
    .default('REPLICATE_API_TOKEN')
    .volatile(),
  grokKeyEnv: z
    .string()
    .role('credential-ref')
    .description('Credential reference / env var holding the xAI Grok API key.')
    .default('XAI_API_KEY')
    .volatile(),
  chatgptKeyEnv: z
    .string()
    .role('credential-ref')
    .description('Credential reference / env var holding the OpenAI ChatGPT API key.')
    .default('OPENAI_API_KEY')
    .volatile(),
  seedreamModel: z
    .string()
    .description('Volcengine SeaDream model deployment endpoint/ID.')
    .default('doubao-seedream-3.0-t2i')
    .volatile(),
  seedreamKeyEnv: z
    .string()
    .role('credential-ref')
    .description('Credential reference / env var holding the Volcengine SeaDream API key.')
    .default('SEEDREAM_API_KEY')
    .volatile(),
  seedreamBaseURL: z
    .string()
    .description('Base URL for Volcengine SeaDream API.')
    .default('https://ark.cn-beijing.volces.com/api/v3')
    .volatile(),
  geminiModel: z
    .string()
    .description('Google Gemini image generation model identifier.')
    .default('gemini-2.0-flash-exp-image-generation')
    .volatile(),
  geminiKeyEnv: z
    .string()
    .role('credential-ref')
    .description('Credential reference / env var holding the Google Gemini API key.')
    .default('GEMINI_API_KEY')
    .volatile(),
  localKind: z
    .union([z.const('a1111'), z.const('comfyui'), z.const('automatic1111')])
    .description('Local generation backend kind: "a1111" (WebUI) or "comfyui".')
    .default('a1111')
    .volatile(),
  localBaseURL: z
    .string()
    .description('Base URL for local backend (e.g., http://127.0.0.1:7860 or http://127.0.0.1:8188).')
    .default('http://127.0.0.1:7860')
    .volatile(),
  localModel: z
    .string()
    .description('Model checkpoint name for local generation.')
    .default('v1-5-pruned-emaonly.safetensors')
    .volatile(),
  localSteps: z
    .number()
    .min(1)
    .max(150)
    .step(1)
    .description('Sampling steps for local generation.')
    .default(20)
    .volatile(),
  localCfg: z
    .number()
    .min(1)
    .max(30)
    .description('CFG scale for local generation.')
    .default(7.0)
    .volatile(),
  comfyWorkflowJson: z
    .string()
    .description('Custom ComfyUI API workflow JSON template with {{prompt}}, {{seed}}, etc. placeholders.')
    .default('')
    .volatile(),
  localComfyUrl: z
    .string()
    .description('Legacy alias for ComfyUI URL.')
    .default('')
    .volatile(),
  localA1111Url: z
    .string()
    .description('Legacy alias for A1111 URL.')
    .default('')
    .volatile(),
  enableLlmEnhancer: z
    .boolean()
    .description('Legacy alias for enhancePrompt.')
    .default(false)
    .volatile(),
  cacheTtlDays: z
    .number()
    .min(0)
    .max(3650)
    .step(1)
    .description('Legacy alias for pruneDays.')
    .default(0)
    .volatile(),
  subscriptionQuality: z
    .string()
    .description('Image quality tier for subscription accounts: "standard" or "hd".')
    .default('standard')
    .volatile(),
  autoEnhancePrompt: z
    .boolean()
    .description('Automatically enhance short prompts using LLM before generation.')
    .default(false)
    .volatile(),
  defaultStylePreset: z
    .string()
    .description('Default visual style applied to generated images (e.g. photo, anime, digital-art, cinematic).')
    .default('none')
    .volatile(),
  enhancePrompt: z
    .boolean()
    .description('When true, short or vague prompts are expanded by the chat model before image generation.')
    .default(false)
    .volatile(),
  enhanceModel: z
    .string()
    .description('Model name to use for prompt enhancement (empty uses active chat model).')
    .default('')
    .volatile(),
  enhanceBelowChars: z
    .number()
    .min(0)
    .max(5000)
    .step(1)
    .description('Prompts shorter than this character count trigger prompt enhancement.')
    .default(40)
    .volatile(),
  stylePreset: z
    .string()
    .description('Default style preset applied to prompts (e.g., "photographic", "anime", "cinematic"). "none" disables.')
    .default('none')
    .volatile(),
  cacheBySeed: z
    .boolean()
    .description('When true, identical prompt+seed requests reuse previous generation from disk cache.')
    .default(true)
    .volatile(),
  cacheByPrompt: z
    .boolean()
    .description('When true and seed is random, identical prompts return cached result instead of re-generating.')
    .default(false)
    .volatile(),
  historyLimit: z
    .number()
    .min(0)
    .max(50000)
    .step(1)
    .description('Maximum number of generation history records to retain in ~/.dsh/image-gen-history.json (0 = disable history retention).')
    .default(500)
    .volatile(),
  pruneDays: z
    .number()
    .min(0)
    .max(3650)
    .step(1)
    .description('Prune history records older than this many days (0 = disable time-based pruning).')
    .default(30)
    .volatile(),
  qualityGate: z
    .boolean()
    .description('Automatically inspect generated image sharpness and detect blank/corrupt outputs, retrying once if needed.')
    .default(true)
    .volatile(),
  dailyBudgetUsd: z
    .number()
    .min(0)
    .max(100000)
    .description('Daily image generation spending budget in USD. 0 (default) disables limit enforcement.')
    .default(0)
    .volatile(),
  loopGuardLimit: z
    .number()
    .min(0)
    .max(1000)
    .step(1)
    .description('Maximum consecutive image generations per session without user interaction. 0 disables protection.')
    .default(3)
    .volatile(),
  diskCache: z
    .boolean()
    .description('Content-addressed disk caching for identical generations (<50ms retrieval, zero API cost). On by default.')
    .default(true)
    .volatile(),
  fallbackProviders: z
    .array(z.string())
    .description('Ordered list of fallback providers to cascade to if the primary encounters 429, 5xx, or quota limits.')
    .default([])
    .volatile(),
})

export function isVolatileRef(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.get === 'function'
}

export function plainConfig(cfg) {
  if (isVolatileRef(cfg)) return plainConfig(cfg.get())
  if (!cfg || typeof cfg !== 'object') return cfg
  const out = {}
  for (const key of Object.keys(cfg)) {
    const value = cfg[key]
    out[key] = isVolatileRef(value) ? value.get() : value
  }
  return out
}

export function volatileConfig(cfg) {
  const plain = plainConfig(cfg)
  if (!plain || typeof plain !== 'object') return plain
  const out = {}
  for (const [key, field] of Object.entries(Config.dict || {})) {
    if (field?.meta?.volatile && Object.hasOwn(plain, key)) {
      out[key] = plain[key]
    }
  }
  return out
}

export function publicConfig(cfg) {
  return plainConfig(cfg)
}

export function sanitizeRaw(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const cleaned = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.get !== 'function' && Object.keys(v).length === 0) {
      continue
    }
    cleaned[k] = v
  }
  if (cleaned.localKind === 'automatic1111') {
    cleaned.localKind = 'a1111'
  }
  // Coerce string fallbackProviders to array (#369)
  if (typeof cleaned.fallbackProviders === 'string') {
    cleaned.fallbackProviders = cleaned.fallbackProviders
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  // Migrate legacy fields (#369)
  if (cleaned.localComfyUrl && !cleaned.localBaseURL && cleaned.localKind === 'comfyui') {
    cleaned.localBaseURL = cleaned.localComfyUrl
  }
  if (cleaned.localA1111Url && !cleaned.localBaseURL && cleaned.localKind === 'a1111') {
    cleaned.localBaseURL = cleaned.localA1111Url
  }
  if (typeof cleaned.enableLlmEnhancer === 'boolean' && cleaned.enhancePrompt === undefined) {
    cleaned.enhancePrompt = cleaned.enableLlmEnhancer
  }
  if (typeof cleaned.cacheTtlDays === 'number' && cleaned.cacheTtlDays > 0 && cleaned.pruneDays === undefined) {
    cleaned.pruneDays = cleaned.cacheTtlDays
  }
  return cleaned
}

export function ensureConfig(raw) {
  const cleaned = sanitizeRaw(raw)
  const plain = plainConfig(cleaned)
  return Config(plain)
}
