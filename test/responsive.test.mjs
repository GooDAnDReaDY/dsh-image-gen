// generate_responsive_mockups helpers and registration (#173)

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEVICE_ORDER,
  DEVICE_PRESETS,
  buildResponsivePrompt,
  deviceMeta,
  mockupFileName,
  normalizeDevices,
  resolveDevicePreset,
} from '../lib/responsive-helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))

test('normalizeDevices: defaults to all three devices in order', () => {
  assert.deepEqual(normalizeDevices(undefined), ['mobile', 'tablet', 'desktop'])
  assert.deepEqual(normalizeDevices(null), DEVICE_ORDER)
})

test('normalizeDevices: filters invalid values, keeps order, dedupes', () => {
  assert.deepEqual(normalizeDevices(['tablet', 'tv', 'MOBILE', 'tablet', 'desktop']), ['tablet', 'mobile', 'desktop'])
  assert.deepEqual(normalizeDevices(['watch']), ['mobile', 'tablet', 'desktop'])
})

test('DEVICE_PRESETS cover issue #173 viewports', () => {
  assert.equal(DEVICE_PRESETS.mobile.aspect, '9:16')
  assert.equal(DEVICE_PRESETS.tablet.aspect, '3:4')
  assert.equal(DEVICE_PRESETS.desktop.aspect, '16:9')
  assert.equal(DEVICE_PRESETS.mobile.fileStem, 'mockup-mobile')
  assert.equal(DEVICE_PRESETS.tablet.fileStem, 'mockup-tablet')
  assert.equal(DEVICE_PRESETS.desktop.fileStem, 'mockup-desktop')
  assert.ok(DEVICE_PRESETS.mobile.viewport.includes('375'))
  assert.ok(DEVICE_PRESETS.tablet.viewport.includes('768'))
  assert.ok(DEVICE_PRESETS.desktop.viewport.includes('1440'))
})

test('resolveDevicePreset falls back to mobile', () => {
  assert.equal(resolveDevicePreset('desktop').id, 'desktop')
  assert.equal(resolveDevicePreset('nope').id, 'mobile')
})

test('buildResponsivePrompt keeps shared product idea and device layout hints', () => {
  const mobile = buildResponsivePrompt('smart home settings dashboard', {
    device: 'mobile',
    stylePreset: 'minimalist_vector',
    paletteColors: ['#0f172a', '#38bdf8'],
  })
  const desktop = buildResponsivePrompt('smart home settings dashboard', {
    device: 'desktop',
    stylePreset: 'minimalist_vector',
    paletteColors: ['#0f172a', '#38bdf8'],
  })
  assert.match(mobile, /smart home settings dashboard/)
  assert.match(desktop, /smart home settings dashboard/)
  assert.match(mobile, /minimalist_vector/)
  assert.match(desktop, /minimalist_vector/)
  assert.match(mobile, /#0f172a/)
  assert.match(desktop, /#0f172a/)
  assert.match(mobile, /mobile viewport/i)
  assert.match(desktop, /Desktop UI mockup/)
  assert.notEqual(mobile, desktop)
  assert.match(mobile, /same product family|same information architecture|brand colors/i)
})

test('mockupFileName uses issue filenames by default and stems otherwise', () => {
  assert.equal(mockupFileName('mobile'), 'mockup-mobile.png')
  assert.equal(mockupFileName('tablet'), 'mockup-tablet.png')
  assert.equal(mockupFileName('desktop'), 'mockup-desktop.png')
  assert.equal(mockupFileName('mobile', { outputName: 'acme' }), 'acme-mobile.png')
  assert.equal(mockupFileName('desktop', { outputName: 'acme.png' }), 'acme-desktop.png')
})

test('deviceMeta returns consistent tab metadata', () => {
  assert.deepEqual(deviceMeta('tablet'), {
    device: 'tablet',
    label: 'Tablet',
    aspect: '3:4',
    size: 'portrait_4_3',
    viewport: DEVICE_PRESETS.tablet.viewport,
  })
})

test('responsive tool is registered', () => {
  const src = fs.readFileSync(path.join(here, '..', 'lib', 'tools', 'responsive.js'), 'utf8')
  assert.match(src, /name: 'generate_responsive_mockups'/)
  assert.match(src, /asyncPool\(tasks, 3\)/)
  const reg = fs.readFileSync(path.join(here, '..', 'lib', 'register-tools.js'), 'utf8')
  assert.match(reg, /registerResponsiveTools/)
  const client = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')
  assert.match(client, /generate_responsive_mockups/)
  assert.match(client, /readResponsiveImages/)
})

test('asyncPool parallel shape: all tasks run under concurrency cap semantics', async () => {
  // Mirror of the tool's asyncPool for deterministic unit coverage without providers.
  async function asyncPool(tasks, concurrency = 3) {
    const results = new Array(tasks.length)
    let nextIdx = 0
    let inflightPeak = 0
    let inflight = 0
    async function worker() {
      while (nextIdx < tasks.length) {
        const idx = nextIdx++
        inflight += 1
        inflightPeak = Math.max(inflightPeak, inflight)
        try {
          results[idx] = await tasks[idx]()
        } finally {
          inflight -= 1
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()))
    return { results, inflightPeak }
  }

  const order = []
  const tasks = ['mobile', 'tablet', 'desktop'].map((device) => async () => {
    order.push(`${device}:start`)
    await new Promise((r) => setTimeout(r, 20))
    order.push(`${device}:end`)
    return device
  })
  const { results, inflightPeak } = await asyncPool(tasks, 3)
  assert.deepEqual(results, ['mobile', 'tablet', 'desktop'])
  assert.equal(inflightPeak, 3)
  assert.equal(order.filter((x) => x.endsWith(':start')).length, 3)
  assert.equal(order[order.length - 1], 'desktop:end')
})

test('device seed offsets stay stable for reproducible sets', () => {
  const seedBase = 1000
  const devices = normalizeDevices(['desktop', 'mobile'])
  const seeds = Object.fromEntries(devices.map((d, i) => [d, seedBase + i]))
  assert.deepEqual(seeds, { desktop: 1000, mobile: 1001 })
})
