// dsh-fal-image-gen — browser (client) half.
//
// Renders a configuration card inside Web GUI 设置 → 插件 → 插件配置,
// editing the `dsh-fal-image-gen` dsh-settings namespace that the Host
// plugin registers. The card is a hand-written ModuleLoader module: it
// depends only on services the official client runtime provides (`slots`,
// `settingsScope`, `locale`, `react`), so it ships inside this npm package
// with no build step. The card chrome mirrors the official plugin-card
// chrome in a self-contained slice.

window.__ModuleLoader__.load({
  id: '@goodandready/dsh-fal-image-gen',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let react = require('react')
    let react_jsx_runtime = require('react/jsx-runtime')
    let runtime = require('@deepseek-ai/dsh-client-runtime/client')

    // ---------------------------------------------------------------- css
    const css =
      '.fal_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:8px;list-style:none;transition:border-color .16s,background .16s;overflow:hidden}' +
      '.fal_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}' +
      '.fal_header{cursor:pointer;text-align:left;width:100%;font:inherit;background:0 0;border:0;align-items:center;gap:8px;padding:10px 14px;display:flex}' +
      '.fal_header:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
      '.fal_headText{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}' +
      '.fal_name{color:var(--dsw-alias-label-primary);font-weight:600}' +
      '.fal_description{color:var(--dsw-alias-label-tertiary);font-size:12px}' +
      '.fal_pending{color:var(--dsw-alias-state-warn-primary);font-size:12px}' +
      '.fal_chevron{color:var(--dsw-alias-label-tertiary);transition:transform .12s}' +
      '.fal_chevronOpen{transform:rotate(180deg)}' +
      '.fal_body{flex-direction:column;gap:12px;padding:0 14px 14px;display:flex}' +
      '.fal_readOnly{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}' +
      '.fal_footer{justify-content:flex-end;align-items:center;gap:8px;display:flex}' +
      '.fal_failed{color:var(--dsw-alias-state-error-primary);margin:0 auto 0 0;font-size:12px}' +
      '.fal_discard,.fal_save{font:inherit;cursor:pointer;border-radius:6px;padding:5px 12px;font-size:13px}' +
      '.fal_discard{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}' +
      '.fal_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}' +
      '.fal_save{border:1px solid var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground)}' +
      '.fal_save:hover:not(:disabled){border-color:var(--dsw-alias-button-info-hover);background:var(--dsw-alias-button-info-hover)}' +
      '.fal_discard:active:not(:disabled),.fal_save:active:not(:disabled){transform:translateY(1px)}' +
      '.fal_discard:focus-visible:not(:disabled),.fal_save:focus-visible:not(:disabled){outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}' +
      '.fal_discard:disabled,.fal_save:disabled{opacity:.5;cursor:default}' +
      '.fal_field{flex-direction:column;gap:4px;display:flex}' +
      '.fal_head{align-items:center;gap:8px;display:flex}' +
      '.fal_label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}' +
      '.fal_badges{align-items:center;gap:6px;display:flex}' +
      '.fal_badge{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-state-business-primary);border-radius:999px;padding:1px 6px;font-size:11px}' +
      '.fal_reset{color:var(--dsw-alias-state-business-primary);cursor:pointer;background:0 0;border:0;padding:0;font-size:11px}' +
      '.fal_reset:hover:not(:disabled){text-decoration:underline}' +
      '.fal_reset:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}' +
      '.fal_input,.fal_select{border:1px solid var(--dsw-alias-border-l2);font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:6px;padding:6px 8px;font-size:13px;min-height:32px}' +
      '.fal_inputInvalid{border:1px solid var(--dsw-alias-state-error-primary);font:inherit;color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 8px;font-size:13px}' +
      '.fal_input:disabled,.fal_select:disabled{opacity:.6}' +
      '.fal_hint{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px}' +
      '.fal_invalid{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px}' +
      '.fal_sep{height:1px;background:var(--dsw-alias-border-l2);margin:2px 0 0}'
    const tagId = 'dsh-fal-image-gen/settings-card.module.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-fal-image-gen'
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }
    const cssDefault = {
      badge: 'fal_badge',
      badges: 'fal_badges',
      body: 'fal_body',
      card: 'fal_card',
      cardOpen: 'fal_cardOpen',
      chevron: 'fal_chevron',
      chevronOpen: 'fal_chevronOpen',
      description: 'fal_description',
      discard: 'fal_discard',
      failed: 'fal_failed',
      field: 'fal_field',
      footer: 'fal_footer',
      head: 'fal_head',
      header: 'fal_header',
      headText: 'fal_headText',
      hint: 'fal_hint',
      input: 'fal_input',
      inputInvalid: 'fal_inputInvalid',
      invalid: 'fal_invalid',
      label: 'fal_label',
      name: 'fal_name',
      pending: 'fal_pending',
      readOnly: 'fal_readOnly',
      reset: 'fal_reset',
      save: 'fal_save',
      select: 'fal_select',
      sep: 'fal_sep',
    }

    // -------------------------------------------------------------- chrome
    /** Shared card chrome: disclosure header, controls, save/discard footer. */
    function PluginSettingsCard(props) {
      const [open, setOpen] = react.useState(false)
      const { state } = props
      if (!state.available) return null
      const title = props.t(props.titleKey)
      const blocked = !state.dirty || state.invalid || state.saving
      return react_jsx_runtime.jsxs('li', {
        className: cssDefault.card + (open ? ' ' + cssDefault.cardOpen : ''),
        children: [
          react_jsx_runtime.jsxs('button', {
            type: 'button',
            className: cssDefault.header,
            'aria-expanded': open,
            'aria-label': `${props.t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`,
            onClick: () => setOpen(!open),
            children: [
              react_jsx_runtime.jsxs('span', {
                className: cssDefault.headText,
                children: [
                  react_jsx_runtime.jsx('span', { className: cssDefault.name, children: title }),
                  react_jsx_runtime.jsx('span', { className: cssDefault.description, children: props.t(props.descriptionKey) }),
                ],
              }),
              state.dirty ? react_jsx_runtime.jsx('span', { className: cssDefault.pending, children: props.t('settings.unsaved') }) : null,
              react_jsx_runtime.jsx('span', { className: cssDefault.chevron + (open ? ' ' + cssDefault.chevronOpen : ''), children: '\u25be' }),
            ],
          }),
          open
            ? react_jsx_runtime.jsxs('div', {
                className: cssDefault.body,
                children: [
                  !state.writable ? react_jsx_runtime.jsx('p', { className: cssDefault.readOnly, role: 'status', children: props.t('settings.readOnly') }) : null,
                  props.children,
                  react_jsx_runtime.jsxs('div', {
                    className: cssDefault.footer,
                    children: [
                      state.failed ? react_jsx_runtime.jsx('p', { className: cssDefault.failed, role: 'status', children: props.t('settings.saveFailed') }) : null,
                      react_jsx_runtime.jsx('button', {
                        type: 'button',
                        className: cssDefault.discard,
                        disabled: !state.dirty || state.saving,
                        onClick: props.onDiscard,
                        children: props.t('settings.discard'),
                      }),
                      react_jsx_runtime.jsx('button', {
                        type: 'button',
                        className: cssDefault.save,
                        disabled: blocked,
                        onClick: props.onSave,
                        children: props.t(state.saving ? 'settings.saving' : 'settings.save'),
                      }),
                    ],
                  }),
                ],
              })
            : null,
        ],
      })
    }

    /** A plain text (or numeric) value field. */
    function ValueField(props) {
      return react_jsx_runtime.jsxs('div', {
        className: cssDefault.field,
        children: [
          react_jsx_runtime.jsxs('div', {
            className: cssDefault.head,
            children: [
              react_jsx_runtime.jsx('label', { className: cssDefault.label, htmlFor: props.id, children: props.label }),
              props.overridden
                ? react_jsx_runtime.jsxs('span', {
                    className: cssDefault.badges,
                    children: [
                      react_jsx_runtime.jsx('span', { className: cssDefault.badge, children: props.overriddenLabel }),
                      react_jsx_runtime.jsx('button', { type: 'button', className: cssDefault.reset, disabled: props.disabled, onClick: props.onReset, children: props.resetLabel }),
                    ],
                  })
                : null,
            ],
          }),
          react_jsx_runtime.jsx('input', {
            id: props.id,
            className: props.invalid ? cssDefault.inputInvalid : cssDefault.input,
            type: 'text',
            ...(props.numeric === true ? { inputMode: 'numeric' } : {}),
            ...(props.invalid ? { 'aria-invalid': true } : {}),
            value: props.text,
            placeholder: props.placeholder ?? '',
            disabled: props.disabled,
            onChange: (event) => props.onEdit(event.target.value),
          }),
          react_jsx_runtime.jsx('p', { className: props.invalid ? cssDefault.invalid : cssDefault.hint, children: props.invalid ? props.invalidLabel : props.hint }),
        ],
      })
    }

    /** A select field (enum values; empty = inherit the default). */
    function SelectField(props) {
      return react_jsx_runtime.jsxs('div', {
        className: cssDefault.field,
        children: [
          react_jsx_runtime.jsxs('div', {
            className: cssDefault.head,
            children: [
              react_jsx_runtime.jsx('label', { className: cssDefault.label, htmlFor: props.id, children: props.label }),
              props.overridden
                ? react_jsx_runtime.jsxs('span', {
                    className: cssDefault.badges,
                    children: [
                      react_jsx_runtime.jsx('span', { className: cssDefault.badge, children: props.overriddenLabel }),
                      react_jsx_runtime.jsx('button', { type: 'button', className: cssDefault.reset, disabled: props.disabled, onClick: props.onReset, children: props.resetLabel }),
                    ],
                  })
                : null,
            ],
          }),
          react_jsx_runtime.jsxs('select', {
            id: props.id,
            className: cssDefault.select,
            value: props.text,
            disabled: props.disabled,
            onChange: (event) => props.onEdit(event.target.value),
            children: [
              react_jsx_runtime.jsx('option', { value: '', children: props.inheritLabel }),
              props.options.map((option) => react_jsx_runtime.jsx('option', { value: option, children: option }, option)),
            ],
          }),
          react_jsx_runtime.jsx('p', { className: cssDefault.hint, children: props.hint }),
        ],
      })
    }

    // --------------------------------------------------------------- form
    /** A staged text value (empty text clears the override). */
    function textField(field) {
      return {
        field,
        format: (value) => (typeof value === 'string' ? value : ''),
        parse: (text) => (text === '' ? { kind: 'clear' } : { kind: 'set', value: text }),
      }
    }

    /** A staged numeric value. */
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

    /** A staged enum value (empty text clears the override). */
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

    /**
     * Stages one card's edits over one settings namespace and writes them on
     * save. The Host is the only authority on whether a value was accepted, so
     * the outcome is read back from the section rather than predicted here.
     */
    var CardForm = class {
      constructor(scope, specs) {
        this.scope = scope
        this.specs = new Map(specs.map((spec) => [spec.field, spec]))
        this.staged = new Map()
        this.listeners = new Set()
        this.saving = false
        this.failed = false
        scope.subscribe(() => this.publish())
      }
      bind(project) {
        const store = runtime.createSnapshotStore(project())
        this.listeners.add(() => store.set(project()))
        return store
      }
      shell() {
        const snapshot = this.scope.getSnapshot()
        const plan = this.plan()
        return {
          available: snapshot.status === 'ready',
          writable: snapshot.writable,
          dirty: plan.length > 0,
          invalid: plan.some((item) => item.run === void 0),
          saving: this.saving,
          failed: this.failed,
        }
      }
      field(field) {
        const spec = this.specOf(field)
        const staged = this.staged.get(field)
        const snapshot = this.scope.getSnapshot()
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
        this.saving = false
        this.failed = !landed
        this.publish()
      }
      plan() {
        const plan = []
        for (const [field, staged] of this.staged) {
          const spec = this.specOf(field)
          if (staged.clear) {
            if (this.stored(field)) plan.push({ field, run: () => this.clear(field) })
            continue
          }
          if (staged.text === spec.format(this.sectionValue(field))) continue
          const write = spec.parse(staged.text)
          if (write === void 0) plan.push({ field, run: void 0 })
          else if (write.kind === 'clear') plan.push({ field, run: () => this.clear(field) })
          else plan.push({ field, run: () => this.store(field, write.value) })
        }
        return plan
      }
      async clear(field) {
        await this.scope.unset(field)
        return !this.stored(field)
      }
      async store(field, value) {
        await this.scope.set(field, value)
        return this.userLayer()?.[field] === value
      }
      stage(field, edit) {
        this.staged.set(field, edit)
        this.failed = false
        this.publish()
      }
      specOf(field) {
        const spec = this.specs.get(field)
        if (spec === void 0) throw new Error('settings card has no field ' + field)
        return spec
      }
      snapshotOf() {
        return this.scope.getSnapshot()
      }
      sectionValue(field) {
        return this.snapshotOf().value?.[field]
      }
      baseValue(field) {
        return this.snapshotOf().base?.[field]
      }
      userLayer() {
        return this.snapshotOf().user
      }
      stored(field) {
        const user = this.userLayer()
        return user !== void 0 && Object.hasOwn(user, field)
      }
      publish() {
        for (const listener of this.listeners) listener()
      }
    }

    // ------------------------------------------------------------- fields
    const IMAGE_SIZES = ['square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9']
    const OUTPUT_FORMATS = ['png', 'jpeg', 'webp']
    const DELIVERY_MODES = ['link', 'image']
    const PROVIDERS = ['fal', 'custom']

    /** Field specs in display order. */
    const FIELDS = [
      { field: 'provider', spec: selectField('provider', PROVIDERS), kind: 'select', options: PROVIDERS, labelKey: 'f.provider', hintKey: 'f.providerHint' },
      { field: 'model', spec: textField('model'), kind: 'text', labelKey: 'f.model', hintKey: 'f.modelHint', placeholderKey: 'p.model' },
      { field: 'apiKeyEnv', spec: textField('apiKeyEnv'), kind: 'text', labelKey: 'f.apiKeyEnv', hintKey: 'f.apiKeyEnvHint', placeholderKey: 'p.apiKeyEnv' },
      { field: 'baseURL', spec: textField('baseURL'), kind: 'text', labelKey: 'f.baseURL', hintKey: 'f.baseURLHint', placeholderKey: 'p.baseURL' },
      { field: 'defaultSize', spec: selectField('defaultSize', IMAGE_SIZES), kind: 'select', options: IMAGE_SIZES, labelKey: 'f.defaultSize', hintKey: 'f.defaultSizeHint' },
      { field: 'defaultFormat', spec: selectField('defaultFormat', OUTPUT_FORMATS), kind: 'select', options: OUTPUT_FORMATS, labelKey: 'f.defaultFormat', hintKey: 'f.defaultFormatHint' },
      { field: 'pollIntervalMs', spec: numberField('pollIntervalMs'), kind: 'number', labelKey: 'f.pollIntervalMs', hintKey: 'f.pollIntervalMsHint', placeholderKey: 'p.pollIntervalMs' },
      { field: 'timeoutMs', spec: numberField('timeoutMs'), kind: 'number', labelKey: 'f.timeoutMs', hintKey: 'f.timeoutMsHint', placeholderKey: 'p.timeoutMs' },
      { field: 'deliverAs', spec: selectField('deliverAs', DELIVERY_MODES), kind: 'select', options: DELIVERY_MODES, labelKey: 'f.deliverAs', hintKey: 'f.deliverAsHint' },
      { field: 'customBaseURL', spec: textField('customBaseURL'), kind: 'text', labelKey: 'f.customBaseURL', hintKey: 'f.customBaseURLHint', placeholderKey: 'p.customBaseURL' },
      { field: 'customModel', spec: textField('customModel'), kind: 'text', labelKey: 'f.customModel', hintKey: 'f.customModelHint', placeholderKey: 'p.customModel' },
      { field: 'customKeyEnv', spec: textField('customKeyEnv'), kind: 'text', labelKey: 'f.customKeyEnv', hintKey: 'f.customKeyEnvHint', placeholderKey: 'p.customKeyEnv' },
      { field: 'customSize', spec: textField('customSize'), kind: 'text', labelKey: 'f.customSize', hintKey: 'f.customSizeHint', placeholderKey: 'p.customSize' },
      { field: 'outputDir', spec: textField('outputDir'), kind: 'text', labelKey: 'f.outputDir', hintKey: 'f.outputDirHint', placeholderKey: 'p.outputDir' },
    ]

    function Field(props) {
      const { entry, state, fieldProps, t, onEdit, onReset } = props
      const base = {
        id: 'dsh-fal-image-gen-' + entry.field,
        label: t(entry.labelKey),
        hint: t(entry.hintKey),
        overriddenLabel: fieldProps.overriddenLabel,
        resetLabel: fieldProps.resetLabel,
        invalidLabel: fieldProps.invalidLabel,
        disabled: fieldProps.disabled,
        text: state.text,
        overridden: state.overridden,
        invalid: state.invalid,
        onEdit,
        onReset,
      }
      if (entry.kind === 'select') {
        return react_jsx_runtime.jsx(SelectField, { ...base, options: entry.options, inheritLabel: t('f.inherit') })
      }
      return react_jsx_runtime.jsx(ValueField, { ...base, numeric: entry.kind === 'number', placeholder: entry.placeholderKey ? t(entry.placeholderKey) : '' })
    }

    /** Render the plugin settings card. */
    function FalSettingsCard(props) {
      const { t } = props
      const state = props.useFalSettingsCard((snapshot) => snapshot)
      const disabled = !state.writable
      const fieldProps = {
        overriddenLabel: t('settings.overridden'),
        resetLabel: t('settings.reset'),
        invalidLabel: t('settings.invalidNumber'),
        disabled,
      }
      return react_jsx_runtime.jsx(PluginSettingsCard, {
        t,
        titleKey: 'settings.title',
        descriptionKey: 'settings.description',
        state,
        onSave: props.save,
        onDiscard: props.discard,
        children: [
          react_jsx_runtime.jsx('p', { className: cssDefault.hint, children: t('settings.credentialHint') }),
          FIELDS.map((entry) =>
            react_jsx_runtime.jsx(
              Field,
              {
                entry,
                state: state[entry.field] ?? { text: '', overridden: false, invalid: false },
                fieldProps,
                t,
                onEdit: (text) => props.edit(entry.field, text),
                onReset: () => props.resetField(entry.field),
              },
              entry.field,
            ),
          ),
        ],
      })
    }

    /** Bridges the `dsh-fal-image-gen` scope onto the card's staged form. */
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

    // -------------------------------------------------------------- apply
    const NS = 'dsh-fal-image-gen'
    /** Settings namespace the card edits (the Host plugin registers it). */
    const SETTINGS_NS = 'dsh-fal-image-gen'
    /** Required client services. */
    const inject = ['slots', 'settingsScope', 'locale']

    const en = {
      'settings.title': 'Image generation (dsh-fal-image-gen)',
      'settings.description': 'generate_image tool. Provider: the FAL queue, or any OpenAI-compatible images API.',
      'settings.credentialHint': 'API keys live in Credentials under the references set below (Settings → Credentials).',
      'settings.expand': 'Expand',
      'settings.collapse': 'Collapse',
      'settings.unsaved': 'Unsaved changes',
      'settings.readOnly': 'This deployment is read-only: settings cannot be changed from the GUI.',
      'settings.overridden': 'Override',
      'settings.reset': 'Reset',
      'settings.invalidNumber': 'Enter a valid number',
      'settings.discard': 'Discard',
      'settings.save': 'Save',
      'settings.saving': 'Saving…',
      'settings.saveFailed': 'Save failed',
      'f.inherit': 'Inherit (default)',
      'f.provider': 'Provider',
      'f.providerHint': 'fal — the FAL queue configured below. custom — any OpenAI-compatible API, configured further down.',
      'f.model': 'Model (FAL)',
      'f.modelHint': 'FAL model id, called as {baseURL}/{model}. Used when provider is fal.',
      'f.apiKeyEnv': 'API key reference',
      'f.apiKeyEnvHint': 'Credential reference / env var holding the FAL API key. The "Key " auth prefix is added automatically.',
      'f.baseURL': 'Queue base URL',
      'f.baseURLHint': 'FAL queue base URL (queue.fal.run).',
      'f.defaultSize': 'Default image size',
      'f.defaultSizeHint': 'Used when the tool call omits image_size.',
      'f.defaultFormat': 'Default format',
      'f.defaultFormatHint': 'Used when the tool call omits output_format.',
      'f.pollIntervalMs': 'Poll interval (ms)',
      'f.pollIntervalMsHint': 'Status polling interval while a job runs.',
      'f.timeoutMs': 'Timeout (ms)',
      'f.timeoutMsHint': 'Total generation timeout: submit + poll + download.',
      'f.deliverAs': 'How the image reaches the chat',
      'f.deliverAsHint': 'link — the result is text with a link and the card renders the picture from it; works with any chat model. image — the result carries the picture itself, which a text-only chat model cannot read, so this needs dsh-vision-bridge or a vision-capable model.',
      'f.customBaseURL': 'Custom API: base URL',
      'f.customBaseURLHint': 'API root without a trailing slash. The request goes to {base}/images/generations.',
      'f.customModel': 'Custom API: model',
      'f.customModelHint': 'Model id sent to that API, e.g. gpt-image-1.',
      'f.customKeyEnv': 'Custom API: key reference',
      'f.customKeyEnvHint': 'Credential reference / env var with the API key. Empty means no authorization header, for gateways that need none.',
      'f.customSize': 'Custom API: fixed size',
      'f.customSizeHint': 'Leave empty and the named size is translated automatically (square_hd → 1024x1024). Set it only for an API picky about sizes.',
      'f.outputDir': 'Output directory',
      'f.outputDirHint': 'Relative to the session working directory; an absolute path is used as given.',
      'p.model': 'Example: fal-ai/flux-2/klein/9b',
      'p.apiKeyEnv': 'Example: FAL_API_KEY',
      'p.baseURL': 'Example: https://queue.fal.run',
      'p.pollIntervalMs': 'Example: 2000',
      'p.timeoutMs': 'Example: 180000',
      'p.customBaseURL': 'Example: https://api.openai.com/v1',
      'p.customModel': 'Example: gpt-image-1',
      'p.customKeyEnv': 'Example: OPENAI_API_KEY',
      'p.customSize': 'Example: 1024x1024',
      'p.outputDir': 'Example: generated/images',
    }

    const ru = {
      'settings.title': 'Генерация изображений (dsh-fal-image-gen)',
      'settings.description': 'Инструмент generate_image. Провайдер: очередь FAL или любой OpenAI-совместимый API картинок.',
      'settings.credentialHint': 'Ключи API хранятся в Credentials под указанными ссылками (Настройки → Credentials).',
      'settings.expand': 'Развернуть',
      'settings.collapse': 'Свернуть',
      'settings.unsaved': 'Есть несохранённые изменения',
      'settings.readOnly': 'Этот деплой read-only: настройки нельзя менять из GUI.',
      'settings.overridden': 'Переопределено',
      'settings.reset': 'Сбросить',
      'settings.invalidNumber': 'Введите корректное число',
      'settings.discard': 'Отменить',
      'settings.save': 'Сохранить',
      'settings.saving': 'Сохранение…',
      'settings.saveFailed': 'Не удалось сохранить',
      'f.inherit': 'Унаследовать (по умолчанию)',
      'f.provider': 'Провайдер',
      'f.providerHint': 'fal — очередь FAL, настроенная ниже. custom — любой OpenAI-совместимый API, настраивается дальше.',
      'f.model': 'Модель (FAL)',
      'f.modelHint': 'ID модели FAL, вызывается как {baseURL}/{model}. Используется при провайдере fal.',
      'f.apiKeyEnv': 'Ссылка на ключ API',
      'f.apiKeyEnvHint': 'Имя credential-ссылки / переменной окружения с ключом FAL. Префикс "Key " добавляется автоматически.',
      'f.baseURL': 'Базовый URL очереди',
      'f.baseURLHint': 'Базовый URL FAL queue (queue.fal.run).',
      'f.defaultSize': 'Размер по умолчанию',
      'f.defaultSizeHint': 'Используется, когда вызов инструмента не указывает image_size.',
      'f.defaultFormat': 'Формат по умолчанию',
      'f.defaultFormatHint': 'Используется, когда вызов инструмента не указывает output_format.',
      'f.pollIntervalMs': 'Интервал опроса (мс)',
      'f.pollIntervalMsHint': 'Интервал опроса статуса задания.',
      'f.timeoutMs': 'Таймаут (мс)',
      'f.timeoutMsHint': 'Общий таймаут генерации: submit + poll + download.',
      'f.deliverAs': 'Как картинка попадает в чат',
      'f.deliverAsHint': 'link — в результате текст со ссылкой, карточка рисует картинку по ней; работает с любой чат-моделью. image — в результате сама картинка, текстовая модель её прочитать не может, поэтому нужен dsh-vision-bridge или модель с vision.',
      'f.customBaseURL': 'Свой API: базовый URL',
      'f.customBaseURLHint': 'Корень API без завершающего слэша. Запрос уходит на {base}/images/generations.',
      'f.customModel': 'Свой API: модель',
      'f.customModelHint': 'ID модели для этого API, например gpt-image-1.',
      'f.customKeyEnv': 'Свой API: ссылка на ключ',
      'f.customKeyEnvHint': 'Имя credential-ссылки / переменной окружения с ключом. Пусто — без заголовка авторизации, для шлюзов, которым он не нужен.',
      'f.customSize': 'Свой API: фиксированный размер',
      'f.customSizeHint': 'Пусто — именованный размер переводится сам (square_hd → 1024x1024). Заполняйте только для API, придирчивого к размерам.',
      'f.outputDir': 'Папка вывода',
      'f.outputDirHint': 'Относительно рабочей папки сессии; абсолютный путь используется как есть.',
      'p.model': 'Пример: fal-ai/flux-2/klein/9b',
      'p.apiKeyEnv': 'Пример: FAL_API_KEY',
      'p.baseURL': 'Пример: https://queue.fal.run',
      'p.pollIntervalMs': 'Пример: 2000',
      'p.timeoutMs': 'Пример: 180000',
      'p.customBaseURL': 'Пример: https://api.openai.com/v1',
      'p.customModel': 'Пример: gpt-image-1',
      'p.customKeyEnv': 'Пример: OPENAI_API_KEY',
      'p.customSize': 'Пример: 1024x1024',
      'p.outputDir': 'Пример: generated/images',
    }

    // ── карточка результата generate_image ────────────────────────────────
    //
    // Карточки инструментов не рисуют image-блоки (это умеют только сообщения
    // ассистента), поэтому сгенерированная картинка показывается здесь —
    // keyed-запись слота tool.call.toolview по имени инструмента.
    const CARD_CSS = '.fal-card{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);max-width:520px}'
      + '.fal-card .fal-head{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}'
      + '.fal-card img{max-width:100%;border-radius:8px;display:block}'
      + '.fal-card .fal-prompt{font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}'
      + '.fal-card .fal-meta{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}'
      + '.fal-card .fal-err{font-size:12px;color:var(--dsw-alias-state-error-primary)}'
    const CARD_CSS_ID = 'dsh-fal-image-gen/tool-card.module.css'
    if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="' + CARD_CSS_ID + '"]')) {
      const tag = document.createElement('style')
      tag.textContent = CARD_CSS
      tag.setAttribute('data-plugin', 'dsh-fal-image-gen')
      tag.dataset.pluginCss = CARD_CSS_ID
      document.head.appendChild(tag)
    }

    /**
     * Вытащить из результата всё, чем можно показать картинку.
     *
     * В режиме «image» она приходит блоком вложения. В режиме «link» результат
     * намеренно только текстовый — иначе чат-модель без vision на нём падает —
     * и ссылка на наш же роут разбирается отсюда.
     */
    const IMAGE_URL_RE = /\/dsh-fal-image-gen\/image\?[^\s)]+/

    function readResult(block) {
      const content = block && Array.isArray(block.content) ? block.content : []
      let attachment
      let text = ''
      for (const part of content) {
        if (part && part.type === 'image' && part.attachment) {
          attachment = part.attachment
        } else if (part && part.type === 'text' && typeof part.text === 'string') {
          text += (text ? String.fromCharCode(10) : '') + part.text
        }
      }
      const linked = text.match(IMAGE_URL_RE)
      return {
        attachment: attachment,
        url: linked ? linked[0] : '',
        // Ссылку из подписи убираем: она уже стала картинкой.
        text: linked ? text.replace(linked[0], '').trim() : text,
      }
    }

    function FalImageCard(props) {
      const block = props.block
      const running = !('kind' in (block || {}))
      const failed = block && (block.isError || block.error !== undefined)
      const parsed = readResult(block)
      let prompt = ''
      try {
        const raw = (block && (block.call ? block.call.argsRaw : block.argsRaw)) || ''
        prompt = raw ? (JSON.parse(raw).prompt || '') : ''
      } catch (e) { prompt = '' }

      const head = react.createElement('div', { className: 'fal-head' },
        running ? 'Генерирую изображение…' : failed ? 'Генерация не удалась' : 'Изображение')

      const body = []
      if (prompt) body.push(react.createElement('div', { className: 'fal-prompt', key: 'p' }, prompt))
      if (failed) {
        body.push(react.createElement('div', { className: 'fal-err', key: 'e' }, parsed.text || 'неизвестная ошибка'))
      } else if (!parsed.attachment && parsed.url) {
        body.push(react.createElement('img', {
          key: 'i',
          src: parsed.url,
          alt: prompt || 'generated image',
          loading: 'lazy',
        }))
        if (parsed.text) body.push(react.createElement('div', { className: 'fal-meta', key: 'm' }, parsed.text))
      } else if (parsed.attachment) {
        // The attachment store verifies the whole reference, so the card hands
        // back the metadata the tool result already carries.
        const a = parsed.attachment
        const query = 'id=' + encodeURIComponent(a.attachmentId ?? a.id ?? '')
          + '&mt=' + encodeURIComponent(a.mediaType || 'image/png')
          + '&b=' + encodeURIComponent(String(a.bytes ?? 0))
          + '&w=' + encodeURIComponent(String(a.width ?? 0))
          + '&h=' + encodeURIComponent(String(a.height ?? 0))
        body.push(react.createElement('img', {
          key: 'i',
          src: '/dsh-fal-image-gen/image?' + query,
          alt: prompt || 'generated image',
          loading: 'lazy',
        }))
        if (parsed.text) body.push(react.createElement('div', { className: 'fal-meta', key: 'm' }, parsed.text))
      } else if (!running && parsed.text) {
        body.push(react.createElement('div', { className: 'fal-meta', key: 'm' }, parsed.text))
      }

      return react.createElement('div', { className: 'fal-card' }, head, body)
    }

    /**
     * Mount the settings card.
     * @param ctx - client root context (slots, settingsScope, locale).
     */
    // Зеркало настроек в браузере перечитывается ровно по двум сигналам: коммит
    // документа и переподключение. Регистрация namespace ни тем, ни другим не
    // считается — settings.register кладёт запись в реестр и инвалидацию не шлёт.
    //
    // Поэтому страница, прочитавшая settings.describe раньше, чем хост объявил
    // наш раздел, не увидит его до перезагрузки: во вкладке настроек плагинов
    // просто не будет карточки. Наша карточка там не смонтирована и починить
    // себя не может, так что просим зеркало перечитаться отсюда, пока нас в нём
    // нет. Зеркало общее — одно перечитывание возвращает и остальные карточки,
    // включая ядровые.
    //
    // В нормальном случае это ноль работы: первая же проверка видит namespace
    // и таймер не заводится.
    function refreshMirrorUntilVisible(ctx) {
      const visible = () => {
        try {
          const view = ctx.settingsScope.describe().getSnapshot().view
          return !!view && view.namespaces.some((row) => row.ns === SETTINGS_NS)
        } catch (unavailableService) {
          return false
        }
      }
      if (visible()) return () => {}
      let tries = 0
      const timer = setInterval(() => {
        if (visible() || tries >= 15) { clearInterval(timer); return }
        tries += 1
        try { ctx.settingsScope.describe().load() } catch (notReadyYet) { /* сервис ещё не поднялся */ }
      }, 1000)
      return () => clearInterval(timer)
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, ru }), 'dsh-fal-image-gen: dictionaries')
      ctx.effect(
        () => refreshMirrorUntilVisible(ctx),
        'dsh-fal-image-gen: re-read the settings mirror until our namespace appears',
      )
      const settingsScope = ctx.settingsScope.bind({ namespace: SETTINGS_NS })
      const card = new FalSettingsCardController(settingsScope)
      ctx.slots.inject('tool.call.toolview', () =>
        ctx.slots.register(
          { name: 'tool.call.toolview', key: 'generate_image', locale: NS },
          FalImageCard,
        ),
      )
      ctx.slots.inject('settings.plugin.item', () =>
        ctx.slots.register(
          {
            name: 'settings.plugin.item',
            // Слот сменил тип между версиями ядра: до rc8 это список и нужен
            // id, с rc8 он keyed и нужен key. Проверки смотрят каждая на своё
            // поле, поэтому указываем оба — иначе на одной из версий apply
            // бросает исключение и клиентская половина гибнет целиком.
            id: 'dsh-fal-image-gen',
            key: SETTINGS_NS,
            order: 40,
            locale: NS,
            inject: () => card.inject(),
          },
          FalSettingsCard,
        ),
      )
    }
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
