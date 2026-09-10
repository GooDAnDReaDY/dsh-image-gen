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

    const NS = 'dsh-image-gen'
    const SETTINGS_NS = 'dsh-image-gen'
    const TITLE = 'Image Studio'
    const SUBTITLE = 'Multi-provider AI image generation, editing, upscale & vectorization.'

    // Ядровый шеврон раскрытия; в урезанной сборке — запасной SVG той же формы.
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

    // -------------------------------------------------------------- CSS & Design System
    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.getElementById('dsh-image-gen-full-css')) return
      const style = document.createElement('style')
      style.id = 'dsh-image-gen-full-css'
      style.dataset.dshPlugin = NS
      style.textContent = `
.ig-page{display:flex;flex-direction:column;gap:18px;padding:4px 0 24px;max-width:1000px}
.ig-header{display:flex;flex-direction:column;gap:8px;padding-bottom:14px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.ig-page-title{font-size:20px;font-weight:700;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:10px}
.ig-page-sub{font-size:13px;color:var(--dsw-alias-label-secondary);line-height:1.5}

.ig-section-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:14px}
.ig-section-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;justify-content:space-between}
.ig-section-desc{font-size:13px;color:var(--dsw-alias-label-secondary);margin-top:-6px;line-height:1.4}

.ig-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.ig-grid-2{display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:12px}
.ig-grid-4{display:grid;grid-template-columns:repeat(auto-fit, minmax(190px, 1fr));gap:10px}

.ig-stat-box{padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:4px}
.ig-stat-val{font-size:16px;font-weight:700;color:var(--dsw-alias-label-primary)}
.ig-stat-lbl{font-size:12px;color:var(--dsw-alias-label-secondary)}

.ig-badge{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);display:inline-flex;align-items:center;gap:5px;font-weight:500}
.ig-badge-ok{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);background:rgba(16,185,129,0.08)}
.ig-badge-warn{border-color:var(--dsw-alias-state-warning-primary);color:var(--dsw-alias-state-warning-primary);background:rgba(245,158,11,0.08)}
.ig-badge-bad{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:rgba(239,68,68,0.08)}

.ig-tabs{display:flex;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:8px;margin-bottom:6px;overflow-x:auto}
.ig-tab-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:6px;padding:6px 12px;font-size:13px;background:transparent;color:var(--dsw-alias-label-secondary);font-weight:500;display:inline-flex;align-items:center;gap:6px;transition:all .15s ease}
.ig-tab-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.ig-tab-btn-active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);font-weight:600}

.ig-field{display:flex;flex-direction:column;gap:5px;padding:8px 0}
.ig-field-head{display:flex;justify-content:space-between;align-items:center}
.ig-field-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.ig-field-hint{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.4}
.ig-field-err{font-size:12px;color:var(--dsw-alias-state-error-primary);margin-top:2px}

.ig-input,.ig-select{height:34px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;width:100%;box-sizing:border-box}
.ig-input:focus,.ig-select:focus{outline:none;border-color:var(--dsw-alias-state-brand-primary)}
.ig-input-invalid{border-color:var(--dsw-alias-state-error-primary)}
.ig-input:disabled,.ig-select:disabled{opacity:0.5;cursor:not-allowed}

.ig-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 14px;font-size:13px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:500;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:all .15s ease}
.ig-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-4, var(--dsw-alias-bg-layer-2));border-color:var(--dsw-alias-label-dimmed, var(--dsw-alias-border-l2))}
.ig-btn-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:transparent}
.ig-btn-primary:hover:not(:disabled){opacity:0.9}
.ig-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:rgba(239,68,68,0.3)}
.ig-btn-danger:hover:not(:disabled){background:rgba(239,68,68,0.12);border-color:rgba(239,68,68,0.5)}
.ig-btn-disabled{opacity:0.5;cursor:not-allowed}

.ig-reset{font-size:11px;color:var(--dsw-alias-state-brand-primary);background:none;border:none;cursor:pointer;padding:0;text-decoration:underline}
.ig-reset:hover{opacity:0.8}

.ig-alert-ok{padding:10px 14px;border-radius:8px;background:rgba(16,185,129,0.1);color:var(--dsw-alias-state-success-primary);font-size:13px}
.ig-alert-bad{padding:10px 14px;border-radius:8px;background:rgba(239,68,68,0.1);color:var(--dsw-alias-state-error-primary);font-size:13px}
.ig-alert-err{padding:10px 14px;border-radius:8px;background:rgba(239,68,68,0.1);color:var(--dsw-alias-state-error-primary);font-size:13px}
.ig-banner-warning{padding:12px 16px;border-radius:8px;background:rgba(245,158,11,0.12);border:1px solid var(--dsw-alias-state-warning-primary);color:var(--dsw-alias-state-warning-primary);font-size:13px;display:flex;align-items:center;gap:10px;font-weight:500}

/* Backward-compatibility alias styles for toolview */
.fal_head{font-size:13px;font-weight:600;margin-bottom:8px;color:var(--dsw-alias-label-primary)}
.fal-prompt{font-size:13px;padding:8px 12px;background:var(--dsw-alias-bg-layer-2);border-radius:6px;border:1px solid var(--dsw-alias-border-l2);margin-bottom:8px;word-break:break-word}
.fal-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:6px}
.fal-err{padding:10px;border-radius:6px;background:rgba(239,68,68,0.1);color:var(--dsw-alias-state-error-primary);font-size:12px}
`
      document.head.appendChild(style)
    }

    function createErrorBoundary() {
      if (!React || typeof React.Component !== 'function') {
        return function NoopBoundary(props) { return props?.children || null }
      }
      return class ErrorBoundary extends React.Component {
        constructor(props) {
          super(props)
          this.state = { hasError: false, error: null }
        }
        static getDerivedStateFromError(error) {
          return { hasError: true, error }
        }
        componentDidCatch(error, errorInfo) {
          console.error('[dsh-image-gen] UI Crash caught by ErrorBoundary:', error, errorInfo)
        }
        render() {
          if (this.state.hasError) {
            return react.createElement(
              'div',
              {
                className: 'ig-alert-err',
                style: { margin: '12px 0', padding: '14px', borderRadius: '8px' },
              },
              react.createElement('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '⚠️ Image Gen UI Error:'),
              react.createElement('div', { style: { fontSize: '12px', wordBreak: 'break-all' } }, String(this.state.error?.message || this.state.error)),
              react.createElement(
                'button',
                {
                  type: 'button',
                  className: 'ig-btn',
                  style: { marginTop: '10px', fontSize: '12px', padding: '4px 10px' },
                  onClick: () => this.setState({ hasError: false, error: null }),
                },
                'Retry'
              )
            )
          }
          return this.props.children
        }
      }
    }
    const ErrorBoundary = createErrorBoundary()

    // -------------------------------------------------------------- Form & Specs
    const booleanField = (field) => ({
      field,
      format: (value) => (value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : ''),
      parse: (text) => {
        if (text === '') return { kind: 'clear' }
        if (text === 'true') return { kind: 'set', value: true }
        if (text === 'false') return { kind: 'set', value: false }
        return void 0
      },
    })

    function textField(field) {
      return {
        field,
        format: (value) => (typeof value === 'string' ? value : ''),
        parse: (text) => {
          if (text === '') return { kind: 'clear' }
          return { kind: 'set', value: text }
        },
      }
    }

    function numberField(field) {
      return {
        field,
        format: (value) => (typeof value === 'number' ? String(value) : ''),
        parse: (text) => {
          if (text === '') return { kind: 'clear' }
          const value = Number(text)
          return Number.isFinite(value) ? { kind: 'set', value } : void 0
        },
      }
    }

    function selectField(field, options) {
      const set = new Set(options)
      return {
        field,
        format: (value) => (typeof value === 'string' ? value : ''),
        parse: (text) => {
          if (text === '') return { kind: 'clear' }
          return set.has(text) ? { kind: 'set', value: text } : void 0
        },
      }
    }

    const PROVIDERS = ['fal', 'custom', 'codex', 'grok', 'local', 'seedream', 'gemini', 'replicate']
    const IMAGE_SIZES = ['landscape_4_3', 'landscape_16_9', 'portrait_4_3', 'portrait_16_9', 'square', 'square_hd']
    const OUTPUT_FORMATS = ['png', 'jpeg', 'webp']
    const DELIVERY_MODES = ['link', 'image']
    const STYLE_PRESET_OPTIONS = ['', 'cinematic', 'anime', 'digital_art', 'photographic', 'fantasy', 'isometric', 'cyberpunk', 'watercolor', 'origami', 'oil_painting', 'pixel_art', 'logo']
    const SIZE_PIXELS = {
      square: '512x512',
      square_hd: '1024x1024',
      portrait_4_3: '768x1024',
      portrait_16_9: '576x1024',
      landscape_4_3: '1024x768',
      landscape_16_9: '1024x576',
    }

    const FIELDS = [
      // General
      { field: 'enabled', spec: booleanField('enabled'), kind: 'select', options: ['true', 'false'], labelKey: 'f.enabled', hintKey: 'f.enabledHint', tab: 'general' },
      { field: 'provider', spec: selectField('provider', PROVIDERS), kind: 'select', options: PROVIDERS, labelKey: 'f.provider', hintKey: 'f.providerHint', tab: 'general', providerNeeds: { fal: 'f.needFal', custom: 'f.needCustom', codex: 'f.needCodex', grok: 'f.needGrok', local: 'f.needLocal', seedream: 'f.needSeedream', gemini: 'f.needGemini', replicate: 'f.needReplicate' } },
      { field: 'defaultSize', spec: selectField('defaultSize', IMAGE_SIZES), kind: 'select', options: IMAGE_SIZES, labelKey: 'f.defaultSize', hintKey: 'f.defaultSizeHint', sizePixels: SIZE_PIXELS, tab: 'general' },
      { field: 'defaultFormat', spec: selectField('defaultFormat', OUTPUT_FORMATS), kind: 'select', options: OUTPUT_FORMATS, labelKey: 'f.defaultFormat', hintKey: 'f.defaultFormatHint', tab: 'general' },
      { field: 'deliverAs', spec: selectField('deliverAs', DELIVERY_MODES), kind: 'select', options: DELIVERY_MODES, labelKey: 'f.deliverAs', hintKey: 'f.deliverAsHint', tab: 'general' },
      { field: 'outputDir', spec: textField('outputDir'), kind: 'text', labelKey: 'f.outputDir', hintKey: 'f.outputDirHint', placeholderKey: 'p.outputDir', tab: 'general' },
      { field: 'historyLimit', spec: numberField('historyLimit'), kind: 'number', labelKey: 'f.historyLimit', hintKey: 'f.historyLimitHint', placeholderKey: 'p.historyLimit', tab: 'general' },

      // Provider: FAL
      { field: 'model', spec: textField('model'), kind: 'text', labelKey: 'f.model', hintKey: 'f.modelHint', placeholderKey: 'p.model', when: ['fal'], tab: 'provider' },
      { field: 'apiKeyEnv', spec: textField('apiKeyEnv'), kind: 'text', labelKey: 'f.apiKeyEnv', hintKey: 'f.apiKeyEnvHint', placeholderKey: 'p.apiKeyEnv', when: ['fal'], tab: 'provider' },
      { field: 'baseURL', spec: textField('baseURL'), kind: 'text', labelKey: 'f.baseURL', hintKey: 'f.baseURLHint', placeholderKey: 'p.baseURL', when: ['fal'], tab: 'provider' },
      { field: 'pollIntervalMs', spec: numberField('pollIntervalMs'), kind: 'number', labelKey: 'f.pollIntervalMs', hintKey: 'f.pollIntervalMsHint', placeholderKey: 'p.pollIntervalMs', when: ['fal'], tab: 'provider' },
      { field: 'timeoutMs', spec: numberField('timeoutMs'), kind: 'number', labelKey: 'f.timeoutMs', hintKey: 'f.timeoutMsHint', placeholderKey: 'p.timeoutMs', when: ['fal'], tab: 'provider' },

      // Provider: Custom
      { field: 'customBaseURL', spec: textField('customBaseURL'), kind: 'text', labelKey: 'f.customBaseURL', hintKey: 'f.customBaseURLHint', placeholderKey: 'p.customBaseURL', when: ['custom'], tab: 'provider' },
      { field: 'customModel', spec: textField('customModel'), kind: 'text', labelKey: 'f.customModel', hintKey: 'f.customModelHint', placeholderKey: 'p.customModel', when: ['custom'], tab: 'provider' },
      { field: 'customKeyEnv', spec: textField('customKeyEnv'), kind: 'text', labelKey: 'f.customKeyEnv', hintKey: 'f.customKeyEnvHint', placeholderKey: 'p.customKeyEnv', when: ['custom'], tab: 'provider' },
      { field: 'customSize', spec: textField('customSize'), kind: 'text', labelKey: 'f.customSize', hintKey: 'f.customSizeHint', placeholderKey: 'p.customSize', when: ['custom'], tab: 'provider' },

      // Provider: Replicate
      { field: 'replicateModel', spec: textField('replicateModel'), kind: 'text', labelKey: 'f.replicateModel', hintKey: 'f.replicateModelHint', placeholderKey: 'p.replicateModel', when: ['replicate'], tab: 'provider' },
      { field: 'replicateKeyEnv', spec: textField('replicateKeyEnv'), kind: 'text', labelKey: 'f.replicateKeyEnv', hintKey: 'f.replicateKeyEnvHint', placeholderKey: 'p.replicateKeyEnv', when: ['replicate'], tab: 'provider' },

      // Provider: SeaDream
      { field: 'seedreamModel', spec: textField('seedreamModel'), kind: 'text', labelKey: 'f.seedreamModel', hintKey: 'f.seedreamModelHint', placeholderKey: 'p.seedreamModel', when: ['seedream'], tab: 'provider' },
      { field: 'seedreamKeyEnv', spec: textField('seedreamKeyEnv'), kind: 'text', labelKey: 'f.seedreamKeyEnv', hintKey: 'f.seedreamKeyEnvHint', placeholderKey: 'p.seedreamKeyEnv', when: ['seedream'], tab: 'provider' },
      { field: 'seedreamBaseURL', spec: textField('seedreamBaseURL'), kind: 'text', labelKey: 'f.seedreamBaseURL', hintKey: 'f.seedreamBaseURLHint', placeholderKey: 'p.seedreamBaseURL', when: ['seedream'], tab: 'provider' },

      // Provider: Gemini
      { field: 'geminiModel', spec: textField('geminiModel'), kind: 'text', labelKey: 'f.geminiModel', hintKey: 'f.geminiModelHint', placeholderKey: 'p.geminiModel', when: ['gemini'], tab: 'provider' },
      { field: 'geminiKeyEnv', spec: textField('geminiKeyEnv'), kind: 'text', labelKey: 'f.geminiKeyEnv', hintKey: 'f.geminiKeyEnvHint', placeholderKey: 'p.geminiKeyEnv', when: ['gemini'], tab: 'provider' },

      // Provider: Local
      { field: 'localKind', spec: selectField('localKind', ['comfyui', 'a1111']), kind: 'select', options: ['comfyui', 'a1111'], labelKey: 'f.localKind', hintKey: 'f.localKindHint', when: ['local'], tab: 'provider' },
      { field: 'localBaseURL', spec: textField('localBaseURL'), kind: 'text', labelKey: 'f.localBaseURL', hintKey: 'f.localBaseURLHint', placeholderKey: 'p.localBaseURL', when: ['local'], tab: 'provider' },
      { field: 'localModel', spec: textField('localModel'), kind: 'text', labelKey: 'f.localModel', hintKey: 'f.localModelHint', placeholderKey: 'p.localModel', when: ['local'], tab: 'provider' },
      { field: 'localSteps', spec: numberField('localSteps'), kind: 'number', labelKey: 'f.localSteps', hintKey: 'f.localStepsHint', placeholderKey: 'p.localSteps', when: ['local'], tab: 'provider' },
      { field: 'localCfg', spec: numberField('localCfg'), kind: 'number', labelKey: 'f.localCfg', hintKey: 'f.localCfgHint', placeholderKey: 'p.localCfg', when: ['local'], tab: 'provider' },
      // Backward-compat aliases for tests
      { field: 'localComfyUrl', spec: textField('localComfyUrl'), kind: 'text', labelKey: 'f.localComfyUrl', hintKey: 'f.localComfyUrlHint', placeholderKey: 'p.localComfyUrl', when: ['local'], tab: 'provider' },
      { field: 'localA1111Url', spec: textField('localA1111Url'), kind: 'text', labelKey: 'f.localA1111Url', hintKey: 'f.localA1111UrlHint', placeholderKey: 'p.localA1111Url', when: ['local'], tab: 'provider' },

      // Provider: Codex / Grok
      { field: 'subscriptionQuality', spec: selectField('subscriptionQuality', ['', 'low', 'medium', 'high']), kind: 'select', options: ['', 'low', 'medium', 'high'], labelKey: 'f.subscriptionQuality', hintKey: 'f.subscriptionQualityHint', when: ['codex', 'grok'], tab: 'provider' },

      // Enhancer & Style
      { field: 'enhancePrompt', spec: booleanField('enhancePrompt'), kind: 'select', options: ['true', 'false'], labelKey: 'f.enhancePrompt', hintKey: 'f.enhancePromptHint', tab: 'enhancer' },
      { field: 'enableLlmEnhancer', spec: booleanField('enableLlmEnhancer'), kind: 'select', options: ['true', 'false'], labelKey: 'f.enableLlmEnhancer', hintKey: 'f.enableLlmEnhancerHint', tab: 'enhancer' },
      { field: 'enhanceModel', spec: textField('enhanceModel'), kind: 'text', labelKey: 'f.enhanceModel', hintKey: 'f.enhanceModelHint', placeholderKey: 'p.enhanceModel', tab: 'enhancer' },
      { field: 'enhanceBelowChars', spec: numberField('enhanceBelowChars'), kind: 'number', labelKey: 'f.enhanceBelowChars', hintKey: 'f.enhanceBelowCharsHint', placeholderKey: 'p.enhanceBelowChars', tab: 'enhancer' },
      { field: 'stylePreset', spec: selectField('stylePreset', STYLE_PRESET_OPTIONS), kind: 'select', options: STYLE_PRESET_OPTIONS, labelKey: 'f.stylePreset', hintKey: 'f.stylePresetHint', tab: 'enhancer' },

      // Safety & Budget
      { field: 'qualityGate', spec: booleanField('qualityGate'), kind: 'select', options: ['true', 'false'], labelKey: 'f.qualityGate', hintKey: 'f.qualityGateHint', tab: 'safety' },
      { field: 'dailyBudgetUsd', spec: numberField('dailyBudgetUsd'), kind: 'number', labelKey: 'f.dailyBudgetUsd', hintKey: 'f.dailyBudgetUsdHint', placeholderKey: 'p.dailyBudgetUsd', tab: 'safety' },
      { field: 'loopGuardLimit', spec: numberField('loopGuardLimit'), kind: 'number', labelKey: 'f.loopGuardLimit', hintKey: 'f.loopGuardLimitHint', placeholderKey: 'p.loopGuardLimit', tab: 'safety' },

      // Cache & Storage
      { field: 'diskCache', spec: booleanField('diskCache'), kind: 'select', options: ['true', 'false'], labelKey: 'f.diskCache', hintKey: 'f.diskCacheHint', tab: 'cache' },
      { field: 'cacheBySeed', spec: booleanField('cacheBySeed'), kind: 'select', options: ['true', 'false'], labelKey: 'f.cacheBySeed', hintKey: 'f.cacheBySeedHint', tab: 'cache' },
      { field: 'cacheByPrompt', spec: booleanField('cacheByPrompt'), kind: 'select', options: ['true', 'false'], labelKey: 'f.cacheByPrompt', hintKey: 'f.cacheByPromptHint', tab: 'cache' },
      { field: 'pruneDays', spec: numberField('pruneDays'), kind: 'number', labelKey: 'f.pruneDays', hintKey: 'f.pruneDaysHint', placeholderKey: 'p.pruneDays', tab: 'cache' },
      { field: 'cacheTtlDays', spec: numberField('cacheTtlDays'), kind: 'number', labelKey: 'f.cacheTtlDays', hintKey: 'f.cacheTtlDaysHint', placeholderKey: 'p.cacheTtlDays', tab: 'cache' },
    ]

    var CardForm = class {
      constructor(scope, specs) {
        this.scope = scope
        this.specs = new Map(specs.map((spec) => [spec.field, spec]))
        this.staged = new Map()
        this.listeners = new Set()
        this.saving = false
        this.failed = false
        if (scope && scope.subscribe) {
          scope.subscribe(() => this.publish())
        }
      }
      bind(project) {
        return {
          getSnapshot: () => project(),
          subscribe: (cb) => {
            this.listeners.add(cb)
            return () => this.listeners.delete(cb)
          },
        }
      }
      shell() {
        const snapshot = (this.scope && this.scope.getSnapshot && this.scope.getSnapshot()) || { status: 'ready', writable: true }
        const plan = this.plan()
        return {
          available: snapshot.status === 'ready',
          writable: Boolean(snapshot.writable),
          dirty: plan.length > 0,
          invalid: plan.some((item) => item.run === void 0),
          saving: this.saving,
          failed: this.failed,
        }
      }
      field(field) {
        const spec = this.specOf(field)
        const staged = this.staged.get(field)
        if (staged === void 0) {
          return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
        }
        const write = staged.clear ? { kind: 'clear' } : spec.parse(staged.text)
        return { text: staged.text, overridden: write?.kind === 'set', invalid: write === void 0 }
      }
      actions() {
        return {
          edit: (field, text) => this.stage(field, { text, clear: false }),
          resetField: (field) => {
            const spec = this.specOf(field)
            this.stage(field, { text: spec.format(this.baseValue(field)), clear: true })
          },
          save: () => this.save(),
          discard: () => {
            if (this.staged.size === 0 && !this.failed) return
            this.staged.clear()
            this.failed = false
            this.publish()
          },
        }
      }
      async save() {
        const plan = this.plan()
        const writes = plan.flatMap((item) => (item.run === void 0 ? [] : [item.run]))
        if (plan.length === 0 || this.saving || writes.length !== plan.length) return
        this.saving = true
        this.failed = false
        this.publish()
        let landed = true
        for (const write of writes) landed = (await write()) && landed
        if (landed) this.staged.clear()
        this.failed = !landed
        this.saving = false
        this.publish()
      }
      publish() {
        for (const listener of this.listeners) listener()
      }
      specOf(field) {
        const spec = this.specs.get(field)
        if (!spec) throw new Error('dsh-image-gen: unknown field "' + field + '"')
        return spec
      }
      section() {
        return (this.scope && this.scope.getSnapshot && this.scope.getSnapshot()?.value) || {}
      }
      sectionValue(field) {
        return this.section()[field]
      }
      stored(field) {
        return this.sectionValue(field) !== void 0
      }
      baseValue(_) {
        return void 0
      }
      stage(field, staged) {
        this.specOf(field)
        this.staged.set(field, staged)
        this.publish()
      }
      plan() {
        const plan = []
        for (const [field, staged] of this.staged) {
          const spec = this.specOf(field)
          const write = staged.clear ? { kind: 'clear' } : spec.parse(staged.text)
          if (!write) {
            plan.push({ field, run: void 0 })
            continue
          }
          plan.push({
            field,
            run: async () => {
              try {
                if (write.kind === 'clear') {
                  if (this.scope && this.scope.delete) await this.scope.delete(field)
                } else {
                  if (this.scope && this.scope.set) await this.scope.set(field, write.value)
                }
                return true
              } catch (_) {
                return false
              }
            },
          })
        }
        return plan
      }
    }

    var FalSettingsCardController = class {
      constructor(scope) {
        this.form = new CardForm(scope, FIELDS.map((entry) => entry.spec))
        this.store = this.form.bind(() => this.projection())
      }
      projection() {
        return {
          ...this.form.shell(),
          ...Object.fromEntries(FIELDS.map((entry) => [entry.field, this.form.field(entry.field)])),
        }
      }
      inject() {
        return { hooks: { falSettingsCard: this.store }, ...this.form.actions() }
      }
    }

    // -------------------------------------------------------------- UI Components
    function Field(props) {
      const { entry, state, fieldProps, t, onEdit, onReset } = props
      const id = 'dsh-image-gen-' + entry.field
      const label = t(entry.labelKey)
      const hint = t(entry.hintKey)
      const overridden = Boolean(state.overridden)
      const invalid = Boolean(state.invalid)
      const disabled = Boolean(fieldProps.disabled)

      if (entry.kind === 'select') {
        const px = entry.sizePixels && entry.sizePixels[state.text] ? ' — ' + entry.sizePixels[state.text] : ''
        const need = entry.providerNeeds && entry.providerNeeds[state.text] ? ' (' + t(entry.providerNeeds[state.text]) + ')' : ''
        return react.createElement(
          'div',
          { className: 'ig-field', key: entry.field },
          react.createElement(
            'div',
            { className: 'ig-field-head' },
            react.createElement('label', { className: 'ig-field-label', htmlFor: id }, label),
            overridden
              ? react.createElement(
                  'div',
                  { className: 'ig-row' },
                  react.createElement('span', { className: 'ig-badge ig-badge-warn' }, fieldProps.overriddenLabel),
                  react.createElement('button', { type: 'button', className: 'ig-reset', disabled, onClick: onReset }, fieldProps.resetLabel)
                )
              : null
          ),
          react.createElement(
            'select',
            {
              id,
              className: 'ig-select',
              value: state.text,
              disabled,
              onChange: (e) => onEdit(e.target.value),
            },
            entry.options.map((opt) =>
              react.createElement('option', { key: opt, value: opt }, opt === '' ? t('f.inherit') : opt)
            )
          ),
          react.createElement('p', { className: 'ig-field-hint' }, hint + px + need)
        )
      }

      return react.createElement(
        'div',
        { className: 'ig-field', key: entry.field },
        react.createElement(
          'div',
          { className: 'ig-field-head' },
          react.createElement('label', { className: 'ig-field-label', htmlFor: id }, label),
          overridden
            ? react.createElement(
                'div',
                { className: 'ig-row' },
                react.createElement('span', { className: 'ig-badge ig-badge-warn' }, fieldProps.overriddenLabel),
                react.createElement('button', { type: 'button', className: 'ig-reset', disabled, onClick: onReset }, fieldProps.resetLabel)
              )
            : null
        ),
        react.createElement('input', {
          id,
          className: invalid ? 'ig-input ig-input-invalid' : 'ig-input',
          type: 'text',
          ...(entry.kind === 'number' ? { inputMode: 'numeric' } : {}),
          value: state.text,
          placeholder: entry.placeholderKey ? t(entry.placeholderKey) : '',
          disabled,
          onChange: (e) => onEdit(e.target.value),
        }),
        react.createElement('p', { className: invalid ? 'ig-field-err' : 'ig-field-hint' }, invalid ? fieldProps.invalidLabel : hint)
      )
    }

    function FalSettingsCard(props) {
      const t = props.t || ((k) => k)
      const [open, setOpen] = react.useState(props.defaultOpen ?? true)
      const [activeTab, setActiveTab] = react.useState('general')

      react.useEffect(() => {
        ensureCss()
      }, [])

      const state = (typeof props.useFalSettingsCard === 'function'
        ? props.useFalSettingsCard((s) => s)
        : null) || props.state || { available: true, writable: true, provider: { text: 'fal' } }

      const disabled = !state.writable
      const currentProvider = (state.provider && state.provider.text) || 'fal'
      const blocked = !state.dirty || state.invalid || state.saving

      const fieldProps = {
        overriddenLabel: t('settings.overridden'),
        resetLabel: t('settings.reset'),
        invalidLabel: t('settings.invalidNumber'),
        disabled,
      }

      if (!state.available) {
        return react.createElement(
          'li',
          { className: 'ig-section-card', style: { listStyle: 'none' } },
          react.createElement('p', { className: 'ig-field-hint' }, t('settings.unavailable'))
        )
      }

      const tabs = [
        { id: 'general', label: t('tab.general'), icon: '⚙️' },
        { id: 'provider', label: t('tab.provider') + ' (' + currentProvider.toUpperCase() + ')', icon: '🔌' },
        { id: 'enhancer', label: t('tab.enhancer'), icon: '✨' },
        { id: 'safety', label: t('tab.safety'), icon: '🛡️' },
        { id: 'cache', label: t('tab.cache'), icon: '⚡' },
      ]

      const currentTabFields = FIELDS.filter((entry) => {
        if (entry.tab !== activeTab) return false
        if (entry.when && !entry.when.includes(currentProvider)) return false
        return true
      })

      const diskCacheOn = state.diskCache && state.diskCache.text !== 'false'
      const qualityGateOn = state.qualityGate && state.qualityGate.text !== 'false'
      const budgetText = (state.dailyBudgetUsd && state.dailyBudgetUsd.text) || '0'
      const loopLimit = (state.loopGuardLimit && state.loopGuardLimit.text) || '3'

      return react.createElement(
        'li',
        { className: 'ig-section-card', style: { listStyle: 'none', marginBottom: '12px' } },
        // Header
        react.createElement(
          'button',
          {
            type: 'button',
            style: {
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              padding: 0,
              textAlign: 'left',
            },
            'aria-expanded': open,
            onClick: () => setOpen(!open),
          },
          react.createElement(
            'div',
            { style: { flex: 1 } },
            react.createElement(
              'div',
              { style: { fontWeight: 700, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' } },
              '🎨 ' + t('settings.title')
            ),
            react.createElement(
              'div',
              { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } },
              t('settings.description')
            )
          ),
          state.dirty
            ? react.createElement('span', { className: 'ig-badge ig-badge-warn', style: { marginRight: '8px' } }, t('settings.unsaved'))
            : null,
          react.createElement(
            'span',
            { style: { transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .16s' } },
            ChevronIconNode
          )
        ),
        open
          ? react.createElement(
              'div',
              { className: 'ig-page' },
              // Quick Stats Row
              react.createElement(
                'div',
                { className: 'ig-grid-4' },
                react.createElement(
                  'div',
                  { className: 'ig-stat-box' },
                  react.createElement('div', { className: 'ig-stat-val' }, currentProvider.toUpperCase()),
                  react.createElement('div', { className: 'ig-stat-lbl' }, t('stat.active_provider'))
                ),
                react.createElement(
                  'div',
                  { className: 'ig-stat-box' },
                  react.createElement('div', { className: 'ig-stat-val' }, ((state.defaultSize && state.defaultSize.text) || '4:3') + ' · ' + ((state.defaultFormat && state.defaultFormat.text) || 'png')),
                  react.createElement('div', { className: 'ig-stat-lbl' }, t('stat.format_size'))
                ),
                react.createElement(
                  'div',
                  { className: 'ig-stat-box' },
                  react.createElement(
                    'div',
                    { className: 'ig-stat-val' },
                    react.createElement(
                      'span',
                      { className: qualityGateOn ? 'ig-badge ig-badge-ok' : 'ig-badge ig-badge-warn' },
                      qualityGateOn ? 'Gate Active' : 'Off'
                    ),
                    ' ',
                    react.createElement('span', { className: 'ig-badge ig-badge-ok' }, 'Guard ' + loopLimit)
                  ),
                  react.createElement('div', { className: 'ig-stat-lbl' }, t('stat.safety_status'))
                ),
                react.createElement(
                  'div',
                  { className: 'ig-stat-box' },
                  react.createElement(
                    'div',
                    { className: 'ig-stat-val' },
                    react.createElement(
                      'span',
                      { className: diskCacheOn ? 'ig-badge ig-badge-ok' : 'ig-badge ig-badge-warn' },
                      diskCacheOn ? 'Cache ON' : 'Off'
                    ),
                    ' ',
                    budgetText !== '0' ? '$' + budgetText : 'No limit'
                  ),
                  react.createElement('div', { className: 'ig-stat-lbl' }, t('stat.budget_cache'))
                )
              ),
              // Tab Navigation
              react.createElement(
                'div',
                { className: 'ig-tabs' },
                tabs.map((tab) =>
                  react.createElement(
                    'button',
                    {
                      key: tab.id,
                      type: 'button',
                      className: activeTab === tab.id ? 'ig-tab-btn ig-tab-btn-active' : 'ig-tab-btn',
                      onClick: () => setActiveTab(tab.id),
                    },
                    tab.icon + ' ' + tab.label
                  )
                )
              ),
              // Active Tab Fields
              react.createElement(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                currentTabFields.map((entry) =>
                  react.createElement(Field, {
                    key: entry.field,
                    entry,
                    state: state[entry.field] ?? { text: '', overridden: false, invalid: false },
                    fieldProps,
                    t,
                    onEdit: (val) => props.edit && props.edit(entry.field, val),
                    onReset: () => props.resetField && props.resetField(entry.field),
                  })
                )
              ),
              // Footer Action Bar
              react.createElement(
                'div',
                {
                  style: {
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: '10px',
                    paddingTop: '12px',
                    borderTop: '1px solid var(--dsw-alias-border-l2)',
                  },
                },
                state.failed
                  ? react.createElement('span', { className: 'ig-alert-err', style: { marginRight: 'auto', padding: '4px 10px' } }, t('settings.saveFailed'))
                  : null,
                react.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'ig-btn',
                    disabled: !state.dirty || state.saving,
                    onClick: props.discard,
                  },
                  t('settings.discard')
                ),
                react.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'ig-btn ig-btn-primary',
                    disabled: blocked,
                    onClick: props.save,
                  },
                  t(state.saving ? 'settings.saving' : 'settings.save')
                )
              )
            )
          : null
      )
    }

    // -------------------------------------------------------------- Toolview Component
    const IMAGE_URL_RE = /https?:\/\/[^\s)]+\.(png|jpg|jpeg|webp|gif)(\?[^\s)]*)?/i

    function readResult(block) {
      if (!block) return { text: '', url: '', attachment: null }
      const text = block.output || block.text || ''
      const attachment = block.attachment || (block.attachments && block.attachments[0]) || null
      const linked = text.match(IMAGE_URL_RE)
      return {
        attachment,
        url: linked ? linked[0] : '',
        text: linked ? text.replace(linked[0], '').trim() : text,
      }
    }

    function FalImageCard(props) {
      const block = props.block
      const running = !('kind' in (block || {}))
      const failed = block && (block.isError || block.error !== undefined)
      const parsed = readResult(block)
      const t = props.t || ((k) => k)

      react.useEffect(() => {
        ensureCss()
      }, [])

      let args = {}
      let prompt = ''
      try {
        const raw = (block && (block.call ? block.call.argsRaw : block.argsRaw)) || ''
        if (raw) {
          args = JSON.parse(raw)
          prompt = args.prompt || ''
        }
      } catch (_) {}

      const [copied, setCopied] = react.useState(false)

      const sendActionPrompt = async (text) => {
        try {
          const sessions = props.sessions
          const current = sessions && sessions.list && sessions.list.current
          const binding = current && sessions.binding(current)
          const session = binding && binding.session
          if (session && session.prompt) await session.prompt([{ type: 'text', text }], 'queue')
        } catch (_) {}
      }

      const onCopyPrompt = () => {
        if (prompt && typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(prompt)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }
      }

      const onReroll = () => {
        const nextSeed = typeof args.seed === 'number' ? args.seed + 1 : Math.floor(Math.random() * 100000)
        sendActionPrompt(t('card.actionReroll') + ' (' + nextSeed + '): ' + (prompt || ''))
      }

      const onUpscale = () => {
        const ref = parsed.attachment ? (parsed.attachment.attachmentId || parsed.attachment.id) : (parsed.url || '')
        sendActionPrompt(t('card.actionUpscale') + ': upscale_image(image: "' + ref + '")')
      }

      const onRemoveBg = () => {
        const ref = parsed.attachment ? (parsed.attachment.attachmentId || parsed.attachment.id) : (parsed.url || '')
        sendActionPrompt(t('card.actionRemoveBg') + ': remove_background(image: "' + ref + '")')
      }

      const head = react.createElement(
        'div',
        { className: 'fal_head' },
        running ? '⏳ ' + t('card.generating') : failed ? '❌ ' + t('card.failed') : '🖼️ ' + t('card.image')
      )

      const body = []
      if (prompt) {
        body.push(react.createElement('div', { className: 'fal-prompt', key: 'p' }, prompt))
      }
      if (failed) {
        body.push(react.createElement('div', { className: 'fal-err', key: 'e' }, parsed.text || t('card.unknownError')))
      } else if (!parsed.attachment && parsed.url) {
        body.push(react.createElement('img', {
          key: 'i',
          src: parsed.url,
          alt: prompt || 'generated image',
          loading: 'lazy',
          style: { maxWidth: '100%', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)' },
        }))
      } else if (parsed.attachment) {
        const a = parsed.attachment
        const query = 'id=' + encodeURIComponent(a.attachmentId ?? a.id ?? '')
          + '&mt=' + encodeURIComponent(a.mediaType || 'image/png')
          + '&b=' + encodeURIComponent(String(a.bytes ?? 0))
          + '&w=' + encodeURIComponent(String(a.width ?? 0))
          + '&h=' + encodeURIComponent(String(a.height ?? 0))
        body.push(react.createElement('img', {
          key: 'i',
          src: '/dsh-image-gen/image?' + query,
          alt: prompt || 'generated image',
          loading: 'lazy',
          style: { maxWidth: '100%', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)' },
        }))
      }

      const actions = []
      if (!running && !failed && (parsed.url || parsed.attachment)) {
        actions.push(
          react.createElement('button', { key: 'reroll', type: 'button', className: 'ig-btn', onClick: onReroll }, '🎲 ' + t('card.reroll')),
          react.createElement('button', { key: 'upscale', type: 'button', className: 'ig-btn', onClick: onUpscale }, '🔍 ' + t('card.upscale')),
          react.createElement('button', { key: 'removeBg', type: 'button', className: 'ig-btn', onClick: onRemoveBg }, '✂️ ' + t('card.removeBg')),
          react.createElement('button', { key: 'copy', type: 'button', className: 'ig-btn', onClick: onCopyPrompt }, copied ? '✓ Copied' : '📋 ' + t('card.copyPrompt'))
        )
      }

      return react.createElement(
        'div',
        { className: 'ig-section-card', style: { margin: '8px 0' } },
        head,
        body,
        actions.length > 0 ? react.createElement('div', { className: 'ig-row', style: { marginTop: '8px' } }, actions) : null
      )
    }

    // -------------------------------------------------------------- Dictionaries
    const en = {
      'settings.navLabel': 'Image Studio',
      'settings.title': 'Image Studio',
      'settings.description': 'AI Image generation, inpainting, variations, upscale & vectorization.',
      'settings.unavailable': 'Plugin settings are initializing. They will appear automatically in a few seconds.',
      'settings.unsaved': 'Unsaved changes',
      'settings.saving': 'Saving…',
      'settings.save': 'Save settings',
      'settings.discard': 'Discard changes',
      'settings.saveFailed': 'Failed to save settings. Please check credentials and try again.',
      'settings.readOnly': 'Settings are read-only in this context.',
      'settings.overridden': 'overridden',
      'settings.reset': 'Reset to default',
      'settings.invalidNumber': 'Please enter a valid number',
      'settings.collapse': 'Collapse',
      'settings.expand': 'Expand',
      'settings.credentialHint': 'API keys are stored in DSH Credentials (~/.dsh/.credentials.yaml) and never leaked in config files.',

      'tab.general': 'General',
      'tab.provider': 'Provider',
      'tab.enhancer': 'Prompt & Styles',
      'tab.safety': 'Safety & Budget',
      'tab.cache': 'Cache & Storage',

      'stat.active_provider': 'Active Provider',
      'stat.format_size': 'Default Specs',
      'stat.safety_status': 'Safety & Loop Guard',
      'stat.budget_cache': 'Budget & Cache',

      'card.generating': 'Generating image…',
      'card.failed': 'Generation failed',
      'card.image': 'Image Studio Result',
      'card.unknownError': 'An unknown error occurred during generation.',
      'card.sizePrefix': 'Size',
      'card.seedPrefix': 'Seed',
      'card.actionReroll': 'Reroll image',
      'card.actionUpscale': 'Upscale image',
      'card.actionRemoveBg': 'Remove background',
      'card.reroll': 'Reroll',
      'card.upscale': 'Upscale 2x/4x',
      'card.removeBg': 'Remove BG',
      'card.copyPrompt': 'Copy Prompt',
      'card.origPrompt': 'Original Prompt',

      'f.enabled': 'Master Switch',
      'f.enabledHint': 'Enable or disable image generation tools across the workspace.',
      'f.provider': 'Image Provider',
      'f.providerHint': 'Backend service used for image generation.',
      'f.inherit': 'Default / Inherit',
      'f.needFal': 'Requires FAL API key',
      'f.needCustom': 'Requires OpenAI-compatible endpoint',
      'f.needCodex': 'Built-in Codex subscription',
      'f.needGrok': 'Built-in Grok subscription',
      'f.needLocal': 'Local ComfyUI or A1111',
      'f.needSeedream': 'Requires SeaDream API key',
      'f.needGemini': 'Requires Google Gemini API key',
      'f.needReplicate': 'Requires Replicate API token',

      'f.defaultSize': 'Default Aspect Ratio',
      'f.defaultSizeHint': 'Aspect ratio and resolution applied when image_size is omitted.',
      'f.defaultFormat': 'Output Format',
      'f.defaultFormatHint': 'Target file format (PNG, JPEG, or WEBP).',
      'f.deliverAs': 'Delivery Mode',
      'f.deliverAsHint': 'How images reach conversation: "link" (text LLM safe) or "image" (multimodal vision).',
      'f.outputDir': 'Output Directory',
      'f.outputDirHint': 'Directory path where generated images are saved on disk.',
      'p.outputDir': 'generated/images',
      'f.historyLimit': 'History Limit',
      'f.historyLimitHint': 'Maximum number of recent generation records kept in memory.',
      'p.historyLimit': '50',

      'f.model': 'FAL Model ID',
      'f.modelHint': 'Target model on FAL endpoint (e.g. fal-ai/flux-2/klein/9b).',
      'p.model': 'fal-ai/flux-2/klein/9b',
      'f.apiKeyEnv': 'FAL Key Reference',
      'f.apiKeyEnvHint': 'Credential reference holding the FAL API key.',
      'p.apiKeyEnv': 'FAL_API_KEY',
      'f.baseURL': 'FAL Base URL',
      'f.baseURLHint': 'FAL queue service endpoint.',
      'p.baseURL': 'https://queue.fal.run',
      'f.pollIntervalMs': 'Poll Interval (ms)',
      'f.pollIntervalMsHint': 'Frequency of checking task progress on asynchronous queues.',
      'p.pollIntervalMs': '2000',
      'f.timeoutMs': 'Timeout (ms)',
      'f.timeoutMsHint': 'Maximum overall timeout before failing a generation request.',
      'p.timeoutMs': '180000',

      'f.customBaseURL': 'Custom API Base URL',
      'f.customBaseURLHint': 'OpenAI-compatible image endpoint root (e.g. https://api.openai.com/v1).',
      'p.customBaseURL': 'https://api.openai.com/v1',
      'f.customModel': 'Custom Model ID',
      'f.customModelHint': 'Model name sent to custom images endpoint.',
      'p.customModel': 'dall-e-3',
      'f.customKeyEnv': 'Custom Key Reference',
      'f.customKeyEnvHint': 'Credential reference holding the API key for custom endpoint.',
      'p.customKeyEnv': 'OPENAI_API_KEY',
      'f.customSize': 'Custom Image Size',
      'f.customSizeHint': 'Fixed dimension sent to custom endpoint (e.g. 1024x1024).',
      'p.customSize': '1024x1024',

      'f.replicateModel': 'Replicate Model ID',
      'f.replicateModelHint': 'Target model identifier on Replicate.',
      'p.replicateModel': 'black-forest-labs/flux-schnell',
      'f.replicateKeyEnv': 'Replicate Key Reference',
      'f.replicateKeyEnvHint': 'Credential reference holding the Replicate API token.',
      'p.replicateKeyEnv': 'REPLICATE_API_TOKEN',

      'f.seedreamModel': 'SeaDream Model ID',
      'f.seedreamModelHint': 'ByteDance SeaDream model identifier.',
      'p.seedreamModel': 'seedream-4.0',
      'f.seedreamKeyEnv': 'SeaDream Key Reference',
      'f.seedreamKeyEnvHint': 'Credential reference holding the SeaDream API key.',
      'p.seedreamKeyEnv': 'SEEDREAM_API_KEY',
      'f.seedreamBaseURL': 'SeaDream Base URL',
      'f.seedreamBaseURLHint': 'SeaDream API endpoint URL (ByteDance/Volcengine Ark).',
      'p.seedreamBaseURL': 'https://api.bytedanceapi.com/v1',

      'f.geminiModel': 'Gemini Model ID',
      'f.geminiModelHint': 'Google Gemini image generation model identifier.',
      'p.geminiModel': 'gemini-2.0-flash-exp-image-generation',
      'f.geminiKeyEnv': 'Gemini Key Reference',
      'f.geminiKeyEnvHint': 'Credential reference holding Google Gemini API key.',
      'p.geminiKeyEnv': 'GEMINI_API_KEY',

      'f.localKind': 'Local Engine Architecture',
      'f.localKindHint': 'Select between ComfyUI API or Automatic1111 WebUI backend.',
      'f.localBaseURL': 'Local Server URL',
      'f.localBaseURLHint': 'Server address (e.g. http://127.0.0.1:8188 for ComfyUI, http://127.0.0.1:7860 for A1111).',
      'p.localBaseURL': 'http://127.0.0.1:8188',
      'f.localModel': 'Local Model / Checkpoint',
      'f.localModelHint': 'Checkpoint name or ComfyUI workflow name.',
      'p.localModel': 'v1-5-pruned-emaonly.safetensors',
      'f.localSteps': 'Sampling Steps',
      'f.localStepsHint': 'Number of denoising sampling steps.',
      'p.localSteps': '20',
      'f.localCfg': 'CFG Scale',
      'f.localCfgHint': 'Classifier-free guidance scale.',
      'p.localCfg': '7',
      'f.localComfyUrl': 'Local ComfyUI URL (Legacy)',
      'f.localComfyUrlHint': 'Direct ComfyUI endpoint URL.',
      'p.localComfyUrl': 'http://127.0.0.1:8188',
      'f.localA1111Url': 'Local A1111 URL (Legacy)',
      'f.localA1111UrlHint': 'Direct Automatic1111 endpoint URL.',
      'p.localA1111Url': 'http://127.0.0.1:7860',

      'f.subscriptionQuality': 'Subscription Quality',
      'f.subscriptionQualityHint': 'Target quality profile when using Codex or Grok subscriptions.',

      'f.enhancePrompt': 'LLM Prompt Enhancer',
      'f.enhancePromptHint': 'Expand concise prompts with rich artistic details before generation.',
      'f.enableLlmEnhancer': 'Enable LLM Enhancer (Legacy)',
      'f.enableLlmEnhancerHint': 'Legacy toggle for LLM prompt expansion.',
      'f.enhanceModel': 'Enhancement Model',
      'f.enhanceModelHint': 'Dedicated LLM model used to expand prompts (empty = conversation model).',
      'p.enhanceModel': 'Leave empty for default chat model',
      'f.enhanceBelowChars': 'Enhancement Threshold',
      'f.enhanceBelowCharsHint': 'Prompts longer than this character count will skip expansion.',
      'p.enhanceBelowChars': '200',
      'f.stylePreset': 'Artistic Style Preset',
      'f.stylePresetHint': 'Automatic visual style suffix added to all generated prompts.',

      'f.qualityGate': 'Silent Quality Gate',
      'f.qualityGateHint': 'Automatically inspects generated frames and silently re-rolls blank or broken outputs.',
      'f.dailyBudgetUsd': 'Daily Spend Budget ($ USD)',
      'f.dailyBudgetUsdHint': 'Hard spending cap per day across all visual generation tools (0 = no limit).',
      'p.dailyBudgetUsd': '0.00',
      'f.loopGuardLimit': 'Session Loop Guard Limit',
      'f.loopGuardLimitHint': 'Maximum consecutive image generations allowed before requiring user input (0 = off).',
      'p.loopGuardLimit': '3',

      'f.diskCache': 'Content-Addressed Disk Cache',
      'f.diskCacheHint': 'Instant <50ms retrieval and zero API cost for repeated identical generations.',
      'f.cacheBySeed': 'Cache by Seed + Prompt',
      'f.cacheBySeedHint': 'Reuse existing result if the exact same seed and prompt are requested.',
      'f.cacheByPrompt': 'Cache by Prompt Only',
      'f.cacheByPromptHint': 'Reuse existing result if the prompt has already been generated.',
      'f.pruneDays': 'Retention Period (Days)',
      'f.pruneDaysHint': 'Automatically delete image files and cache older than this many days (0 = keep forever).',
      'p.pruneDays': '0',
      'f.cacheTtlDays': 'Cache Retention (Legacy)',
      'f.cacheTtlDaysHint': 'Legacy name for retention period in days.',
      'p.cacheTtlDays': '0',
    }

    const ru = {
      'settings.navLabel': 'Image Studio',
      'settings.title': 'Генерация изображений',
      'settings.description': 'Мультипровайдерная студия: генерация, инпейнтинг, вариации, апскейл и векторизация.',
      'settings.unavailable': 'Настройки плагина инициализируются. Они появятся автоматически через несколько секунд.',
      'settings.unsaved': 'Несохранённые изменения',
      'settings.saving': 'Сохранение…',
      'settings.save': 'Сохранить настройки',
      'settings.discard': 'Сбросить изменения',
      'settings.saveFailed': 'Не удалось сохранить настройки. Проверьте параметры и попробуйте снова.',
      'settings.readOnly': 'Настройки доступны только для чтения.',
      'settings.overridden': 'переопределено',
      'settings.reset': 'Сбросить к умолчанию',
      'settings.invalidNumber': 'Введите корректное число',
      'settings.collapse': 'Свернуть',
      'settings.expand': 'Развернуть',
      'settings.credentialHint': 'Ключи API хранятся в DSH Credentials (~/.dsh/.credentials.yaml) и не попадают в файлы конфигурации.',

      'tab.general': 'Основные',
      'tab.provider': 'Провайдер',
      'tab.enhancer': 'Промпт и стили',
      'tab.safety': 'Безопасность и бюджет',
      'tab.cache': 'Кэш и хранение',

      'stat.active_provider': 'Активный провайдер',
      'stat.format_size': 'Параметры по умолчанию',
      'stat.safety_status': 'Защита и Loop Guard',
      'stat.budget_cache': 'Бюджет и кэширование',

      'card.generating': 'Генерация изображения…',
      'card.failed': 'Ошибка генерации',
      'card.image': 'Результат Image Studio',
      'card.unknownError': 'Неизвестная ошибка во время создания изображения.',
      'card.sizePrefix': 'Размер',
      'card.seedPrefix': 'Сид',
      'card.actionReroll': 'Перегенерировать картинку',
      'card.actionUpscale': 'Увеличить разрешение',
      'card.actionRemoveBg': 'Удалить фон',
      'card.reroll': 'Реролл',
      'card.upscale': 'Апскейл 2x/4x',
      'card.removeBg': 'Без фона',
      'card.copyPrompt': 'Копировать промпт',
      'card.origPrompt': 'Исходный промпт',

      'f.enabled': 'Главный выключатель',
      'f.enabledHint': 'Включение или отключение всех инструментов генерации картинок.',
      'f.provider': 'Провайдер генерации',
      'f.providerHint': 'Сервис, выполняющий непосредственное создание изображений.',
      'f.inherit': 'По умолчанию / наследовать',
      'f.needFal': 'Требуется ключ FAL API',
      'f.needCustom': 'Требуется OpenAI-совместимый эндпоинт',
      'f.needCodex': 'Встроенная подписка Codex',
      'f.needGrok': 'Встроенная подписка Grok',
      'f.needLocal': 'Локальный ComfyUI или Automatic1111',
      'f.needSeedream': 'Требуется ключ SeaDream API',
      'f.needGemini': 'Требуется ключ Google Gemini API',
      'f.needReplicate': 'Требуется токен Replicate API',

      'f.defaultSize': 'Соотношение сторон по умолчанию',
      'f.defaultSizeHint': 'Разрешение и пропорции кадра, когда параметр image_size не передан.',
      'f.defaultFormat': 'Формат файла',
      'f.defaultFormatHint': 'Формат сохранения результатов (PNG, JPEG или WEBP).',
      'f.deliverAs': 'Способ доставки',
      'f.deliverAsHint': 'Способ передачи: "link" (безопасно для текстовых моделей) или "image" (для vision-моделей).',
      'f.outputDir': 'Каталог сохранения',
      'f.outputDirHint': 'Путь к папке сохранения сгенерированных файлов на диске.',
      'p.outputDir': 'generated/images',
      'f.historyLimit': 'Лимит истории',
      'f.historyLimitHint': 'Максимальное число последних генераций, удерживаемых в памяти.',
      'p.historyLimit': '50',

      'f.model': 'Модель FAL',
      'f.modelHint': 'Идентификатор модели на сервисе FAL (например, fal-ai/flux-2/klein/9b).',
      'p.model': 'fal-ai/flux-2/klein/9b',
      'f.apiKeyEnv': 'Ключ FAL (credential-ref)',
      'f.apiKeyEnvHint': 'Ссылка на ключ доступа FAL в хранилище credentials.',
      'p.apiKeyEnv': 'FAL_API_KEY',
      'f.baseURL': 'Базовый URL FAL',
      'f.baseURLHint': 'Адрес сервиса очередей FAL.',
      'p.baseURL': 'https://queue.fal.run',
      'f.pollIntervalMs': 'Интервал опроса (мс)',
      'f.pollIntervalMsHint': 'Периодичность проверки статуса при асинхронной генерации.',
      'p.pollIntervalMs': '2000',
      'f.timeoutMs': 'Таймаут (мс)',
      'f.timeoutMsHint': 'Предельное время ожидания генерации до возврата ошибки.',
      'p.timeoutMs': '180000',

      'f.customBaseURL': 'URL стороннего API',
      'f.customBaseURLHint': 'Адрес OpenAI-совместимого эндпоинта (например, https://api.openai.com/v1).',
      'p.customBaseURL': 'https://api.openai.com/v1',
      'f.customModel': 'Модель стороннего API',
      'f.customModelHint': 'Имя модели для отправки в сторонний API.',
      'p.customModel': 'dall-e-3',
      'f.customKeyEnv': 'Ключ стороннего API',
      'f.customKeyEnvHint': 'Имя ссылки на ключ для стороннего API.',
      'p.customKeyEnv': 'OPENAI_API_KEY',
      'f.customSize': 'Фиксированный размер',
      'f.customSizeHint': 'Точный размер кадра для стороннего API (например, 1024x1024).',
      'p.customSize': '1024x1024',

      'f.replicateModel': 'Модель Replicate',
      'f.replicateModelHint': 'Идентификатор модели на Replicate.',
      'p.replicateModel': 'black-forest-labs/flux-schnell',
      'f.replicateKeyEnv': 'Ключ Replicate',
      'f.replicateKeyEnvHint': 'Имя ссылки на API-токен Replicate.',
      'p.replicateKeyEnv': 'REPLICATE_API_TOKEN',

      'f.seedreamModel': 'Модель SeaDream',
      'f.seedreamModelHint': 'Идентификатор модели ByteDance SeaDream.',
      'p.seedreamModel': 'seedream-4.0',
      'f.seedreamKeyEnv': 'Ключ SeaDream',
      'f.seedreamKeyEnvHint': 'Имя ссылки на ключ API SeaDream.',
      'p.seedreamKeyEnv': 'SEEDREAM_API_KEY',
      'f.seedreamBaseURL': 'Базовый URL SeaDream',
      'f.seedreamBaseURLHint': 'Адрес API SeaDream (ByteDance/Volcengine Ark).',
      'p.seedreamBaseURL': 'https://api.bytedanceapi.com/v1',

      'f.geminiModel': 'Модель Gemini',
      'f.geminiModelHint': 'Идентификатор модели генерации Google Gemini.',
      'p.geminiModel': 'gemini-2.0-flash-exp-image-generation',
      'f.geminiKeyEnv': 'Ключ Gemini',
      'f.geminiKeyEnvHint': 'Имя ссылки на ключ Google Gemini API.',
      'p.geminiKeyEnv': 'GEMINI_API_KEY',

      'f.localKind': 'Тип локального движка',
      'f.localKindHint': 'Выбор между ComfyUI API и Automatic1111 WebUI.',
      'f.localBaseURL': 'Адрес локального сервера',
      'f.localBaseURLHint': 'Адрес локального сервера (ComfyUI: 8188, A1111: 7860).',
      'p.localBaseURL': 'http://127.0.0.1:8188',
      'f.localModel': 'Модель / Чекпоинт',
      'f.localModelHint': 'Имя чекпоинта или воркфлоу ComfyUI.',
      'p.localModel': 'v1-5-pruned-emaonly.safetensors',
      'f.localSteps': 'Шаги сэмплирования',
      'f.localStepsHint': 'Количество шагов генерации.',
      'p.localSteps': '20',
      'f.localCfg': 'Шкала CFG',
      'f.localCfgHint': 'Сила следования промпту.',
      'p.localCfg': '7',
      'f.localComfyUrl': 'Локальный ComfyUI URL (Legacy)',
      'f.localComfyUrlHint': 'Прямой адрес ComfyUI.',
      'p.localComfyUrl': 'http://127.0.0.1:8188',
      'f.localA1111Url': 'Локальный A1111 URL (Legacy)',
      'f.localA1111UrlHint': 'Прямой адрес Automatic1111.',
      'p.localA1111Url': 'http://127.0.0.1:7860',

      'f.subscriptionQuality': 'Качество подписки',
      'f.subscriptionQualityHint': 'Профиль качества для провайдеров Codex и Grok.',

      'f.enhancePrompt': 'LLM-улучшение промпта',
      'f.enhancePromptHint': 'Автоматическое обогащение коротких запросов художественными деталями.',
      'f.enableLlmEnhancer': 'Включить LLM Enhancer (Legacy)',
      'f.enableLlmEnhancerHint': 'Устаревший переключатель улучшения промптов.',
      'f.enhanceModel': 'Модель улучшения',
      'f.enhanceModelHint': 'Модель для расширения промптов (пусто = основная модель чата).',
      'p.enhanceModel': 'Пусто для основной модели чата',
      'f.enhanceBelowChars': 'Порог длины промпта',
      'f.enhanceBelowCharsHint': 'Промпты длиннее этого количества символов не расширяются.',
      'p.enhanceBelowChars': '200',
      'f.stylePreset': 'Художественный стиль',
      'f.stylePresetHint': 'Автоматический суффикс стиля для всех создаваемых изображений.',

      'f.qualityGate': 'Контроль качества (Quality Gate)',
      'f.qualityGateHint': 'Автоматическая проверка кадров и скрытый реролл при дефектах или пустом кадре.',
      'f.dailyBudgetUsd': 'Дневной бюджет ($ USD)',
      'f.dailyBudgetUsdHint': 'Предельный лимит затрат в сутки по всем графическим инструментам (0 = без лимита).',
      'p.dailyBudgetUsd': '0.00',
      'f.loopGuardLimit': 'Защита от циклов (Loop Guard)',
      'f.loopGuardLimitHint': 'Максимум последовательных генераций подряд без участия пользователя (0 = выкл).',
      'p.loopGuardLimit': '3',

      'f.diskCache': 'Дисковый кэш по хэшу',
      'f.diskCacheHint': 'Мгновенная выдача (<50 мс) и нулевая стоимость для повторных идентичных генераций.',
      'f.cacheBySeed': 'Кэш по сиду и промпту',
      'f.cacheBySeedHint': 'Возвращать кэш при полном совпадении сида и текста промпта.',
      'f.cacheByPrompt': 'Кэш по тексту промпта',
      'f.cacheByPromptHint': 'Возвращать кэш при повторении того же текста промпта.',
      'f.pruneDays': 'Срок хранения файлов (дни)',
      'f.pruneDaysHint': 'Автоматическое удаление файлов и записей старше указанного числа дней (0 = бессрочно).',
      'p.pruneDays': '0',
      'f.cacheTtlDays': 'Срок хранения кэша (Legacy)',
      'f.cacheTtlDaysHint': 'Устаревшее имя параметра срока хранения.',
      'p.cacheTtlDays': '0',
    }

    // -------------------------------------------------------------- Registration & Apply
    const inject = ['slots', 'settingsScope', 'locale', 'sessions']

    function apply(ctx) {
      if (ctx.locale && typeof ctx.locale.define === 'function') {
        ctx.locale.define('en', NS, en)
        ctx.locale.define('ru', NS, ru)
      }

      let card
      const cardOnce = () => {
        if (card === undefined) {
          const scope = ((ctx.get && ctx.get('lanSettings')) || ctx.settingsScope).bind({ namespace: SETTINGS_NS })
          card = new FalSettingsCardController(scope)
        }
        return card
      }

      function registerSlotWhenReady(slotName, registerFn) {
        if (!ctx.slots) return
        if (typeof ctx.slots.inject === 'function') {
          try {
            ctx.slots.inject(slotName, () => {
              try {
                return registerFn()
              } catch (err) {
                console.warn('[dsh-image-gen] Error registering slot ' + slotName + ':', err)
              }
            })
            return
          } catch (err) {
            console.warn('[dsh-image-gen] Failed to inject slot ' + slotName + ':', err)
          }
        }
        if (typeof ctx.slots.register === 'function') {
          try {
            registerFn()
          } catch (err) {
            console.warn('[dsh-image-gen] Failed direct registration for ' + slotName + ':', err)
          }
        }
      }

      // Register toolviews for all 8 visual tools
      const toolviewTools = [
        'generate_image',
        'edit_image',
        'vary_image',
        'blend_images',
        'generate_image_pack',
        'remove_background',
        'upscale_image',
        'vectorize_image',
      ]

      for (const toolName of toolviewTools) {
        registerSlotWhenReady('tool.call.toolview', () =>
          ctx.slots.register(
            {
              name: 'tool.call.toolview',
              key: toolName,
              locale: NS,
              inject: () => ({ sessions: ctx.sessions }),
            },
            (props) => react.createElement(ErrorBoundary, null, react.createElement(FalImageCard, props))
          )
        )
      }

      // Settings card item
      registerSlotWhenReady('settings.plugin.item', () =>
        ctx.slots.register(
          {
            name: 'settings.plugin.item',
            key: SETTINGS_NS,
            locale: NS,
            inject: () => cardOnce().inject(),
          },
          (props) => react.createElement(ErrorBoundary, null, react.createElement(FalSettingsCard, props))
        )
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
