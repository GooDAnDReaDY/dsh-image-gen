// @ts-check
// watermark.js — Watermark policy controller (#509).
// Manages visible watermark contracts across generative providers and models.

const WATERMARK_OPTIONS = [
  { value: 'default', label: 'Default / Provider default', labelZh: '渠道默认' },
  { value: 'off', label: 'Disabled / No watermark', labelZh: '关闭水印' },
  { value: 'on', label: 'Enabled / Apply watermark', labelZh: '开启水印' },
]

/**
 * Normalized watermark value to boolean or undefined (channel default).
 * @param {string | boolean | undefined} selected
 * @param {boolean} [channelDefault]
 * @returns {boolean | undefined}
 */
export function selectedWatermark(selected, channelDefault) {
  if (selected === 'off' || selected === false) return false
  if (selected === 'on' || selected === true) return true
  return channelDefault
}

/**
 * Returns whether a provider/model natively supports watermark toggle.
 * @param {string} provider
 * @param {string} [model]
 * @returns {{ status: 'supported' | 'unavailable' | 'unknown', reason?: string }}
 */
export function watermarkCapability(provider, model = '') {
  const normProvider = String(provider || '').toLowerCase()
  const normModel = String(model || '').toLowerCase()

  if (normProvider === 'seedream') {
    return { status: 'supported' }
  }
  if (normProvider === 'dashscope' || normProvider === 'qwen') {
    if (normModel.includes('qwen-image')) {
      return { status: 'supported' }
    }
    return { status: 'unknown', reason: 'model-unconfirmed' }
  }
  if (normProvider === 'openai-compat' || normProvider === 'custom') {
    return { status: 'supported' }
  }
  if (normProvider === 'zhipu') {
    return { status: 'unknown', reason: 'account-unconfirmed' }
  }
  return { status: 'unavailable', reason: 'no-api-control' }
}

/**
 * Inject watermark parameter into provider payload if supported.
 * @param {Record<string, any>} payload
 * @param {string | boolean | undefined} watermarkChoice
 * @param {string} provider
 * @param {string} [model]
 * @returns {Record<string, any>}
 */
export function applyWatermarkToPayload(payload, watermarkChoice, provider, model) {
  if (watermarkChoice === undefined || watermarkChoice === 'default') {
    return payload
  }

  const enabled = selectedWatermark(watermarkChoice)
  if (enabled === undefined) return payload

  const cap = watermarkCapability(provider, model)
  if (cap.status === 'unavailable') return payload

  const clone = { ...payload }
  clone.watermark = enabled
  return clone
}
