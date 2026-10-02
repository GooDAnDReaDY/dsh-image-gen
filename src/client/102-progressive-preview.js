    // -------------------------------------------------------------- Progressive Draft & Live Progress Preview (#147, #329, #379)
    function ProgressiveImagePreview(props) {
      const src = props.src
      const isRunning = props.isRunning
      const callId = props.callId
      const alt = props.alt || 'Generated image'
      const t = props.t || ((k) => k)

      const [loaded, setLoaded] = react.useState(false)
      const [liveState, setLiveState] = react.useState({
        progress: undefined,
        step: undefined,
        stage: undefined,
        draftSrc: '',
      })

      react.useEffect(() => {
        setLoaded(false)
      }, [src])

      // Subscribe to live events transport when running and callId is present (#379)
      react.useEffect(() => {
        const EventSourceImpl = typeof window !== 'undefined' ? window.EventSource : undefined
        if (!isRunning || !callId || !EventSourceImpl) {
          return
        }
        let es
        try {
          es = new EventSourceImpl('/dsh-image-gen/live-events?callId=' + encodeURIComponent(callId))
          es.onmessage = (e) => {
            try {
              const data = JSON.parse(e.data)
              if (!data) return
              setLiveState((prev) => ({
                progress: typeof data.progress === 'number' ? Math.min(100, Math.max(0, data.progress)) : prev.progress,
                step: data.step !== undefined ? data.step : prev.step,
                stage: data.stage !== undefined ? data.stage : prev.stage,
                draftSrc: data.draftUrl || prev.draftSrc,
              }))
            } catch (_err) {
              // Ignore event parsing errors
            }
          }
          es.onerror = () => {
            // EventSource handles retries or terminates on close
          }
        } catch (_err) {
          // Ignore EventSource creation errors
        }

        return () => {
          if (es) {
            try {
              es.close()
            } catch (_err) {
              // Ignore EventSource close errors
            }
          }
        }
      }, [isRunning, callId])

      const draftSrc = liveState.draftSrc || props.draftSrc
      const progress = liveState.progress !== undefined
        ? liveState.progress
        : (typeof props.progress === 'number' ? Math.min(100, Math.max(0, props.progress)) : undefined)
      const step = liveState.step !== undefined ? liveState.step : props.step
      const stage = liveState.stage
        || props.stage
        || (progress !== undefined && progress < 100 ? (t('card.rendering') || 'Rendering...') : (isRunning ? (t('card.generating') || 'Generating...') : 'Complete'))

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
            className: 'ig-progress-fill' + (progress === undefined ? ' ig-progress-indeterminate' : ''),
            style: progress !== undefined ? { width: progress + '%' } : undefined,
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
