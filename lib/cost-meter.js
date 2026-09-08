// lib/cost-meter.js
// Integration with dsh-cost-meter, rate card, and daily budget enforcer (#167)

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

/**
 * Standard pricing table per provider and resolution (USD per generation).
 * Based on Fal.ai, OpenAI DALL-E 3/gpt-image-2, Seedream, Replicate rates.
 */
export const RATE_CARD = {
  fal: {
    'fal-ai/flux/schnell': 0.003,
    'fal-ai/flux-2/klein/9b': 0.003,
    'fal-ai/flux/dev': 0.025,
    'fal-ai/flux-pro': 0.05,
    'fal-ai/flux-pro/v1.1': 0.05,
    'fal-ai/recraft-v3': 0.04,
    'fal-ai/fast-sdxl': 0.002,
    default: 0.025,
  },
  custom: {
    'dall-e-3': 0.04,
    'dall-e-3-hd': 0.08,
    'dall-e-2': 0.02,
    'gpt-image-2': 0.03,
    default: 0.03,
  },
  seedream: {
    'seedream-4.0': 0.015,
    'seedream-3.0': 0.01,
    default: 0.015,
  },
  replicate: {
    'black-forest-labs/flux-schnell': 0.003,
    'black-forest-labs/flux-dev': 0.025,
    'stability-ai/sdxl': 0.01,
    default: 0.02,
  },
  local: {
    default: 0.0, // Self-hosted local ComfyUI / A1111 runs for free
  },
  codex: {
    default: 0.0, // Handled via subscription
  },
  grok: {
    default: 0.0, // Handled via subscription
  },
  gemini: {
    default: 0.03,
  },
}

/**
 * Calculates estimated USD cost for a generation request.
 */
export function calculateGenerationCost({ provider = 'fal', model = '', size = '1024x1024', count = 1 } = {}) {
  const p = String(provider || '').toLowerCase()
  const provCard = RATE_CARD[p] || {}
  const baseCost = provCard[model] ?? provCard.default ?? 0.02

  // High-res multiplier (if > 1024x1024 or 2K/4K)
  let sizeMult = 1.0
  const sizeLower = String(size || '').toLowerCase()
  if (sizeLower.includes('2048') || sizeLower.includes('1536') || sizeLower.includes('hd')) {
    sizeMult = 1.5
  }

  return +(baseCost * sizeMult * Math.max(1, count)).toFixed(4)
}

function getSpendFilePath() {
  const base = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(base, 'storages', 'dsh-image-gen-spend.json')
}

/**
 * Loads daily spend record from storage.
 */
export function loadDailySpend() {
  const filePath = getSpendFilePath()
  const today = new Date().toISOString().slice(0, 10)
  try {
    const raw = readFileSync(filePath, 'utf8')
    const data = JSON.parse(raw)
    if (data && data.date === today) {
      return data
    }
  } catch {}
  return { date: today, totalSpendUsd: 0, generations: 0 }
}

/**
 * Records an image generation expense.
 */
export function recordSpend(usdAmount, { ctx, meta = {} } = {}) {
  const amount = Number(usdAmount) || 0
  if (amount <= 0) return loadDailySpend()

  const filePath = getSpendFilePath()
  const current = loadDailySpend()
  current.totalSpendUsd = +(current.totalSpendUsd + amount).toFixed(4)
  current.generations += 1
  current.lastUpdated = new Date().toISOString()

  try {
    mkdirSync(join(filePath, '..'), { recursive: true })
    writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8')
  } catch (err) {
    // Non-fatal write failure
  }

  // Notify dsh-cost-meter if available in cordis context
  try {
    const costMeter = ctx && (ctx.get?.('dsh-cost-meter') || ctx['dsh-cost-meter'])
    if (costMeter && typeof costMeter.recordSpend === 'function') {
      costMeter.recordSpend({
        source: 'dsh-image-gen',
        cost: amount,
        currency: 'USD',
        meta,
      })
    }
  } catch {}

  return current
}

/**
 * Asserts that the generation does not exceed daily budget.
 * @throws {Error} If daily budget is exceeded.
 */
export function assertBudgetAvailable(estimatedCost, dailyBudgetUsd) {
  const budget = Number(dailyBudgetUsd) || 0
  if (budget <= 0) return true // Budget 0 = unlimited

  const current = loadDailySpend()
  const projected = +(current.totalSpendUsd + estimatedCost).toFixed(4)
  if (projected > budget) {
    throw new Error(
      `Daily image generation budget exceeded: current spend $${current.totalSpendUsd.toFixed(2)} + estimated $${estimatedCost.toFixed(2)} exceeds limit $${budget.toFixed(2)} (Settings → Image generation → dailyBudgetUsd)`
    )
  }
  return true
}
