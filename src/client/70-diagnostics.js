    function DiagnosticsPanel(props) {
      const t = props.t || ((k) => k)
      const [testing, setTesting] = react.useState(false)
      const [result, setResult] = react.useState(null)

      const handleTest = async () => {
        setTesting(true)
        setResult(null)
        try {
          const res = await fetch('/dsh-image-gen/diagnostics/test?provider=' + encodeURIComponent(props.provider || 'fal'))
          const data = await res.json()
          setResult(data)
        } catch (e) {
          setResult({ ok: false, message: e.message })
        } finally {
          setTesting(false)
        }
      }

      return react.createElement(
        'div',
        {
          style: {
            padding: '10px 14px',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: '8px',
            background: 'var(--dsw-alias-bg-layer-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '12px',
          },
        },
        react.createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          react.createElement('span', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--dsw-alias-label-primary)' } }, t('diagnostics.title')),
          result
            ? react.createElement(
                'span',
                {
                  style: {
                    fontSize: '12px',
                    fontWeight: '500',
                    color: result.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)',
                  },
                },
                (result.ok ? '🟢 ' : '🔴 ') + (result.message || (result.ok ? t('diagnostics.ready') : 'Failed')) + (result.latencyMs ? ' (' + result.latencyMs + 'ms)' : '')
              )
            : react.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, t('diagnostics.desc'))
        ),
        react.createElement(
          'button',
          {
            type: 'button',
            disabled: testing,
            onClick: handleTest,
            className: 'ig-save-btn',
            style: { padding: '5px 12px', fontSize: '12px', opacity: testing ? 0.7 : 1 },
          },
          testing ? t('diagnostics.testing') : t('diagnostics.test')
        )
      )
    }

    // -------------------------------------------------------------- Gallery View
