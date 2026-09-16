// Plugin Settings Card (settings.plugin.item) and Toolviews for @goodandready/dsh-image-gen
window.__ModuleLoader__.load({
  id: '@goodandready/dsh-image-gen',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const react = require('react')
    const React = react

    let react_jsx_runtime = null
    try {
      react_jsx_runtime = require('react/jsx-runtime')
    } catch (_) {
      react_jsx_runtime = {
        jsx: (type, props, key) => react.createElement(type, key !== undefined ? { ...props, key } : props),
        jsxs: (type, props, key) => react.createElement(type, key !== undefined ? { ...props, key } : props),
      }
    }

    let runtime = null
    for (const id of ['@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-runtime/client']) {
      try {
        runtime = require(id)
        if (runtime && typeof runtime.createSnapshotStore === 'function') break
      } catch (_) { /* module not available in this build; try next */ }
    }

    const NS = 'dsh-image-gen'
    const SETTINGS_NS = 'dsh-image-gen'
    const TITLE = 'Image Studio'
    const SUBTITLE = 'Multi-provider AI image generation, editing, upscale & vectorization.'

    // DSH UI primitives chevron icon with fallback SVG.
    let ChevronIcon = null
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      ChevronIcon = primitives && primitives.IconChevronDownOutline14
    } catch (_) {
      ChevronIcon = null
    }
    const ChevronIconNode = ChevronIcon
      ? react.createElement(ChevronIcon)
      : react.createElement('svg', {
          width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true,
          style: { display: 'block' },
        }, react.createElement('path', {
          d: 'M3 5.5 L7 9.5 L11 5.5',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
          strokeLinecap: 'round', strokeLinejoin: 'round',
        }))

