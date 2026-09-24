    // -------------------------------------------------------------- Theme Pair Toolview (#189, #296)
    function ThemePairView(props) {
      const block = props.block
      const t = props.t || ((k) => k)
      const [copiedHtml, setCopiedHtml] = react.useState(false)
      const [copiedCss, setCopiedCss] = react.useState(false)
      const [themeTab, setThemeTab] = react.useState('light')

      const raw = (block && (block.call ? block.call.argsRaw : block.argsRaw)) || ''
      let args = {}
      try { if (raw) args = JSON.parse(raw) } catch (_) { /* invalid json */ }

      let data = {}
      try {
        const out = block && (block.output || block.result || block.text || '')
        if (typeof out === 'object') data = out
        else if (typeof out === 'string') data = JSON.parse(out)
      } catch (_) { /* invalid json */ }

      const light = data.light || {}
      const dark = data.dark || {}
      const htmlSnippet = data.html_snippet || ''
      const cssSnippet = data.css_snippet || ''

      const copyCode = (text, isHtml) => {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(text)
          if (isHtml) {
            setCopiedHtml(true)
            setTimeout(() => setCopiedHtml(false), 2000)
          } else {
            setCopiedCss(true)
            setTimeout(() => setCopiedCss(false), 2000)
          }
        }
      }

      const activeImg = themeTab === 'light' ? light : dark

      return react.createElement(
        'div',
        { className: 'ig-page', style: { padding: '4px 0', gap: '10px' } },
        react.createElement('div', { className: 'fal_head' }, '🌓 ' + (t('themePair.title') || 'Theme Pair Graphic')),
        args.prompt ? react.createElement('div', { className: 'ig-prompt' }, args.prompt) : null,
        react.createElement(
          'div',
          { className: 'ig-tabs' },
          react.createElement(
            'button',
            {
              type: 'button',
              className: themeTab === 'light' ? 'ig-tab-btn ig-tab-btn-active' : 'ig-tab-btn',
              onClick: () => setThemeTab('light'),
            },
            '☀️ ' + (t('themePair.light') || 'Light Theme')
          ),
          react.createElement(
            'button',
            {
              type: 'button',
              className: themeTab === 'dark' ? 'ig-tab-btn ig-tab-btn-active' : 'ig-tab-btn',
              onClick: () => setThemeTab('dark'),
            },
            '🌙 ' + (t('themePair.dark') || 'Dark Theme')
          )
        ),
        activeImg.url || activeImg.path ? react.createElement('img', {
          src: activeImg.url || activeImg.path,
          alt: args.prompt || 'theme image',
          loading: 'lazy',
          style: {
            width: '100%',
            maxHeight: '400px',
            objectFit: 'contain',
            borderRadius: '8px',
            border: '1px solid var(--dsw-alias-border-l2)',
            background: themeTab === 'light' ? 'var(--dsw-alias-bg-layer-1)' : 'var(--dsw-alias-bg-layer-3)',
          },
        }) : null,
        htmlSnippet ? react.createElement(
          'div',
          { style: { display: 'flex', gap: '8px', marginTop: '4px' } },
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-btn',
              onClick: () => copyCode(htmlSnippet, true),
            },
            copiedHtml ? '✓ ' + (t('themePair.copiedHtml') || 'Copied HTML') : '📋 ' + (t('themePair.copyHtml') || 'Copy <picture> HTML')
          ),
          cssSnippet ? react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-btn',
              onClick: () => copyCode(cssSnippet, false),
            },
            copiedCss ? '✓ ' + (t('themePair.copiedCss') || 'Copied CSS') : '🎨 ' + (t('themePair.copyCss') || 'Copy Theme CSS')
          ) : null
        ) : null
      )
    }
    var ThemePairToolView = ThemePairView
