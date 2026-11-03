    // -------------------------------------------------------------- Image Revision History (#148, #500)
    const REVISION_STORAGE_PREFIX = 'dsh_image_gen_revisions:'
    const MAX_STORED_REVISIONS = 20

    function loadStoredRevisions(cardId) {
      if (!cardId || typeof window === 'undefined' || !window.localStorage) return []
      try {
        const raw = window.localStorage.getItem(REVISION_STORAGE_PREFIX + cardId)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }

    function saveStoredRevisions(cardId, revisions) {
      if (!cardId || typeof window === 'undefined' || !window.localStorage) return
      try {
        const list = Array.isArray(revisions) ? revisions.slice(-MAX_STORED_REVISIONS) : []
        window.localStorage.setItem(REVISION_STORAGE_PREFIX + cardId, JSON.stringify(list))
      } catch (_) {
        /* localStorage unavailable or quota exceeded */
      }
    }

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

    // -------------------------------------------------------------- Interactive A/B Comparison Slider (#499)
    function ImageCompareSlider(props) {
      const t = props.t || ((k) => k)
      const beforeUrl = props.beforeUrl
      const afterUrl = props.afterUrl
      const beforeLabel = props.beforeLabel || t('card.before') || 'Before'
      const afterLabel = props.afterLabel || t('card.after') || 'After'
      const alt = props.alt || 'Comparison'

      const [position, setPosition] = react.useState(50)
      const [isDragging, setIsDragging] = react.useState(false)
      const containerRef = react.useRef(null)

      const updatePosition = react.useCallback((clientX) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        if (rect.width <= 0) return
        const x = clientX - rect.left
        const percent = Math.min(100, Math.max(0, (x / rect.width) * 100))
        setPosition(percent)
      }, [])

      const handleMouseDown = react.useCallback((e) => {
        e.preventDefault()
        setIsDragging(true)
        updatePosition(e.clientX)
      }, [updatePosition])

      react.useEffect(() => {
        if (!isDragging) return
        const handleMouseMove = (e) => updatePosition(e.clientX)
        const handleMouseUp = () => setIsDragging(false)
        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        return () => {
          window.removeEventListener('mousemove', handleMouseMove)
          window.removeEventListener('mouseup', handleMouseUp)
        }
      }, [isDragging, updatePosition])

      const handleTouchStart = react.useCallback((e) => {
        if (!e.touches || !e.touches[0]) return
        setIsDragging(true)
        updatePosition(e.touches[0].clientX)
      }, [updatePosition])

      const handleTouchMove = react.useCallback((e) => {
        if (!e.touches || !e.touches[0]) return
        updatePosition(e.touches[0].clientX)
      }, [updatePosition])

      const handleTouchEnd = react.useCallback(() => {
        setIsDragging(false)
      }, [])

      if (!beforeUrl || !afterUrl) return null

      return react.createElement(
        'div',
        {
          ref: containerRef,
          className: 'ig-ab-container',
          onTouchStart: handleTouchStart,
          onTouchMove: handleTouchMove,
          onTouchEnd: handleTouchEnd,
        },
        // After Image (Base Layer)
        react.createElement('img', {
          src: afterUrl,
          alt: alt + ' (After)',
          className: 'ig-ab-base-img',
          draggable: false,
        }),
        // Before Image (Clipped Overlay Layer)
        react.createElement(
          'div',
          {
            className: 'ig-ab-clip-wrap',
            style: { clipPath: `inset(0 ${100 - position}% 0 0)` },
          },
          react.createElement('img', {
            src: beforeUrl,
            alt: alt + ' (Before)',
            className: 'ig-ab-clip-img',
            draggable: false,
          })
        ),
        // Divider line & handle
        react.createElement(
          'div',
          {
            className: 'ig-ab-divider',
            style: { left: `${position}%` },
            onMouseDown: handleMouseDown,
          },
          react.createElement(
            'div',
            { className: 'ig-ab-handle' },
            '↔'
          )
        ),
        // Badges
        react.createElement('span', { className: 'ig-ab-badge ig-ab-badge-before' }, beforeLabel),
        react.createElement('span', { className: 'ig-ab-badge ig-ab-badge-after' }, afterLabel)
      )
    }
