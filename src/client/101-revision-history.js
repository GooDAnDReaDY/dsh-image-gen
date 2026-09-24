    // -------------------------------------------------------------- Image Revision History (#148)
    function ImageRevisionBar(props) {
      const revisions = props.revisions
      const activeIndex = props.activeIndex
      const onSelect = props.onSelect
      const t = props.t || ((k) => k)

      if (!Array.isArray(revisions) || revisions.length <= 1) return null

      const current = revisions[activeIndex] || {}
      const hasPrev = activeIndex > 0
      const hasNext = activeIndex < revisions.length - 1

      return react.createElement(
        'div',
        { className: 'ig-rev-bar', role: 'navigation', 'aria-label': t('card.revisions') || 'Image revisions' },
        react.createElement(
          'div',
          { className: 'ig-rev-controls' },
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-rev-btn',
              disabled: !hasPrev,
              onClick: () => onSelect(activeIndex - 1),
              title: t('card.prevRevision') || 'Previous revision',
            },
            '◀'
          ),
          react.createElement(
            'span',
            { style: { fontWeight: '600', color: 'var(--dsw-alias-label-primary)' } },
            `v${activeIndex + 1} / ${revisions.length}`
          ),
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-rev-btn',
              disabled: !hasNext,
              onClick: () => onSelect(activeIndex + 1),
              title: t('card.nextRevision') || 'Next revision',
            },
            '▶'
          )
        ),
        react.createElement(
          'div',
          { className: 'ig-rev-badge' },
          current.seed !== undefined ? `seed: ${current.seed}` : (current.timestamp ? new Date(current.timestamp).toLocaleTimeString() : '')
        )
      )
    }