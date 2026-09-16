    function GalleryView(props) {
      const t = props.t || ((k) => k)
      const [items, setItems] = react.useState([])
      const [loading, setLoading] = react.useState(true)
      const [selected, setSelected] = react.useState(null)
      const [copiedPrompt, setCopiedPrompt] = react.useState(false)
      const [copiedLink, setCopiedLink] = react.useState(false)

      const loadHistory = () => {
        setLoading(true)
        fetch('/dsh-image-gen/history')
          .then((r) => r.json())
          .then((data) => {
            setItems(Array.isArray(data) ? data : [])
            setLoading(false)
          })
          .catch(() => {
            setItems([])
            setLoading(false)
          })
      }

      react.useEffect(() => {
        loadHistory()
      }, [])

      if (loading) {
        return react.createElement(
          'div',
          { style: { padding: '24px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } },
          'Loading recent generations...'
        )
      }

      if (items.length === 0) {
        return react.createElement(
          'div',
          {
            style: {
              padding: '32px 16px',
              textAlign: 'center',
              color: 'var(--dsw-alias-label-secondary)',
              fontSize: '13px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            },
          },
          react.createElement('span', { style: { fontSize: '24px' } }, '🖼️'),
          react.createElement('p', null, t('gallery.empty')),
          react.createElement(
            'button',
            {
              type: 'button',
              onClick: loadHistory,
              className: 'ig-tab-btn',
              style: { border: '1px solid var(--dsw-alias-border-l2)', marginTop: '6px' },
            },
            '🔄 Refresh'
          )
        )
      }

      return react.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' } },
        react.createElement(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '6px' } },
          react.createElement('span', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--dsw-alias-label-primary)' } }, t('gallery.title') + ' (' + items.length + ')'),
          react.createElement('button', { type: 'button', onClick: loadHistory, className: 'ig-tab-btn', style: { padding: '3px 8px', fontSize: '12px' } }, '🔄 Refresh')
        ),
        react.createElement(
          'div',
          {
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: '10px',
              maxHeight: '480px',
              overflowY: 'auto',
              padding: '2px',
            },
          },
          items.map((item, idx) => {
            const thumb = item.thumbnailUrl || (item.attachmentId ? '/dsh-image-gen/image?id=' + encodeURIComponent(item.attachmentId) : '')
            return react.createElement(
              'div',
              {
                key: item.attachmentId || item.path || idx,
                onClick: () => setSelected(item),
                style: {
                  position: 'relative',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: '1px solid var(--dsw-alias-border-l2)',
                  background: 'var(--dsw-alias-bg-layer-2)',
                  cursor: 'pointer',
                  aspectRatio: '1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                },
              },
              thumb
                ? react.createElement('img', {
                    src: thumb,
                    alt: item.prompt || 'Generated image',
                    loading: 'lazy',
                    style: { width: '100%', height: '100%', objectFit: 'cover' },
                  })
                : react.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, '🖼️'),
              react.createElement(
                'div',
                {
                  style: {
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: '4px 6px',
                    background: 'linear-gradient(transparent, var(--dsw-alias-overlay-scrim,rgba(0,0,0,0.8)))',
                    fontSize: '10px',
                    color: 'var(--dsw-alias-label-on-overlay,#fff)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                },
                item.prompt || 'Untitled'
              )
            )
          })
        ),
        selected &&
          react.createElement(
            'div',
            {
              style: {
                position: 'fixed',
                inset: 0,
                background: 'var(--dsw-alias-overlay-backdrop,rgba(0,0,0,0.7))',
                zIndex: 10000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px',
              },
              onClick: () => setSelected(null),
            },
            react.createElement(
              'div',
              {
                style: {
                  background: 'var(--dsw-alias-bg-layer-3)',
                  border: '1px solid var(--dsw-alias-border-l2)',
                  borderRadius: '12px',
                  maxWidth: '560px',
                  width: '100%',
                  maxHeight: '90vh',
                  overflowY: 'auto',
                  padding: '18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                },
                onClick: (e) => e.stopPropagation(),
              },
              react.createElement(
                'div',
                { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                react.createElement('span', { style: { fontWeight: '700', fontSize: '14px', color: 'var(--dsw-alias-label-primary)' } }, t('gallery.inspector')),
                react.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: () => setSelected(null),
                    style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'var(--dsw-alias-label-secondary)' },
                  },
                  '✕'
                )
              ),
              react.createElement('img', {
                src: selected.thumbnailUrl || (selected.attachmentId ? '/dsh-image-gen/image?id=' + encodeURIComponent(selected.attachmentId) : ''),
                style: { width: '100%', borderRadius: '8px', maxHeight: '340px', objectFit: 'contain', background: 'var(--dsw-alias-bg-layer-1,#0a0a0c)' },
              }),
              react.createElement(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '11px' } },
                selected.seed !== undefined && react.createElement('span', { className: 'ig-badge' }, 'Seed: ' + selected.seed),
                selected.provider && react.createElement('span', { className: 'ig-badge' }, 'Provider: ' + selected.provider),
                selected.width && react.createElement('span', { className: 'ig-badge' }, selected.width + '×' + selected.height),
                selected.cost ? react.createElement('span', { className: 'ig-badge' }, '$' + Number(selected.cost).toFixed(4)) : null
              ),
              react.createElement(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                react.createElement('span', { style: { fontSize: '11px', fontWeight: '600', color: 'var(--dsw-alias-label-secondary)' } }, 'Prompt:'),
                react.createElement(
                  'p',
                  {
                    style: {
                      fontSize: '12px',
                      color: 'var(--dsw-alias-label-primary)',
                      lineHeight: '1.4',
                      background: 'var(--dsw-alias-bg-layer-2)',
                      padding: '8px',
                      borderRadius: '6px',
                      margin: 0,
                    },
                  },
                  selected.prompt || 'No prompt recorded'
                )
              ),
              react.createElement(
                'div',
                { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' } },
                react.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'ig-tab-btn',
                    style: { border: '1px solid var(--dsw-alias-border-l2)' },
                    onClick: () => {
                      if (typeof navigator !== 'undefined' && navigator.clipboard && selected.prompt) {
                        navigator.clipboard.writeText(selected.prompt)
                        setCopiedPrompt(true)
                        setTimeout(() => setCopiedPrompt(false), 2000)
                      }
                    },
                  },
                  copiedPrompt ? '✓ Copied!' : t('gallery.copy_prompt')
                ),
                react.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'ig-save-btn',
                    onClick: () => {
                      const url = selected.thumbnailUrl || (selected.attachmentId ? '/dsh-image-gen/image?id=' + encodeURIComponent(selected.attachmentId) : '')
                      if (typeof navigator !== 'undefined' && navigator.clipboard && url) {
                        navigator.clipboard.writeText('![' + (selected.prompt || 'Image') + '](' + url + ')')
                        setCopiedLink(true)
                        setTimeout(() => setCopiedLink(false), 2000)
                      }
                    },
                  },
                  copiedLink ? '✓ Copied!' : t('gallery.copy_link')
                )
              )
            )
          )
      )
    }

    // -------------------------------------------------------------- Header Quick-Access Chip
    function GalleryHeaderChip(props) {
      const [open, setOpen] = react.useState(false)
      return react.createElement(
        'div',
        { style: { display: 'inline-flex', alignItems: 'center', position: 'relative' } },
        react.createElement(
          'button',
          {
            type: 'button',
            title: 'Image Studio Gallery',
            onClick: () => setOpen(!open),
            style: {
              appearance: 'none',
              background: 'none',
              border: '1px solid var(--dsw-alias-border-l2)',
              borderRadius: '6px',
              padding: '4px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '12px',
              color: 'var(--dsw-alias-label-secondary)',
            },
          },
          react.createElement('span', null, '🖼️'),
          react.createElement('span', null, 'Gallery')
        ),
        open &&
          react.createElement(
            'div',
            {
              style: {
                position: 'fixed',
                top: '56px',
                right: '16px',
                width: '380px',
                maxHeight: '520px',
                background: 'var(--dsw-alias-bg-layer-3)',
                border: '1px solid var(--dsw-alias-border-l2)',
                borderRadius: '12px',
                boxShadow: 'var(--dsw-alias-shadow-overlay,0 8px 32px rgba(0,0,0,0.4))',
                zIndex: 9999,
                padding: '16px',
                overflowY: 'auto',
              },
            },
            react.createElement(
              'div',
              { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' } },
              react.createElement('span', { style: { fontWeight: '700', fontSize: '14px', color: 'var(--dsw-alias-label-primary)' } }, 'Image Studio Gallery'),
              react.createElement(
                'button',
                {
                  type: 'button',
                  onClick: () => setOpen(false),
                  style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: 'var(--dsw-alias-label-secondary)' },
                },
                '✕'
              )
            ),
            react.createElement(GalleryView, { ctx: props.ctx })
          )
      )
    }

