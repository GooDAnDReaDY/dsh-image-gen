    const IMAGE_URL_RE = /https?:\/\/[^\s)]+\.(png|jpg|jpeg|webp|gif)(\?[^\s)]*)?/i

    function readResult(block) {
      if (!block) return { text: '', url: '', attachment: null }
      const text = block.output || block.text || ''
      const attachment = block.attachment || (block.attachments && block.attachments[0]) || null
      const linked = text.match(IMAGE_URL_RE)
      return {
        attachment,
        url: linked ? linked[0] : '',
        text: linked ? text.replace(linked[0], '').trim() : text,
      }
    }

    function FalImageCard(props) {
      const block = props.block
      const running = !('kind' in (block || {}))
      const failed = block && (block.isError || block.error !== undefined)
      const parsed = readResult(block)
      const t = props.t || ((k) => k)
      const [remixOpen, setRemixOpen] = react.useState(false)
      const [remixStrength, setRemixStrength] = react.useState(0.45)
      const [remixPrompt, setRemixPrompt] = react.useState('')
      const [copiedRemix, setCopiedRemix] = react.useState(false)

      react.useEffect(() => {
        ensureCss()
      }, [])

      let args = {}
      let prompt = ''
      try {
        const raw = (block && (block.call ? block.call.argsRaw : block.argsRaw)) || ''
        if (raw) {
          args = JSON.parse(raw)
          prompt = args.prompt || ''
        }
      } catch (_) { /* malformed tool args; use empty prompt */ }

      const [copied, setCopied] = react.useState(false)

      const sendActionPrompt = async (text) => {
        try {
          const sessions = props.sessions
          const current = sessions && sessions.list && sessions.list.current
          const binding = current && sessions.binding(current)
          const session = binding && binding.session
          if (session && session.prompt) await session.prompt([{ type: 'text', text }], 'queue')
        } catch (_) { /* session prompt delivery failed; non-fatal */ }
      }

      const onCopyPrompt = () => {
        if (prompt && typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(prompt)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }
      }

      const onReroll = () => {
        const nextSeed = typeof args.seed === 'number' ? args.seed + 1 : Math.floor(Math.random() * 100000)
        sendActionPrompt(t('card.actionReroll') + ' (' + nextSeed + '): ' + (prompt || ''))
      }

      const onUpscale = () => {
        const ref = parsed.attachment ? (parsed.attachment.attachmentId || parsed.attachment.id) : (parsed.url || '')
        sendActionPrompt(t('card.actionUpscale') + ': upscale_image(image: "' + ref + '")')
      }

      const onRemoveBg = () => {
        const ref = parsed.attachment ? (parsed.attachment.attachmentId || parsed.attachment.id) : (parsed.url || '')
        sendActionPrompt(t('card.actionRemoveBg') + ': remove_background(image: "' + ref + '")')
      }

      const head = react.createElement(
        'div',
        { className: 'fal_head' },
        running ? '⏳ ' + t('card.generating') : failed ? '❌ ' + t('card.failed') : '🖼️ ' + t('card.image')
      )

      const body = []
      if (prompt) {
        body.push(react.createElement('div', { className: 'ig-prompt', key: 'p' }, prompt))
      }
      if (failed) {
        body.push(react.createElement('div', { className: 'ig-err', key: 'e' }, parsed.text || t('card.unknownError')))
      } else if (!parsed.attachment && parsed.url) {
        body.push(react.createElement('img', {
          key: 'i',
          src: parsed.url,
          alt: prompt || 'generated image',
          loading: 'lazy',
          style: { maxWidth: '100%', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)' },
        }))
      } else if (parsed.attachment) {
        const a = parsed.attachment
        const query = 'id=' + encodeURIComponent(a.attachmentId ?? a.id ?? '')
          + '&mt=' + encodeURIComponent(a.mediaType || 'image/png')
          + '&b=' + encodeURIComponent(String(a.bytes ?? 0))
          + '&w=' + encodeURIComponent(String(a.width ?? 0))
          + '&h=' + encodeURIComponent(String(a.height ?? 0))
        body.push(react.createElement('img', {
          key: 'i',
          src: '/dsh-image-gen/image?' + query,
          alt: prompt || 'generated image',
          loading: 'lazy',
          style: { maxWidth: '100%', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)' },
        }))
      }

      const actions = []
      if (!running && !failed && (parsed.url || parsed.attachment)) {
        actions.push(
          react.createElement('button', { key: 'remix', type: 'button', className: 'ig-btn', onClick: () => setRemixOpen(!remixOpen) }, '⚡ ' + (t('card.remix') || 'Remix')),
          react.createElement('button', { key: 'reroll', type: 'button', className: 'ig-btn', onClick: onReroll }, '🎲 ' + t('card.reroll')),
          react.createElement('button', { key: 'upscale', type: 'button', className: 'ig-btn', onClick: onUpscale }, '🔍 ' + t('card.upscale')),
          react.createElement('button', { key: 'removeBg', type: 'button', className: 'ig-btn', onClick: onRemoveBg }, '✂️ ' + t('card.removeBg')),
          react.createElement('button', { key: 'copy', type: 'button', className: 'ig-btn', onClick: onCopyPrompt }, copied ? '✓ Copied' : '📋 ' + t('card.copyPrompt'))
        )
      }

      const remixDrawer = remixOpen ? react.createElement(
        'div',
        {
          style: {
            marginTop: '10px',
            padding: '12px 14px',
            borderRadius: '8px',
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          },
        },
        react.createElement(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          react.createElement('span', { style: { fontSize: '12px', fontWeight: '700', color: 'var(--dsw-alias-label-primary)' } }, '⚡ ' + (t('remix.drawer_title') || 'Variations & Style Remix Workbench')),
          react.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-brand)' } }, 'Creativity: ' + remixStrength)
        ),
        react.createElement('input', {
          type: 'range',
          min: '0.1',
          max: '0.9',
          step: '0.05',
          value: remixStrength,
          onChange: (e) => setRemixStrength(parseFloat(e.target.value)),
          style: { width: '100%', cursor: 'pointer' },
        }),
        react.createElement('input', {
          type: 'text',
          placeholder: t('remix.prompt_placeholder') || 'Describe remix changes (e.g. cyberpunk neon, watercolor)...',
          value: remixPrompt,
          onChange: (e) => setRemixPrompt(e.target.value),
          className: 'ig-field-input',
          style: { fontSize: '12px', padding: '6px 10px' },
        }),
        react.createElement(
          'div',
          { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '4px' } },
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-tab-btn',
              style: { padding: '4px 8px', fontSize: '11px' },
              onClick: () => setRemixStrength(0.25),
            },
            t('remix.subtle_btn') || 'Subtle (0.25)'
          ),
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-tab-btn',
              style: { padding: '4px 8px', fontSize: '11px' },
              onClick: () => setRemixStrength(0.65),
            },
            t('remix.creative_btn') || 'Creative (0.65)'
          ),
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-save-btn',
              style: { padding: '4px 10px', fontSize: '11px' },
              onClick: () => {
                const targetRef = parsed.attachment?.attachmentId || parsed.url || 'current image'
                const cmd = `Use remix_image on "${targetRef}" with prompt: "${remixPrompt || 'variation of this image'}" and creativity: ${remixStrength}`
                if (typeof navigator !== 'undefined' && navigator.clipboard) {
                  navigator.clipboard.writeText(cmd)
                  setCopiedRemix(true)
                  setTimeout(() => setCopiedRemix(false), 2000)
                }
              },
            },
            copiedRemix ? (t('remix.copied') || '✓ Copied!') : (t('remix.copy_instruction') || '📋 Copy Instruction')
          )
        )
      ) : null

      return react.createElement(
        'div',
        { className: 'ig-section-card', style: { margin: '8px 0' } },
        head,
        body,
        actions.length > 0 ? react.createElement('div', { className: 'ig-row', style: { marginTop: '8px' } }, actions) : null,
        remixDrawer
      )
    }

    // -------------------------------------------------------------- Dictionaries
