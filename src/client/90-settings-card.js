    function FalSettingsCard(props) {
      const t = props.t || ((k) => k)
      const [open, setOpen] = react.useState(props.defaultOpen ?? true)
      const [activeTab, setActiveTab] = react.useState('general')

      react.useEffect(() => {
        ensureCss()
      }, [])

      const state = (typeof props.useFalSettingsCard === 'function'
        ? props.useFalSettingsCard((s) => s)
        : null) || props.state || { available: false, writable: false, provider: { text: 'fal' } }

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
        { id: 'gallery', label: t('tab.gallery'), icon: '🖼️' },
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

      // Plugins page seats: 'summary' is the one-line row description, 'page' is the
      // opened detail form (the page draws title/icon/crumb and padding itself, so the
      // form must render bare and open).
      const page = !!(props && props.view === 'page')
      if (props && props.view === 'summary') {
        return react.createElement(
          'div',
          { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } },
          t('settings.description')
        )
      }

      return react.createElement(
        page ? 'div' : 'li',
        { className: page ? 'ig-seat-page' : 'ig-section-card', style: page ? undefined : { listStyle: 'none', marginBottom: '12px' } },
        // Header
        react.createElement(
          'button',
          {
            type: 'button',
            style: {
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: page ? 'none' : 'flex',
              alignItems: 'center',
              width: '100%',
              padding: 0,
              textAlign: 'left',
            },
            'aria-expanded': page ? true : open,
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
        (page || open)
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
                { className: 'ig-tabs', role: 'tablist', 'aria-label': 'Settings Sections' },
                tabs.map((tab) =>
                  react.createElement(
                    'button',
                    {
                      key: tab.id,
                      id: 'tab-btn-' + tab.id,
                      type: 'button',
                      role: 'tab',
                      'aria-selected': activeTab === tab.id,
                      'aria-controls': 'tab-panel-' + tab.id,
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
                {
                  id: 'tab-panel-' + activeTab,
                  role: 'tabpanel',
                  'aria-labelledby': 'tab-btn-' + activeTab,
                  style: { display: 'flex', flexDirection: 'column', gap: '8px' },
                },
                activeTab === 'general' ? react.createElement(UpdaterSection, { t }) : null,
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
