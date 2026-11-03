    // -------------------------------------------------------------- Composer Quick Provider/Model Switcher Pill (#501)
    const PILL_PROVIDERS = [
      { id: 'fal', name: 'FAL.ai', icon: '⚡', desc: 'FLUX, Recraft, SDXL' },
      { id: 'gemini', name: 'Google Gemini', icon: '✨', desc: 'Imagen 3' },
      { id: 'openai', name: 'OpenAI', icon: '🤖', desc: 'DALL-E 3' },
      { id: 'replicate', name: 'Replicate', icon: '🔄', desc: 'FLUX, Ideogram' },
      { id: 'seedream', name: 'Seedream', icon: '🌊', desc: 'Seedream 3.0 / 4.0' },
      { id: 'local', name: 'ComfyUI / Local', icon: '🖥️', desc: 'Local Workflows' },
      { id: 'subscription', name: 'Subscription', icon: '⭐', desc: 'ChatGPT / Grok' },
    ]

    function ProviderPill(props) {
      const t = props.t || ((k) => k)
      const ctx = props.ctx
      const dynamicScope = props.dynamicScope || (ctx && createDynamicSettingsScope(ctx))
      const [open, setOpen] = react.useState(false)
      const [dropdownPos, setDropdownPos] = react.useState({ top: 0, left: 0 })
      const btnRef = react.useRef(null)

      const snap = dynamicScope ? dynamicScope.getSnapshot() : { value: {} }
      const currentProvider = (snap?.value?.provider) || 'fal'
      const activeObj = PILL_PROVIDERS.find((p) => p.id === currentProvider) || PILL_PROVIDERS[0]

      const toggleMenu = react.useCallback(() => {
        if (!open && btnRef.current) {
          const rect = btnRef.current.getBoundingClientRect()
          // Open upwards if composer is in bottom half of viewport
          const spaceBelow = window.innerHeight - rect.bottom
          const top = spaceBelow < 280 && rect.top >= 280 ? rect.top - 260 : rect.bottom + 6
          const left = Math.max(12, Math.min(window.innerWidth - 250, rect.left))
          setDropdownPos({ top, left })
        }
        setOpen(!open)
      }, [open])

      // Close on outside click or Esc
      react.useEffect(() => {
        if (!open) return
        const handleClickOutside = (e) => {
          if (btnRef.current && !btnRef.current.contains(e.target) && !e.target.closest('.ig-pill-dropdown')) {
            setOpen(false)
          }
        }
        const handleKeyDown = (e) => {
          if (e.key === 'Escape') setOpen(false)
        }
        window.addEventListener('mousedown', handleClickOutside)
        window.addEventListener('keydown', handleKeyDown)
        return () => {
          window.removeEventListener('mousedown', handleClickOutside)
          window.removeEventListener('keydown', handleKeyDown)
        }
      }, [open])

      const handleSelect = async (providerId) => {
        try {
          if (dynamicScope?.set) {
            await dynamicScope.set('provider', providerId)
          }
        } catch (_) { /* ignore write rejection */ }
        setOpen(false)
      }

      if (snap?.value?.showProviderPill === false) return null

      return react.createElement(
        'div',
        { className: 'ig-pill-wrap' },
        react.createElement(
          'button',
          {
            ref: btnRef,
            type: 'button',
            className: open ? 'ig-pill-btn ig-pill-btn-active' : 'ig-pill-btn',
            onClick: toggleMenu,
            title: t('pill.tooltip') || 'Quick switch image provider & model',
          },
          react.createElement('span', { className: 'ig-pill-icon' }, activeObj.icon),
          react.createElement('span', { className: 'ig-pill-label' }, activeObj.name),
          react.createElement('span', { className: open ? 'ig-pill-caret ig-pill-caret-up' : 'ig-pill-caret' }, '▾')
        ),
        open ? react.createElement(
          'div',
          {
            className: 'ig-pill-dropdown',
            style: { top: `${dropdownPos.top}px`, left: `${dropdownPos.left}px` },
          },
          react.createElement('div', { className: 'ig-pill-dropdown-title' }, t('pill.menuTitle') || 'Image Provider'),
          PILL_PROVIDERS.map((p) => {
            const isSelected = p.id === currentProvider
            return react.createElement(
              'button',
              {
                key: p.id,
                type: 'button',
                className: isSelected ? 'ig-pill-item ig-pill-item-selected' : 'ig-pill-item',
                onClick: () => handleSelect(p.id),
              },
              react.createElement(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                react.createElement('span', { style: { fontWeight: isSelected ? '600' : '500' } }, `${p.icon} ${p.name}`),
                react.createElement('span', { style: { fontSize: '11px', opacity: 0.7 } }, p.desc)
              ),
              isSelected ? react.createElement('span', { className: 'ig-pill-check' }, '✓') : null
            )
          })
        ) : null
      )
    }
