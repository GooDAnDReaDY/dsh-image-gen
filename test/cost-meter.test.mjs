import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RATE_CARD,
  calculateGenerationCost,
  loadDailySpend,
  recordSpend,
  assertBudgetAvailable,
} from '../lib/cost-meter.js'

test('calculateGenerationCost: calculates accurate USD rate by provider and model', () => {
  const falDevCost = calculateGenerationCost({ provider: 'fal', model: 'fal-ai/flux/dev', count: 1 })
  assert.equal(falDevCost, 0.025)

  const falSchnellCost = calculateGenerationCost({ provider: 'fal', model: 'fal-ai/flux/schnell', count: 2 })
  assert.equal(falSchnellCost, 0.006)

  const customDalleCost = calculateGenerationCost({ provider: 'custom', model: 'dall-e-3', count: 1 })
  assert.equal(customDalleCost, 0.04)

  const localCost = calculateGenerationCost({ provider: 'local', model: 'sdxl', count: 4 })
  assert.equal(localCost, 0.0)
})

test('calculateGenerationCost: applies high-res multiplier for 2K/4K/HD sizes', () => {
  const normalCost = calculateGenerationCost({ provider: 'fal', model: 'fal-ai/flux/dev', size: '1024x1024' })
  const hdCost = calculateGenerationCost({ provider: 'fal', model: 'fal-ai/flux/dev', size: '2048x2048' })
  assert.equal(hdCost, +(normalCost * 1.5).toFixed(4))
})

test('recordSpend: increments total daily spend correctly', () => {
  const before = loadDailySpend()
  const initialSpend = before.totalSpendUsd
  const initialGens = before.generations

  const updated = recordSpend(0.025)
  assert.equal(+(updated.totalSpendUsd - initialSpend).toFixed(4), 0.025)
  assert.equal(updated.generations, initialGens + 1)
})

test('assertBudgetAvailable: allows within budget and blocks when exceeding', () => {
  // Budget 0 = unlimited
  assert.equal(assertBudgetAvailable(50.0, 0), true)

  const current = loadDailySpend()
  const tightBudget = current.totalSpendUsd + 0.05
  // Within budget
  assert.equal(assertBudgetAvailable(0.03, tightBudget), true)

  // Exceeds budget
  assert.throws(
    () => assertBudgetAvailable(0.10, tightBudget),
    /Daily image generation budget exceeded/
  )
})
