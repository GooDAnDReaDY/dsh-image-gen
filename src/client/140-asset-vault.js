    // -------------------------------------------------------------- Asset Vault View (#159)
    function AssetVaultView(props) {
      const { ctx, onSelectAsset } = props
      const [items, setItems] = react.useState([])
      const [loading, setLoading] = react.useState(false)
      const [q, setQ] = react.useState('')
      const [provider, setProvider] = react.useState('all')
      const [aspect, setAspect] = react.useState('all')
      const [sort, setSort] = react.useState('newest')
      const [offset, setOffset] = react.useState(0)
      const [hasMore, setHasMore] = react.useState(false)
      const [selected, setSelected] = react.useState(null)
      const [feedback, setFeedback] = react.useState('')

      const showFeedback = (msg) => {
        setFeedback(msg)
        setTimeout(() => setFeedback(''), 2500)
      }

      const loadItems = (newOffset = 0, append = false) => {
        setLoading(true)
        const params = new URLSearchParams({
          q,
          provider: provider === 'all' ? '' : provider,
          aspect: aspect === 'all' ? '' : aspect,
          sort,
          offset: String(newOffset),
          limit: '24',
        })
        fetch('/dsh-image-gen/vault?' + params.toString())
          .then((r) => r.json())
          .then((data) => {
            setLoading(false)
            if (data && data.ok) {
              setItems(append ? (prev) => [...prev, ...data.items] : data.items)
              setOffset(data.offset + data.items.length)
              setHasMore(data.hasMore)
            }
          })
          .catch(() => setLoading(false))
      }

      react.useEffect(() => {
        loadItems(0, false)
      }, [q, provider, aspect, sort])

      const handleDelete = (id) => {
        if (!confirm('Are you sure you want to delete this asset?')) return
        fetch('/dsh-image-gen/vault?id=' + encodeURIComponent(id), { method: 'DELETE' })
          .then((r) => r.json())
          .then((res) => {
            if (res.ok) {
              setItems((prev) => prev.filter((it) => it.id !== id && it.attachmentId !== id))
              if (selected && (selected.id === id || selected.attachmentId === id)) {
                setSelected(null)
              }
              showFeedback('Asset deleted')
            }
          })
          .catch(() => showFeedback('Failed to delete asset'))
      }

      const handleInsert = (item) => {
        const link = '![' + (item.prompt || 'Generated Image') + '](' + (item.url || item.thumbnailUrl) + ')'
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(link)
          showFeedback('Markdown snippet copied to clipboard!')
        }
      }

      const handleReroll = (item) => {
        if (typeof onSelectAsset === 'function') {
          onSelectAsset(item)
          return
        }
        const cmd = '/image ' + (item.prompt || '') + (item.seed !== undefined ? ' --seed ' + item.seed : '')
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(cmd)
          showFeedback('Prompt & seed copied to clipboard!')
        }
      }

      return react.createElement(
        'div',
        { className: 'ig-vault-container', style: { display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' } },
        react.createElement(
          'div',
          { className: 'ig-vault-header' },
          react.createElement('input', {
            type: 'text',
            className: 'ig-input',
            style: { flex: '1 1 200px', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' },
            placeholder: 'Search prompt or tags...',
            value: q,
            onChange: (e) => setQ(e.target.value),
          }),
          react.createElement(
            'select',
            {
              className: 'ig-select',
              value: provider,
              onChange: (e) => setProvider(e.target.value),
              style: { padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' },
            },
            react.createElement('option', { value: 'all' }, 'All Providers'),
            react.createElement('option', { value: 'fal' }, 'FAL.ai'),
            react.createElement('option', { value: 'openai' }, 'OpenAI'),
            react.createElement('option', { value: 'local' }, 'Local (ComfyUI)')
          ),
          react.createElement(
            'select',
            {
              className: 'ig-select',
              value: aspect,
              onChange: (e) => setAspect(e.target.value),
              style: { padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' },
            },
            react.createElement('option', { value: 'all' }, 'All Ratios'),
            react.createElement('option', { value: '1:1' }, '1:1 Square'),
            react.createElement('option', { value: '16:9' }, '16:9 Landscape'),
            react.createElement('option', { value: '9:16' }, '9:16 Portrait'),
            react.createElement('option', { value: '4:3' }, '4:3 Standard'),
            react.createElement('option', { value: '21:9' }, '21:9 Ultrawide')
          ),
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-tab-btn',
              onClick: () => setSort(sort === 'newest' ? 'oldest' : 'newest'),
              style: { border: '1px solid var(--dsw-alias-border-l2)', padding: '6px 10px', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
            },
            sort === 'newest' ? '↓ Newest' : '↑ Oldest'
          )
        ),
        feedback && react.createElement('div', { style: { padding: '6px 12px', borderRadius: '6px', background: 'color-mix(in srgb, var(--dsw-alias-state-brand-primary) 15%, transparent)', color: 'var(--dsw-alias-state-brand-primary)', fontSize: '12px' } }, feedback),
        items.length === 0 && !loading
          ? react.createElement('div', { style: { padding: '32px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } }, 'No assets found in vault.')
          : react.createElement(
              'div',
              { className: 'ig-vault-grid' },
              items.map((item) =>
                react.createElement(
                  'div',
                  { key: item.id || item.attachmentId, className: 'ig-vault-card' },
                  react.createElement('img', {
                    src: item.thumbnailUrl || item.url,
                    className: 'ig-vault-thumb',
                    loading: 'lazy',
                    onClick: () => setSelected(item),
                  }),
                  react.createElement(
                    'div',
                    { className: 'ig-vault-body' },
                    react.createElement('div', { className: 'ig-vault-prompt', title: item.prompt }, item.prompt || 'Untitled'),
                    react.createElement(
                      'div',
                      { className: 'ig-vault-meta' },
                      react.createElement('span', null, item.provider || 'local'),
                      item.seed !== undefined && react.createElement('span', null, 'Seed ' + item.seed)
                    ),
                    react.createElement(
                      'div',
                      { style: { display: 'flex', gap: '4px', marginTop: '6px' } },
                      react.createElement('button', { type: 'button', className: 'ig-rev-btn', style: { flex: 1 }, onClick: () => handleReroll(item), title: 'Re-roll with seed' }, '🎲 Re-roll'),
                      react.createElement('button', { type: 'button', className: 'ig-rev-btn', style: { flex: 1 }, onClick: () => handleInsert(item), title: 'Insert into chat' }, '💬 Insert'),
                      react.createElement('button', { type: 'button', className: 'ig-rev-btn', onClick: () => handleDelete(item.id || item.attachmentId), title: 'Delete' }, '🗑️')
                    )
                  )
                )
              )
            ),
        hasMore &&
          react.createElement(
            'div',
            { style: { textAlign: 'center', margin: '14px 0' } },
            react.createElement(
              'button',
              {
                type: 'button',
                className: 'ig-tab-btn',
                onClick: () => loadItems(offset, true),
                disabled: loading,
                style: { padding: '8px 20px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
              },
              loading ? 'Loading...' : 'Load more assets'
            )
          ),
        selected &&
          react.createElement(
            'div',
            {
              style: { position: 'fixed', inset: 0, background: 'var(--dsw-alias-overlay-backdrop, color-mix(in srgb, var(--dsw-alias-bg-layer-0, black) 70%, transparent))', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' },
              onClick: () => setSelected(null),
            },
            react.createElement(
              'div',
              {
                style: { background: 'var(--dsw-alias-bg-layer-3)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px', maxWidth: '580px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' },
                onClick: (e) => e.stopPropagation(),
              },
              react.createElement(
                'div',
                { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                react.createElement('span', { style: { fontWeight: '700', fontSize: '14px', color: 'var(--dsw-alias-label-primary)' } }, 'Asset Inspector'),
                react.createElement('button', { type: 'button', onClick: () => setSelected(null), style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'var(--dsw-alias-label-secondary)' } }, '✕')
              ),
              react.createElement('img', {
                src: selected.url || selected.thumbnailUrl,
                style: { width: '100%', borderRadius: '8px', maxHeight: '360px', objectFit: 'contain', background: 'var(--dsw-alias-bg-layer-2)' },
              }),
              react.createElement(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '11px' } },
                selected.seed !== undefined && react.createElement('span', { className: 'ig-badge' }, 'Seed: ' + selected.seed),
                selected.provider && react.createElement('span', { className: 'ig-badge' }, 'Provider: ' + selected.provider),
                selected.width && react.createElement('span', { className: 'ig-badge' }, selected.width + '×' + selected.height),
                selected.cost ? react.createElement('span', { className: 'ig-badge' }, '$' + Number(selected.cost).toFixed(4)) : null
              ),
              react.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)', padding: '10px', borderRadius: '6px', lineHeight: '1.4' } }, selected.prompt || 'No prompt'),
              react.createElement(
                'div',
                { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' } },
                react.createElement('button', { type: 'button', className: 'ig-tab-btn', onClick: () => handleReroll(selected) }, '🎲 Re-roll'),
                react.createElement('button', { type: 'button', className: 'ig-tab-btn', onClick: () => handleInsert(selected) }, '💬 Insert in Chat'),
                react.createElement(
                  'a',
                  { href: selected.url || selected.thumbnailUrl, download: 'vault-asset-' + (selected.id || 'image') + '.png', className: 'ig-tab-btn', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center' } },
                  '⬇ Download'
                ),
                react.createElement('button', { type: 'button', className: 'ig-tab-btn', style: { color: 'var(--dsw-alias-state-error-primary)' }, onClick: () => handleDelete(selected.id || selected.attachmentId) }, '🗑️ Delete')
              )
            )
          )
      )
    }
