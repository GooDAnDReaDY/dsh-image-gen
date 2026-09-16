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
      { field: 'autoEnhancePrompt', spec: booleanField('autoEnhancePrompt'), kind: 'select', options: ['true', 'false'], labelKey: 'f.autoEnhancePrompt', hintKey: 'f.autoEnhancePromptHint', tab: 'enhancer' },
      { field: 'defaultStylePreset', spec: selectField('defaultStylePreset', STYLE_PRESET_OPTIONS), kind: 'select', options: STYLE_PRESET_OPTIONS, labelKey: 'f.defaultStylePreset', hintKey: 'f.defaultStylePresetHint', tab: 'enhancer' },
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
        if (runtime && typeof runtime.createSnapshotStore === 'function') {
          const store = runtime.createSnapshotStore(project())
          this.listeners.add(() => store.set(project()))
          return store
        }
        let cached = project()
        const storeListeners = new Set()
        this.listeners.add(() => {
          cached = project()
          for (const listener of storeListeners) listener()
        })
        return {
          getSnapshot: () => cached,
          subscribe: (cb) => {
            storeListeners.add(cb)
            return () => storeListeners.delete(cb)
          },
        }
      }
      shell() {
        const snapshot = (this.scope && this.scope.getSnapshot && this.scope.getSnapshot()) || { status: 'unavailable', writable: false }
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

