    // -------------------------------------------------------------- Standalone Image Studio & Sidebar Pane (#158, #304, #452)

    /**
     * Dedicated DSH Right Sidebar Image Studio component (#452).
     * Provides persistent prompt drafting, style auto-completion, parameter selectors,
     * compact recent generations grid, and copy path / insert into chat buttons.
     */
    function SidebarImageStudio(props) {
      const { ctx } = props
      const t = resolveTranslator(props, ctx)
      const [viewMode, setViewMode] = react.useState('studio') // 'studio' | 'vault'
      const [prompt, setPrompt] = react.useState(() => {
        try { return window.localStorage.getItem('dsh_studio_prompt') || '' } catch (_) { return '' }
      })
      const [negativePrompt, setNegativePrompt] = react.useState(() => {
        try { return window.localStorage.getItem('dsh_studio_neg_prompt') || '' } catch (_) { return '' }
      })
      const [provider, setProvider] = react.useState('fal')
      const [model, setModel] = react.useState('fal-ai/flux-2/klein/9b')
      const [aspectRatio, setAspectRatio] = react.useState('1:1')
      const [transparentBg, setTransparentBg] = react.useState(false)
      const [seed, setSeed] = react.useState('')
      const [recentList, setRecentList] = react.useState([])
      const [activeItem, setActiveItem] = react.useState(null)
      const [statusMsg, setStatusMsg] = react.useState('')
      const [isLoading, setIsLoading] = react.useState(false)

      const styleTags = [
        'Photorealistic',
        'Anime',
        'Cyberpunk',
        'Vector',
        '3D Render',
        'Minimalist',
        'Pixel Art',
        'Watercolor',
      ]

      const exclusionTags = [
        'blurry',
        'low quality',
        'watermark',
        'deformed',
      ]

      const providerModels = {
        fal: [
          { id: 'fal-ai/flux-2/klein/9b', label: 'Flux 2 Klein 9B' },
          { id: 'fal-ai/flux-pro/v1.1-ultra', label: 'Flux Pro Ultra' },
          { id: 'fal-ai/stable-diffusion-v35-large', label: 'SD 3.5 Large' },
        ],
        openai: [
          { id: 'gpt-image-1', label: 'GPT Image 1' },
          { id: 'dall-e-3', label: 'DALL-E 3' },
        ],
        comfy: [
          { id: 'sdxl-base-1.0', label: 'Comfy SDXL' },
          { id: 'flux-schnell', label: 'Comfy Flux Schnell' },
        ],
        codex: [
          { id: 'default', label: 'Codex Image' },
        ],
        grok: [
          { id: 'grok-2-image', label: 'Grok 2 Image' },
        ],
      }

      const showNotification = (msg) => {
        setStatusMsg(msg)
        setTimeout(() => setStatusMsg(''), 2500)
      }

      const refreshRecent = () => {
        setIsLoading(true)
        fetchJson('/dsh-image-gen/vault?limit=12')
          .then((r) => r.json())
          .then((data) => {
            setIsLoading(false)
            if (data && data.ok && Array.isArray(data.items)) {
              setRecentList(data.items)
              if (!activeItem && data.items.length > 0) {
                setActiveItem(data.items[0])
              }
            }
          })
          .catch(() => {
            setIsLoading(false)
          })
      }

      react.useEffect(() => {
        refreshRecent()
        // Sync default configuration from server if available
        fetchJson('/dsh-image-gen/config')
          .then((r) => r.json())
          .then((data) => {
            if (data && data.ok && data.config) {
              if (data.config.provider) setProvider(data.config.provider)
              if (data.config.model) setModel(data.config.model)
              if (data.config.defaultAspectRatio) setAspectRatio(data.config.defaultAspectRatio)
            }
          })
          .catch(() => {})
      }, [])

      const updatePrompt = (val) => {
        setPrompt(val)
        try { window.localStorage.setItem('dsh_studio_prompt', val) } catch (_) {}
      }

      const updateNegativePrompt = (val) => {
        setNegativePrompt(val)
        try { window.localStorage.setItem('dsh_studio_neg_prompt', val) } catch (_) {}
      }

      const handleAddStyleTag = (tag) => {
        if (!prompt) {
          updatePrompt(tag)
        } else if (!prompt.toLowerCase().includes(tag.toLowerCase())) {
          updatePrompt(prompt + ', ' + tag)
        }
      }

      const handleAddExclusionTag = (tag) => {
        if (!negativePrompt) {
          updateNegativePrompt(tag)
        } else if (!negativePrompt.toLowerCase().includes(tag.toLowerCase())) {
          updateNegativePrompt(negativePrompt + ', ' + tag)
        }
      }

      const handleProviderChange = (p) => {
        setProvider(p)
        const models = providerModels[p]
        if (models && models.length > 0) {
          setModel(models[0].id)
        }
      }

      const handleSelectAsset = (item) => {
        if (!item) return
        setActiveItem(item)
        if (item.prompt) updatePrompt(item.prompt)
        if (item.provider) handleProviderChange(item.provider)
        if (item.seed !== undefined) setSeed(String(item.seed))
      }

      const handleCopyPath = () => {
        if (!activeItem) return
        const filePath = activeItem.path || activeItem.url || activeItem.thumbnailUrl || ''
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(filePath)
          showNotification(t('studio.copiedPath') || 'Copied file path to clipboard!')
        }
      }

      const handleInsertToChat = () => {
        if (!activeItem) return
        const targetUrl = activeItem.url || activeItem.thumbnailUrl || activeItem.path || ''
        const altText = activeItem.prompt ? activeItem.prompt.slice(0, 48) : 'Generated Image'
        const snippet = '![' + altText + '](' + targetUrl + ')'

        let inserted = false
        // Try direct chat input insertion if available in DSH host
        try {
          const chatInput = document.querySelector('.dsh-chat-input textarea, [data-chat-input] textarea, #chat-input')
          if (chatInput) {
            const current = chatInput.value || ''
            chatInput.value = current ? current + '\n' + snippet : snippet
            if (typeof window !== 'undefined' && typeof window.Event === 'function') chatInput.dispatchEvent(new window.Event('input', { bubbles: true }))
            inserted = true
          }
        } catch (_) {}

        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(snippet)
          showNotification(inserted ? (t('studio.insertedChat') || 'Inserted snippet into chat!') : (t('studio.copiedSnippet') || 'Copied Markdown snippet to clipboard!'))
        }
      }

      const handleGenerateCommand = () => {
        let cmd = '/image ' + (prompt || 'Artwork')
        if (negativePrompt) cmd += ' --negative "' + negativePrompt + '"'
        if (aspectRatio) cmd += ' --aspect ' + aspectRatio
        if (provider) cmd += ' --provider ' + provider
        if (model) cmd += ' --model ' + model
        if (transparentBg) cmd += ' --nobg'
        if (seed) cmd += ' --seed ' + seed

        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(cmd)
          showNotification(t('studio.copiedCommand') || 'Copied generation command to clipboard!')
        }
      }

      return react.createElement(
        'div',
        { className: 'ig-sidebar-studio' },
        // Header
        react.createElement(
          'div',
          { className: 'ig-sidebar-header' },
          react.createElement(
            'div',
            { className: 'ig-sidebar-title' },
            react.createElement('span', null, '🎨'),
            react.createElement('span', null, t('studio.title') || 'Image Studio')
          ),
          react.createElement(
            'div',
            { style: { display: 'flex', gap: '4px' } },
            react.createElement(
              'button',
              {
                type: 'button',
                className: 'ig-tab-btn ' + (viewMode === 'studio' ? 'active' : ''),
                style: { padding: '3px 8px', fontSize: '11px' },
                onClick: () => setViewMode('studio'),
              },
              t('studio.canvas') || 'Studio'
            ),
            react.createElement(
              'button',
              {
                type: 'button',
                className: 'ig-tab-btn ' + (viewMode === 'vault' ? 'active' : ''),
                style: { padding: '3px 8px', fontSize: '11px' },
                onClick: () => setViewMode('vault'),
              },
              '🗃️ ' + (t('studio.vault') || 'Vault')
            ),
            react.createElement(
              'button',
              {
                type: 'button',
                className: 'ig-tab-btn',
                style: { padding: '3px 6px', fontSize: '11px' },
                title: 'Refresh',
                onClick: refreshRecent,
              },
              isLoading ? '⌛' : '🔄'
            )
          )
        ),

        viewMode === 'vault'
          ? react.createElement(AssetVaultView, { ctx, t, onSelectAsset: (item) => { handleSelectAsset(item); setViewMode('studio') } })
          : react.createElement(
              react.Fragment,
              null,
              // Prompt Input & Autocomplete Tags
              react.createElement(
                'div',
                null,
                react.createElement('label', { style: { fontSize: '11px', fontWeight: '600', color: 'var(--dsw-alias-label-secondary)', display: 'block', marginBottom: '4px' } }, t('studio.prompt') || 'Prompt:'),
                react.createElement('textarea', {
                  className: 'ig-input',
                  rows: 3,
                  style: { width: '100%', resize: 'vertical', borderRadius: '6px', padding: '6px 8px', fontSize: '12px' },
                  placeholder: t('studio.promptPlaceholder') || 'Describe your vision...',
                  value: prompt,
                  onChange: (e) => updatePrompt(e.target.value),
                }),
                react.createElement(
                  'div',
                  { className: 'ig-chip-group' },
                  styleTags.map((tag) =>
                    react.createElement(
                      'span',
                      {
                        key: tag,
                        className: 'ig-chip ' + (prompt.toLowerCase().includes(tag.toLowerCase()) ? 'active' : ''),
                        onClick: () => handleAddStyleTag(tag),
                      },
                      tag
                    )
                  )
                )
              ),

              // Negative Prompt Input & Exclusion Tags
              react.createElement(
                'div',
                null,
                react.createElement('label', { style: { fontSize: '11px', fontWeight: '600', color: 'var(--dsw-alias-label-secondary)', display: 'block', marginBottom: '4px' } }, t('studio.negativePrompt') || 'Negative Prompt:'),
                react.createElement('input', {
                  type: 'text',
                  className: 'ig-input',
                  style: { width: '100%', borderRadius: '6px', padding: '6px 8px', fontSize: '12px' },
                  placeholder: t('studio.negativePlaceholder') || 'Elements to avoid...',
                  value: negativePrompt,
                  onChange: (e) => updateNegativePrompt(e.target.value),
                }),
                react.createElement(
                  'div',
                  { className: 'ig-chip-group' },
                  exclusionTags.map((tag) =>
                    react.createElement(
                      'span',
                      {
                        key: tag,
                        className: 'ig-chip ' + (negativePrompt.toLowerCase().includes(tag.toLowerCase()) ? 'active' : ''),
                        onClick: () => handleAddExclusionTag(tag),
                      },
                      tag
                    )
                  )
                )
              ),

              // Provider & Model Selectors
              react.createElement(
                'div',
                { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } },
                react.createElement(
                  'div',
                  null,
                  react.createElement('label', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', display: 'block', marginBottom: '4px' } }, t('studio.provider') || 'Provider:'),
                  react.createElement(
                    'select',
                    {
                      className: 'ig-select',
                      style: { width: '100%', padding: '5px', fontSize: '11px' },
                      value: provider,
                      onChange: (e) => handleProviderChange(e.target.value),
                    },
                    react.createElement('option', { value: 'fal' }, 'FAL.ai'),
                    react.createElement('option', { value: 'openai' }, 'OpenAI'),
                    react.createElement('option', { value: 'comfy' }, 'ComfyUI'),
                    react.createElement('option', { value: 'codex' }, 'Codex'),
                    react.createElement('option', { value: 'grok' }, 'Grok')
                  )
                ),
                react.createElement(
                  'div',
                  null,
                  react.createElement('label', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', display: 'block', marginBottom: '4px' } }, t('studio.model') || 'Model:'),
                  react.createElement(
                    'select',
                    {
                      className: 'ig-select',
                      style: { width: '100%', padding: '5px', fontSize: '11px' },
                      value: model,
                      onChange: (e) => setModel(e.target.value),
                    },
                    (providerModels[provider] || [{ id: model, label: model }]).map((m) =>
                      react.createElement('option', { key: m.id, value: m.id }, m.label)
                    )
                  )
                )
              ),

              // Aspect Ratio & Transparent Background
              react.createElement(
                'div',
                { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', alignItems: 'center' } },
                react.createElement(
                  'div',
                  null,
                  react.createElement('label', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', display: 'block', marginBottom: '4px' } }, t('studio.aspectRatio') || 'Aspect Ratio:'),
                  react.createElement(
                    'select',
                    {
                      className: 'ig-select',
                      style: { width: '100%', padding: '5px', fontSize: '11px' },
                      value: aspectRatio,
                      onChange: (e) => setAspectRatio(e.target.value),
                    },
                    react.createElement('option', { value: '1:1' }, '1:1 Square'),
                    react.createElement('option', { value: '16:9' }, '16:9 Landscape'),
                    react.createElement('option', { value: '9:16' }, '9:16 Portrait'),
                    react.createElement('option', { value: '4:3' }, '4:3 Standard'),
                    react.createElement('option', { value: '3:4' }, '3:4 Portrait'),
                    react.createElement('option', { value: '21:9' }, '21:9 Ultrawide')
                  )
                ),
                react.createElement(
                  'label',
                  { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', marginTop: '16px' } },
                  react.createElement('input', {
                    type: 'checkbox',
                    checked: transparentBg,
                    onChange: (e) => setTransparentBg(e.target.checked),
                  }),
                  t('studio.transparentBg') || 'Transparent background'
                )
              ),

              // Generate Command Button
              react.createElement(
                'button',
                {
                  type: 'button',
                  className: 'ig-save-btn',
                  style: { padding: '8px', fontSize: '12px', marginTop: '2px' },
                  onClick: handleGenerateCommand,
                },
                '🎨 ' + (t('studio.generate') || 'Generate in Chat')
              ),

              statusMsg && react.createElement(
                'div',
                { style: { fontSize: '11px', color: 'var(--dsw-alias-state-brand-primary)', textAlign: 'center', fontWeight: '500' } },
                statusMsg
              ),

              // Active Item Preview Card & Action Bar
              activeItem && react.createElement(
                'div',
                { className: 'ig-sidebar-active-card' },
                react.createElement('img', {
                  src: activeItem.url || activeItem.thumbnailUrl,
                  className: 'ig-sidebar-preview-img',
                  alt: activeItem.prompt || 'Artwork',
                }),
                react.createElement(
                  'div',
                  { className: 'ig-sidebar-actions' },
                  react.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'ig-tab-btn',
                      style: { flex: 1, padding: '4px 6px', fontSize: '11px' },
                      onClick: handleCopyPath,
                    },
                    '📋 ' + (t('studio.copyPath') || 'Copy Path')
                  ),
                  react.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'ig-tab-btn',
                      style: { flex: 1, padding: '4px 6px', fontSize: '11px' },
                      onClick: handleInsertToChat,
                    },
                    '💬 ' + (t('studio.insertChat') || 'Insert to Chat')
                  ),
                  react.createElement(
                    'a',
                    {
                      href: activeItem.url || activeItem.thumbnailUrl,
                      download: (activeItem.id || 'studio-asset') + '.png',
                      className: 'ig-tab-btn',
                      style: { textDecoration: 'none', padding: '4px 8px', fontSize: '11px', textAlign: 'center' },
                    },
                    '⬇'
                  )
                )
              ),

              // Recent Generations Compact Grid
              react.createElement(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' } },
                react.createElement(
                  'div',
                  { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                  react.createElement('span', { style: { fontSize: '11px', fontWeight: '600', color: 'var(--dsw-alias-label-secondary)' } }, t('studio.recent') || 'Recent Generations'),
                  react.createElement('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } }, String(recentList.length) + ' items')
                ),
                recentList.length === 0
                  ? react.createElement('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', textAlign: 'center', padding: '12px' } }, t('studio.noRecent') || 'No recent generations found in vault.')
                  : react.createElement(
                      'div',
                      { className: 'ig-sidebar-grid' },
                      recentList.map((item) =>
                        react.createElement('img', {
                          key: item.id || item.attachmentId,
                          src: item.thumbnailUrl || item.url,
                          className: 'ig-sidebar-thumb ' + (activeItem && activeItem.id === item.id ? 'selected' : ''),
                          title: item.prompt || 'Artwork',
                          onClick: () => handleSelectAsset(item),
                        })
                      )
                    )
              )
            )
      )
    }

    // Fullscreen / Modal Studio Canvas View
    function ImageStudioView(props) {
      return react.createElement(SidebarImageStudio, props)
    }

