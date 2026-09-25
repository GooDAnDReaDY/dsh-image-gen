    // -------------------------------------------------------------- Fullscreen Image Studio (#158, #304)
    function ImageStudioView(props) {
      const { ctx } = props
      const t = resolveTranslator(props, ctx)
      const [viewMode, setViewMode] = react.useState('studio') // 'studio' | 'vault'
      const [isFullscreen, setIsFullscreen] = react.useState(false)
      const [layoutGrid, setLayoutGrid] = react.useState('1x1') // '1x1' | '2x2' | '1x4'
      const [prompt, setPrompt] = react.useState(() => {
        try { return window.localStorage.getItem('dsh_studio_prompt') || '' } catch (_) { return '' }
      })
      const [stylePreset, setStylePreset] = react.useState('none')
      const [aspectRatio, setAspectRatio] = react.useState('1:1')
      const [provider, setProvider] = react.useState('fal')
      const [seed, setSeed] = react.useState('')
      const [activeImages, setActiveImages] = react.useState([])
      const [recentStrip, setRecentStrip] = react.useState([])
      const [status, setStatus] = react.useState('')

      const presets = [
        { id: 'none', label: 'Default' },
        { id: 'photorealistic', label: 'Photo' },
        { id: 'anime', label: 'Anime' },
        { id: 'cyberpunk', label: 'Cyberpunk' },
        { id: 'flat_vector', label: 'Vector' },
        { id: '3d_render', label: '3D Render' },
      ]

      const refreshRecent = () => {
        fetch('/dsh-image-gen/vault?limit=12')
          .then((r) => r.json())
          .then((data) => {
            if (data && data.ok && Array.isArray(data.items)) {
              setRecentStrip(data.items)
              if (activeImages.length === 0 && data.items.length > 0) {
                setActiveImages([data.items[0]])
              }
            }
          })
          .catch(() => {})
      }

      react.useEffect(() => {
        refreshRecent()
      }, [])

      const updatePrompt = (val) => {
        setPrompt(val)
        try { window.localStorage.setItem('dsh_studio_prompt', val) } catch (_) {}
      }

      const handleSelectFromVault = (item) => {
        if (!item) return
        setActiveImages([item])
        setViewMode('studio')
        if (item.prompt) updatePrompt(item.prompt)
        if (item.provider) setProvider(item.provider)
        if (item.seed !== undefined) setSeed(String(item.seed))
      }

      const handleCopySnippet = (format) => {
        const first = activeImages[0]
        if (!first) return
        const url = first.url || first.thumbnailUrl
        let snippet = ''
        if (format === 'markdown') snippet = '![' + (first.prompt || 'Artwork') + '](' + url + ')'
        if (format === 'html') snippet = '<img src="' + url + '" alt="' + (first.prompt || 'Artwork') + '" />'
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(snippet)
          setStatus(t('studio.copiedSnippet') || ('Copied ' + format.toUpperCase() + ' snippet!'))
          setTimeout(() => setStatus(''), 2000)
        }
      }

      const containerStyle = isFullscreen
        ? { position: 'fixed', inset: 0, zIndex: 99999, background: 'var(--dsw-alias-bg-layer-1)', padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }
        : { display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }

      return react.createElement(
        'div',
        { className: 'ig-studio-container', style: containerStyle },
        react.createElement(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', borderBottom: '1px solid var(--dsw-alias-border-l2)', paddingBottom: '10px' } },
          react.createElement(
            'div',
            { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            react.createElement('span', { style: { fontWeight: '700', fontSize: '15px', color: 'var(--dsw-alias-label-primary)' } }, '🎨 ' + (t('studio.title') || 'Image Studio')),
            react.createElement(
              'button',
              {
                type: 'button',
                className: 'ig-tab-btn ' + (viewMode === 'studio' ? 'active' : ''),
                onClick: () => setViewMode('studio'),
              },
              t('studio.canvas') || 'Studio Canvas'
            ),
            react.createElement(
              'button',
              {
                type: 'button',
                className: 'ig-tab-btn ' + (viewMode === 'vault' ? 'active' : ''),
                onClick: () => setViewMode('vault'),
              },
              '🗃️ ' + (t('studio.vault') || 'Asset Vault')
            )
          ),
          react.createElement(
            'div',
            { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            viewMode === 'studio' &&
              react.createElement(
                'div',
                { style: { display: 'flex', gap: '4px' } },
                ['1x1', '2x2', '1x4'].map((grid) =>
                  react.createElement(
                    'button',
                    {
                      key: grid,
                      type: 'button',
                      className: 'ig-tab-btn ' + (layoutGrid === grid ? 'active' : ''),
                      onClick: () => setLayoutGrid(grid),
                      title: 'Grid layout: ' + grid,
                    },
                    grid
                  )
                )
              ),
            react.createElement(
              'button',
              {
                type: 'button',
                className: 'ig-tab-btn',
                onClick: () => setIsFullscreen(!isFullscreen),
                style: { border: '1px solid var(--dsw-alias-border-l2)' },
              },
              isFullscreen ? ('✕ ' + (t('studio.exitFullscreen') || 'Exit Fullscreen')) : ('⛶ ' + (t('studio.fullscreen') || 'Fullscreen'))
            )
          )
        ),
        viewMode === 'vault'
          ? react.createElement(AssetVaultView, { ctx, t, onSelectAsset: handleSelectFromVault })
          : react.createElement(
              react.Fragment,
              null,
              react.createElement(
                'div',
                { className: 'ig-studio-layout' },
                react.createElement(
                  'div',
                  { className: 'ig-studio-sidebar' },
                  react.createElement('span', { style: { fontWeight: '600', fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } }, t('studio.parameters') || 'Generation Parameters'),
                  react.createElement(
                    'div',
                    null,
                    react.createElement('label', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', display: 'block', marginBottom: '4px' } }, t('studio.prompt') || 'Prompt:'),
                    react.createElement('textarea', {
                      className: 'ig-input',
                      rows: 4,
                      style: { width: '100%', resize: 'vertical', borderRadius: '6px', padding: '8px', fontSize: '12px' },
                      placeholder: t('studio.promptPlaceholder') || 'Describe your vision...',
                      value: prompt,
                      onChange: (e) => updatePrompt(e.target.value),
                    })
                  ),
                  react.createElement(
                    'div',
                    null,
                    react.createElement('label', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', display: 'block', marginBottom: '4px' } }, t('studio.stylePreset') || 'Style Preset:'),
                    react.createElement(
                      'div',
                      { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } },
                      presets.map((p) =>
                        react.createElement(
                          'button',
                          {
                            key: p.id,
                            type: 'button',
                            className: 'ig-tab-btn ' + (stylePreset === p.id ? 'active' : ''),
                            style: { fontSize: '11px', padding: '3px 8px' },
                            onClick: () => setStylePreset(p.id),
                          },
                          p.label
                        )
                      )
                    )
                  ),
                  react.createElement(
                    'div',
                    { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } },
                    react.createElement(
                      'div',
                      null,
                      react.createElement('label', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', display: 'block', marginBottom: '4px' } }, t('studio.aspectRatio') || 'Aspect Ratio:'),
                      react.createElement(
                        'select',
                        {
                          className: 'ig-select',
                          style: { width: '100%', padding: '6px', fontSize: '12px' },
                          value: aspectRatio,
                          onChange: (e) => setAspectRatio(e.target.value),
                        },
                        react.createElement('option', { value: '1:1' }, '1:1 Square'),
                        react.createElement('option', { value: '16:9' }, '16:9 Landscape'),
                        react.createElement('option', { value: '9:16' }, '9:16 Portrait'),
                        react.createElement('option', { value: '4:3' }, '4:3 Standard'),
                        react.createElement('option', { value: '21:9' }, '21:9 Ultrawide')
                      )
                    ),
                    react.createElement(
                      'div',
                      null,
                      react.createElement('label', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', display: 'block', marginBottom: '4px' } }, t('studio.provider') || 'Provider:'),
                      react.createElement(
                        'select',
                        {
                          className: 'ig-select',
                          style: { width: '100%', padding: '6px', fontSize: '12px' },
                          value: provider,
                          onChange: (e) => setProvider(e.target.value),
                        },
                        react.createElement('option', { value: 'fal' }, 'FAL.ai'),
                        react.createElement('option', { value: 'openai' }, 'OpenAI'),
                        react.createElement('option', { value: 'local' }, 'Local (ComfyUI)')
                      )
                    )
                  ),
                  react.createElement(
                    'div',
                    null,
                    react.createElement('label', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', display: 'block', marginBottom: '4px' } }, t('studio.seed') || 'Seed (optional):'),
                    react.createElement(
                      'div',
                      { style: { display: 'flex', gap: '6px' } },
                      react.createElement('input', {
                        type: 'number',
                        className: 'ig-input',
                        style: { flex: 1, padding: '6px', fontSize: '12px' },
                        placeholder: t('studio.random') || 'Random',
                        value: seed,
                        onChange: (e) => setSeed(e.target.value),
                      }),
                      react.createElement(
                        'button',
                        {
                          type: 'button',
                          className: 'ig-tab-btn',
                          onClick: () => setSeed(String(Math.floor(Math.random() * 2147483647))),
                          title: t('studio.randomizeSeed') || 'Randomize seed',
                        },
                        '🎲'
                      )
                    )
                  ),
                  react.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'ig-save-btn',
                      style: { marginTop: '8px', padding: '10px' },
                      onClick: () => {
                        const cmd = '/image ' + (prompt || 'Artwork') + (stylePreset !== 'none' ? ' --style ' + stylePreset : '') + ' --aspect ' + aspectRatio + ' --provider ' + provider + (seed ? ' --seed ' + seed : '')
                        if (typeof navigator !== 'undefined' && navigator.clipboard) {
                          navigator.clipboard.writeText(cmd)
                          setStatus(t('studio.copiedCommand') || 'Copied generation command to clipboard!')
                          setTimeout(() => setStatus(''), 2500)
                        }
                      },
                    },
                    '🎨 ' + (t('studio.generate') || 'Generate in Chat')
                  ),
                  status && react.createElement('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-brand-primary)', textAlign: 'center' } }, status)
                ),
                react.createElement(
                  'div',
                  { className: 'ig-studio-canvas' },
                  activeImages.length === 0
                    ? react.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } }, t('studio.emptyCanvas') || 'Select an image from the recent strip below or click Generate.')
                    : react.createElement(
                        'div',
                        {
                          style: {
                            display: 'grid',
                            gridTemplateColumns: layoutGrid === '2x2' ? 'repeat(2, 1fr)' : layoutGrid === '1x4' ? 'repeat(4, 1fr)' : '1fr',
                            gap: '12px',
                            width: '100%',
                            maxHeight: '440px',
                            overflowY: 'auto',
                          },
                        },
                        (layoutGrid === '1x1' ? activeImages.slice(0, 1) : activeImages.slice(0, layoutGrid === '2x2' ? 4 : 4)).map((img, i) =>
                          react.createElement('img', {
                            key: img.id || i,
                            src: img.url || img.thumbnailUrl,
                            style: { width: '100%', height: 'auto', maxHeight: '400px', objectFit: 'contain', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-3)' },
                          })
                        )
                      ),
                  activeImages.length > 0 &&
                    react.createElement(
                      'div',
                      { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
                      react.createElement('button', { type: 'button', className: 'ig-tab-btn', onClick: () => handleCopySnippet('markdown') }, t('studio.copyMarkdown') || 'Copy Markdown'),
                      react.createElement('button', { type: 'button', className: 'ig-tab-btn', onClick: () => handleCopySnippet('html') }, t('studio.copyHtml') || 'Copy HTML'),
                      react.createElement(
                        'a',
                        { href: activeImages[0].url || activeImages[0].thumbnailUrl, download: 'studio-image.png', className: 'ig-tab-btn', style: { textDecoration: 'none' } },
                        '⬇ ' + (t('studio.download') || 'Download')
                      )
                    )
                )
              ),
              react.createElement(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' } },
                react.createElement('span', { style: { fontSize: '12px', fontWeight: '600', color: 'var(--dsw-alias-label-secondary)' } }, (t('studio.recent') || 'Recent Generations') + ':'),
                react.createElement(
                  'div',
                  { className: 'ig-studio-strip', style: { display: 'flex', gap: '8px', overflowX: 'auto', padding: '4px 0' } },
                  recentStrip.map((item) =>
                    react.createElement('img', {
                      key: item.id || item.attachmentId,
                      src: item.thumbnailUrl || item.url,
                      className: 'ig-studio-strip-thumb',
                      style: { width: '64px', height: '64px', borderRadius: '6px', objectFit: 'cover', cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l2)', flexShrink: 0 },
                      title: item.prompt || 'Artwork',
                      onClick: () => handleSelectFromVault(item),
                    })
                  )
                )
              )
            )
      )
    }
