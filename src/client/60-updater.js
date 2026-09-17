    // -------------------------------------------------------------- Updater Section
    function UpdaterSection(props) {
      const t = props.t || ((k) => k)
      const [status, setStatus] = react.useState(null)
      const [loading, setLoading] = react.useState(false)
      const [updating, setUpdating] = react.useState(false)
      const [msg, setMsg] = react.useState(null)

      const checkUpdate = react.useCallback(async () => {
        setLoading(true)
        setMsg(null)
        try {
          const res = await fetch('/api/dsh-image-gen/update', {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const data = await res.json()
          setStatus(data)
        } catch (e) {
          setMsg({ ok: false, text: (t('updater.failed') || 'Update check failed: ') + (e?.message || String(e)) })
        } finally {
          setLoading(false)
        }
      }, [t])

      const onUpdateNow = async () => {
        setUpdating(true)
        setMsg(null)
        try {
          const res = await fetch('/api/dsh-image-gen/update', {
            method: 'POST',
            headers: {
              'x-dsh-plugin-update': '1',
              'content-type': 'application/json',
            },
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data?.error || 'HTTP ' + res.status)
          setStatus(data)
          setMsg({ ok: true, text: t('updater.success') || 'Plugin updated successfully! Restart DSH to apply.' })
        } catch (e) {
          setMsg({ ok: false, text: e?.message || String(e) })
        } finally {
          setUpdating(false)
        }
      }

      react.useEffect(() => {
        checkUpdate()
      }, [checkUpdate])

      const currentVer = status?.currentVersion || '0.10.22'
      const latestVer = status?.latestVersion
      const updateAvailable = Boolean(status?.updateAvailable && latestVer && latestVer !== currentVer)

      return react.createElement(
        'div',
        { className: 'ig-stat-box', style: { gap: '10px', marginTop: '12px' } },
        react.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } },
          react.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            react.createElement('span', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, '🔄 ' + t('updater.title')),
            react.createElement('span', { className: 'ig-badge ' + (updateAvailable ? 'ig-badge-warn' : 'ig-badge-ok') },
              updateAvailable ? 'v' + latestVer + ' available' : 'v' + currentVer + ' (' + t('updater.upToDate') + ')'
            )
          ),
          react.createElement(
            'div',
            { style: { display: 'flex', gap: '8px' } },
            updateAvailable
              ? react.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'ig-btn ig-btn-primary',
                    style: { padding: '4px 10px', fontSize: '12px' },
                    onClick: onUpdateNow,
                    disabled: updating || loading,
                  },
                  updating ? (t('updater.updating') || 'Updating…') : (t('updater.updateNow') || 'Update now').replace('{version}', latestVer)
                )
              : null,
            react.createElement(
              'button',
              {
                type: 'button',
                className: 'ig-btn',
                style: { padding: '4px 10px', fontSize: '12px' },
                onClick: checkUpdate,
                disabled: loading || updating,
              },
              loading ? (t('updater.checking') || 'Checking…') : (t('updater.check') || 'Check updates')
            )
          )
        ),
        msg
          ? react.createElement('div', { className: msg.ok ? 'ig-alert-ok' : 'ig-alert-bad', style: { padding: '6px 10px', fontSize: '12px' } }, msg.text)
          : null
      )
    }

    // -------------------------------------------------------------- Diagnostics Panel
