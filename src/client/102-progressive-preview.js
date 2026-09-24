    // -------------------------------------------------------------- Progressive Draft Preview (#147)
    function ProgressiveImagePreview(props) {
      const src = props.src
      const draftSrc = props.draftSrc
      const isRunning = props.isRunning
      const alt = props.alt || 'Generated image'
      const t = props.t || ((k) => k)

      const [loaded, setLoaded] = react.useState(false)

      react.useEffect(() => {
        setLoaded(false)
      }, [src])

      if (isRunning && !src && draftSrc) {
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
          )
        )
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
        }) : null
      )
    }