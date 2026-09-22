// 106-style-matrix-view.js — 2×2 Style Matrix toolview with Blind A/B Compare (#286).

    function StyleMatrixCard(props) {
      const block = props.block || {}
      const parsed = react.useMemo(() => {
        const raw = block.output || block.text || ''
        const obj = tryParseJsonObject(raw)
        return obj || { base_prompt: '', blind_mode: false, cells: [] }
      }, [block])

      const [blind, setBlind] = react.useState(Boolean(parsed.blind_mode))
      const [copiedId, setCopiedId] = react.useState(null)
      const [previewImg, setPreviewImg] = react.useState(null)

      const cells = parsed.cells || []

      function handleSelectStyle(c) {
        const styleName = c.style || 'chosen_style'
        const instruction = 'Set style preset to "' + styleName + '" for subsequent image generations.'
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(instruction)
          setCopiedId(c.id)
          setTimeout(() => setCopiedId(null), 2500)
        }
      }

      const cellNodes = cells.map((c) => {
        const imgUrl = c.url || (c.attachment && attachmentImageUrl(c.attachment)) || ''
        const styleLabel = blind ? ('Option ' + c.id) : c.style
        const isCopied = copiedId === c.id

        return react.createElement(
          'div',
          { key: c.id, className: 'ig-matrix-cell' },
          imgUrl ? react.createElement('img', {
            src: imgUrl,
            alt: styleLabel,
            className: 'ig-matrix-img',
            onClick: () => setPreviewImg(imgUrl),
          }) : react.createElement('div', { style: { height: '140px', background: 'var(--dsw-alias-bg-layer-2)' } }),
          react.createElement(
            'div',
            { className: 'ig-matrix-bar' },
            react.createElement(
              'span',
              { style: { fontWeight: '600', color: 'var(--dsw-alias-label-primary)' } },
              '[' + c.id + '] ' + styleLabel
            ),
            react.createElement(
              'button',
              {
                type: 'button',
                className: 'ig-btn',
                style: { padding: '2px 8px', fontSize: '11px' },
                onClick: () => handleSelectStyle(c),
              },
              isCopied ? (t('matrix.copied') || '✓ Selected!') : ('⭐ ' + (t('matrix.use_style') || 'Use Style'))
            )
          )
        )
      })

      return react.createElement(
        'div',
        { className: 'ig-section-card', style: { margin: '8px 0' } },
        react.createElement(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          react.createElement(
            'span',
            { className: 'ig-section-title' },
            '⚡ ' + (t('matrix.title') || 'Style Matrix Benchmark (2×2)')
          ),
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-tab-btn',
              style: { padding: '4px 10px', fontSize: '12px' },
              onClick: () => setBlind(!blind),
            },
            blind ? ('🙈 ' + (t('matrix.blind_toggle') || 'Reveal Styles')) : '👁️ Mask Styles (Blind)'
          )
        ),
        parsed.base_prompt ? react.createElement('div', { className: 'ig-prompt' }, parsed.base_prompt) : null,
        react.createElement('div', { className: 'ig-matrix-grid' }, cellNodes),
        previewImg ? react.createElement(
          'div',
          {
            style: {
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.85)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 99999,
              cursor: 'zoom-out',
            },
            onClick: () => setPreviewImg(null),
          },
          react.createElement('img', {
            src: previewImg,
            alt: 'Enlarged Preview',
            style: { maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px' },
          })
        ) : null
      )
    }
