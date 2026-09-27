    // -------------------------------------------------------------- Progressive Draft & Live Progress Preview (#147, #329)
    function ProgressiveImagePreview(props) {
      const src = props.src
      const draftSrc = props.draftSrc
      const isRunning = props.isRunning
      const progress = typeof props.progress === 'number' ? Math.min(100, Math.max(0, props.progress)) : undefined
      const step = props.step
      const stage = props.stage || (progress !== undefined && progress < 100 ? 'Rendering...' : 'Complete')
      const alt = props.alt || 'Generated image'
      const t = props.t || ((k) => k)

      const [loaded, setLoaded] = react.useState(false)

      react.useEffect(() => {
        setLoaded(false)
      }, [src])

      const showProgress = isRunning || (progress !== undefined && progress < 100)

      const progressElement = showProgress ? react.createElement(
        'div',
        { className: 'ig-progress-container' },
        react.createElement(
          'div',
          { className: 'ig-progress-meta' },
          react.createElement('span', null, '⚡ ' + stage + (step ? ' (' + step + ')' : '')),
          progress !== undefined ? react.createElement('span', { style: { fontWeight: '700', color: 'var(--dsw-alias-state-brand)' } }, Math.round(progress) + '%') : null
        ),
        react.createElement(
          'div',
          { className: 'ig-progress-track' },
          react.createElement('div', {
            className: 'ig-progress-fill',
            style: { width: (progress !== undefined ? progress : 45) + '%' },
          })
        )
      ) : null

      if (showProgress && !src && draftSrc) {
        return react.createElement(
          'div',
          { className: 'ig-progressive-wrap' },
          react.createElement('img', {
            src: draftSrc,
            alt: alt + ' (preview)',
            className: 'ig-draft-img',
          }),
          react.createElement(
            'div',
            { className: 'ig-draft-overlay' },
            '⚡ ' + (t('card.draftPreview') || 'Rendering draft...')
          ),
          progressElement
        )
      }

      if (!src && !draftSrc && showProgress) {
        return progressElement
      }

      if (!src && !draftSrc) return null

      return react.createElement(
        'div',
        { className: 'ig-progressive-wrap', style: { minHeight: 'auto' } },
        draftSrc && !loaded ? react.createElement('img', {
          src: draftSrc,
          alt: alt + ' (draft)',
          className: 'ig-draft-img',
        }) : null,
        src ? react.createElement('img', {
          src,
          alt,
          loading: 'lazy',
          className: 'ig-final-img',
          style: { opacity: loaded || !draftSrc ? 1 : 0.8 },
          onLoad: () => setLoaded(true),
        }) : null,
        progressElement
      )
    }
