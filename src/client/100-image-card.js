    const HTTP_IMAGE_URL_RE = /https?:\/\/[^\s)]+\.(png|jpg|jpeg|webp|gif)(\?[^\s)]*)?/i
    const RELATIVE_IMAGE_URL_RE = /(\/dsh-image-gen\/image\?[^\s)"'<>]+)/i
    const MARKDOWN_IMAGE_RE = /!\[.*?\]\(((\/|https?:\/\/)[^\s)]+)\)/i
    const MARKDOWN_LINK_RE = /\[.*?\]\(((\/|https?:\/\/)[^\s)]+)\)/i

    function readResult(block) {
      if (!block) return { text: '', url: '', attachment: null }
      const text = block.output || block.text || ''
      const meta = block.presentationMeta || block.meta || block.data || block.result || null

      let attachment = block.attachment
        || (Array.isArray(block.attachments) && block.attachments[0])
        || meta?.attachment
        || null

      let url = meta?.url || block.url || ''

      if (!url && attachment) {
        url = attachmentImageUrl(attachment)
      }

      let beforeUrl = meta?.beforeUrl || meta?.before_url || meta?.before_image || block.beforeUrl || block.before_url || ''
      if (!beforeUrl && meta?.sourceUrl) beforeUrl = meta.sourceUrl
      if (beforeUrl && typeof beforeUrl === 'object') {
        beforeUrl = attachmentImageUrl(beforeUrl)
      } else if (beforeUrl && typeof beforeUrl === 'string' && !beforeUrl.startsWith('http') && !beforeUrl.startsWith('/') && !beforeUrl.startsWith('data:')) {
        beforeUrl = '/dsh-image-gen/image?id=' + encodeURIComponent(beforeUrl)
      }

      let cleanText = text
      if (!url && text) {
        const mdImg = text.match(MARKDOWN_IMAGE_RE)
        const relUrl = text.match(RELATIVE_IMAGE_URL_RE)
        const httpUrl = text.match(HTTP_IMAGE_URL_RE)
        const mdLink = text.match(MARKDOWN_LINK_RE)

        if (mdImg) {
          url = mdImg[1]
          cleanText = text.replace(mdImg[0], '').trim()
        } else if (relUrl) {
          url = relUrl[1]
          cleanText = text.replace(relUrl[0], '').trim()
        } else if (httpUrl) {
          url = httpUrl[0]
          cleanText = text.replace(httpUrl[0], '').trim()
        } else if (mdLink) {
          url = mdLink[1]
          cleanText = text.replace(mdLink[0], '').trim()
        }
      }

      return {
        attachment,
        url,
        beforeUrl,
        text: cleanText,
      }
    }

    function tryParseJsonObject(text) {
      if (typeof text !== 'string') return null
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start < 0 || end <= start) return null
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch (_) {
        return null
      }
    }

    function attachmentImageUrl(a) {
      if (!a) return ''
      if (a.url && typeof a.url === 'string') return a.url
      const query = 'id=' + encodeURIComponent(a.attachmentId ?? a.id ?? '')
        + '&mt=' + encodeURIComponent(a.mediaType || 'image/png')
        + '&b=' + encodeURIComponent(String(a.bytes ?? 0))
        + '&w=' + encodeURIComponent(String(a.width ?? 0))
        + '&h=' + encodeURIComponent(String(a.height ?? 0))
      return '/dsh-image-gen/image?' + query
    }

    function readResponsiveImages(block) {
      if (!block) return []
      const text = String(block.output || block.text || '')
      const tagMatch = text.match(/<dsh-image-gen-responsive>([\s\S]*?)<\/dsh-image-gen-responsive>/)
      const bag = [
        block.images,
        block.result && block.result.images,
        block.data && block.data.images,
        tagMatch && tryParseJsonObject(tagMatch[1])?.images,
        tryParseJsonObject(text)?.images,
        tryParseJsonObject(block.result)?.images,
      ]
      for (const list of bag) {
        if (!Array.isArray(list)) continue
        const images = list
          .map((item, index) => {
            if (!item || typeof item !== 'object') return null
            const attachment = item.attachment || null
            const url = attachmentImageUrl(attachment) || item.url || ''
            const rawDevice = String(item.device || '').toLowerCase()
            const device = ['mobile', 'tablet', 'desktop'].includes(rawDevice) ? rawDevice : `device-${index + 1}`
            const label = item.label || (device === 'mobile' ? 'Mobile' : device === 'tablet' ? 'Tablet' : device === 'desktop' ? 'Desktop' : `#${index + 1}`)
            return {
              device,
              label,
              aspect: item.aspect || '',
              width: item.width || (attachment && attachment.width) || 0,
              height: item.height || (attachment && attachment.height) || 0,
              url,
              attachment,
              path: item.path || '',
              seed: item.seed,
            }
          })
          .filter(Boolean)
        if (images.length >= 2) return images
      }
      return []
    }

    
    function FalApprovalCard(props) {
      const approval = props.approval || {}
      const callId = props.callId || approval.callId || ''
      const t = props.t || ((k) => k)
      const sendActionPrompt = props.sendActionPrompt
      const [status, setStatus] = react.useState('pending')
      const [acting, setActing] = react.useState(false)

      const handleApprove = async () => {
        setActing(true)
        try {
          if (callId) {
            await fetchJson('/dsh-image-gen/approval?callId=' + encodeURIComponent(callId) + '&action=approve', { method: 'POST' })
          }
          setStatus('approved')
        } catch (_) {
          if (sendActionPrompt && approval.originalPrompt) {
            sendActionPrompt((t('approval.confirmPrompt') || 'Generate image confirmed: generate_image(prompt: "{p}", approved: true)').replace('{p}', approval.originalPrompt))
          }
          setStatus('approved')
        } finally {
          setActing(false)
        }
      }

      const handleReject = async () => {
        setActing(true)
        try {
          if (callId) {
            await fetchJson('/dsh-image-gen/approval?callId=' + encodeURIComponent(callId) + '&action=reject', { method: 'POST' })
          }
          setStatus('rejected')
        } catch (_) {
          setStatus('rejected')
        } finally {
          setActing(false)
        }
      }

      return react.createElement(
        'div',
        { className: 'ig-approval-card' },
        react.createElement(
          'div',
          { className: 'ig-approval-head' },
          react.createElement('span', null, '⏸️ ' + (t('approval.title') || 'Interactive Generation Approval Required')),
          approval.estimatedCost !== undefined
            ? react.createElement('span', { className: 'ig-badge ig-badge-warn' }, '$' + Number(approval.estimatedCost || 0).toFixed(4) + ' USD')
            : null
        ),
        react.createElement(
          'div',
          { className: 'ig-approval-body' },
          react.createElement('div', null, react.createElement('strong', null, (t('approval.promptLabel') || 'Prompt') + ': '), approval.prompt || approval.originalPrompt || ''),
          react.createElement('div', null, react.createElement('strong', null, (t('approval.modelLabel') || 'Model / Provider') + ': '), (approval.provider || 'fal') + ' / ' + (approval.model || 'default')),
          react.createElement('div', null, react.createElement('strong', null, (t('approval.aspectLabel') || 'Aspect / Size') + ': '), (approval.aspectRatio || 'default') + ' · ' + (approval.size || 'default') + ' (' + (approval.count || 1) + ' image' + (approval.count > 1 ? 's' : '') + ')')
        ),
        status === 'approved'
          ? react.createElement('div', { style: { marginTop: '8px', fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)', fontWeight: '600' } }, '🚀 ' + (t('approval.confirmed') || 'Generation approved by user!'))
          : status === 'rejected'
          ? react.createElement('div', { style: { marginTop: '8px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)', fontWeight: '600' } }, '❌ ' + (t('approval.cancelled') || 'Generation cancelled.'))
          : react.createElement(
              'div',
              { className: 'ig-approval-actions' },
              react.createElement(
                'button',
                {
                  type: 'button',
                  className: 'ig-btn ig-btn-primary',
                  disabled: acting,
                  onClick: handleApprove,
                },
                '🚀 ' + (t('approval.confirmBtn') || 'Confirm Generation')
              ),
              react.createElement(
                'button',
                {
                  type: 'button',
                  className: 'ig-btn',
                  disabled: acting,
                  onClick: handleReject,
                },
                '✏️ ' + (t('approval.editBtn') || 'Modify / Cancel')
              )
            )
      )
    }

    function FalImageCard(props) {
      const block = props.block
      const running = !('kind' in (block || {}))
      const failed = block && (block.isError || block.error !== undefined)
      const parsed = readResult(block)
      const responsiveImages = !failed && !running ? readResponsiveImages(block) : []
      const t = props.t || ((k) => k)
      const [remixOpen, setRemixOpen] = react.useState(false)
      const [inpaintOpen, setInpaintOpen] = react.useState(false)
      const [remixStrength, setRemixStrength] = react.useState(0.45)
      const [remixPrompt, setRemixPrompt] = react.useState('')
      const [copiedRemix, setCopiedRemix] = react.useState(false)
      const [responsiveTab, setResponsiveTab] = react.useState(0)
      const [copied, setCopied] = react.useState(false)
      const [compareActive, setCompareActive] = react.useState(false)
      const [regenerateOpen, setRegenerateOpen] = react.useState(false)
      const [regeneratePrompt, setRegeneratePrompt] = react.useState('')
      const [regenerateSeed, setRegenerateSeed] = react.useState('random')

      let args = {}
      let prompt = ''
      try {
        const raw = (block && (block.call ? block.call.argsRaw : block.argsRaw)) || ''
        if (raw) {
          args = JSON.parse(raw)
          prompt = args.prompt || ''
        }
      } catch (_) { /* malformed tool args */ }

      const cardId = (block && (block.id || block.callId || block.toolCallId)) || (parsed.attachment && (parsed.attachment.attachmentId || parsed.attachment.id)) || (prompt ? ('p_' + prompt.slice(0, 32)) : '')
      const initialUrl = parsed.attachment ? attachmentImageUrl(parsed.attachment) : parsed.url
      const [revisions, setRevisions] = react.useState(() => {
        const stored = cardId ? loadStoredRevisions(cardId) : []
        if (stored.length > 0) return stored
        return initialUrl ? [{ url: initialUrl, attachment: parsed.attachment, seed: args.seed, timestamp: Date.now() }] : []
      })
      const [activeRev, setActiveRev] = react.useState(() => {
        const stored = cardId ? loadStoredRevisions(cardId) : []
        return stored.length > 0 ? stored.length - 1 : 0
      })

      react.useEffect(() => {
        ensureCss()
      }, [])

      react.useEffect(() => {
        if (!initialUrl) return
        setRevisions((prev) => {
          if (prev.some((r) => r.url === initialUrl)) return prev
          const next = [...prev, { url: initialUrl, attachment: parsed.attachment, seed: args.seed, timestamp: Date.now() }]
          if (cardId) saveStoredRevisions(cardId, next)
          setActiveRev(next.length - 1)
          return next
        })
      }, [initialUrl, args.seed, cardId])

      const sendActionPrompt = async (text) => {
        try {
          const sessions = props.sessions
          const current = sessions && sessions.list && sessions.list.current
          const binding = current && sessions.binding(current)
          const session = binding && binding.session
          if (session && session.prompt) await session.prompt([{ type: 'text', text }], 'queue')
        } catch (_) { /* session prompt delivery failed */ }
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
        { className: 'ig-card-head' },
        running ? '⏳ ' + t('card.generating') : failed ? '❌ ' + t('card.failed') : '🖼️ ' + t('card.image')
      )

      const body = []
      if (prompt) {
        body.push(react.createElement('div', { className: 'ig-prompt', key: 'p' }, prompt))
      }
      if (failed) {
        body.push(react.createElement('div', { className: 'ig-err', key: 'e' }, parsed.text || t('card.unknownError')))
      } else if (responsiveImages.length) {
        const activeIdx = Math.min(responsiveTab, responsiveImages.length - 1)
        const active = responsiveImages[activeIdx]
        body.push(
          react.createElement(
            'div',
            { className: 'ig-tabs', role: 'tablist', 'aria-label': t('card.responsiveTabs') || 'Responsive viewports', key: 'rtabs' },
            responsiveImages.map((img, idx) =>
              react.createElement(
                'button',
                {
                  key: img.device,
                  type: 'button',
                  role: 'tab',
                  'aria-selected': idx === activeIdx,
                  className: idx === activeIdx ? 'ig-tab-btn ig-tab-btn-active' : 'ig-tab-btn',
                  onClick: () => setResponsiveTab(idx),
                },
                (img.label || img.device) + (img.aspect ? ' · ' + img.aspect : '')
              )
            )
          ),
          active && active.url ? react.createElement('img', {
            key: 'ri',
            src: active.url,
            alt: prompt || (active.label + ' responsive mockup'),
            loading: 'lazy',
            style: { maxWidth: '100%', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)' },
          }) : null,
          active ? react.createElement(
            'div',
            { key: 'rmeta', style: { marginTop: '6px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
            [active.width && active.height ? `${active.width}×${active.height}` : null, active.path ? String(active.path) : null].filter(Boolean).join(' · ')
          ) : null
        )
      } else {
        // Revision bar (#148)
        if (revisions.length > 1) {
          body.push(react.createElement(ImageRevisionBar, {
            key: 'revs',
            revisions,
            activeIndex: activeRev,
            onSelect: (idx) => setActiveRev(idx),
            t,
          }))
        }
        // Progressive preview (#147) & A/B Slider (#499)
        const currentRev = revisions[activeRev] || {}
        const displaySrc = currentRev.url || initialUrl

        let resolvedBeforeUrl = parsed.beforeUrl || block?.beforeUrl || ''
        if (!resolvedBeforeUrl && args.before_image && typeof args.before_image === 'string') {
          resolvedBeforeUrl = args.before_image.startsWith('http') || args.before_image.startsWith('/') ? args.before_image : '/dsh-image-gen/image?id=' + encodeURIComponent(args.before_image)
        }
        if (!resolvedBeforeUrl && args.image && typeof args.image === 'string') {
          resolvedBeforeUrl = args.image.startsWith('http') || args.image.startsWith('/') ? args.image : '/dsh-image-gen/image?id=' + encodeURIComponent(args.image)
        }
        if (!resolvedBeforeUrl && revisions.length > 1 && activeRev > 0) {
          resolvedBeforeUrl = revisions[0].url
        }

        if (compareActive && resolvedBeforeUrl && displaySrc) {
          body.push(react.createElement(ImageCompareSlider, {
            key: 'ab-compare',
            beforeUrl: resolvedBeforeUrl,
            afterUrl: displaySrc,
            alt: prompt || 'Comparison',
            t,
          }))
        } else {
          const draftSrc = block && (block.draftUrl || block.previewUrl || '')
          body.push(react.createElement(ProgressiveImagePreview, {
            key: 'prog-img',
            callId: block && (block.id || block.callId || block.toolCallId || ''),
            src: displaySrc,
            draftSrc,
            isRunning: running,
            progress: typeof parsed?.progress === 'number' ? parsed.progress : (typeof block?.progress === 'number' ? block.progress : undefined),
            step: parsed?.step || block?.step,
            stage: parsed?.stage || block?.stage,
            approval: block?.approval || block?.plan || parsed?.approval || parsed?.plan,
            alt: prompt || 'generated image',
            t,
            sendActionPrompt,
          }))
        }
      }

      const actions = []
      if (!running && !failed && (parsed.url || parsed.attachment || responsiveImages.length)) {
        let hasCompareSource = Boolean(
          parsed.beforeUrl || block?.beforeUrl || args.before_image || (args.image && typeof args.image === 'string') || (revisions.length > 1 && activeRev > 0)
        )
        if (hasCompareSource) {
          actions.push(
            react.createElement(
              'button',
              {
                key: 'compare',
                type: 'button',
                className: compareActive ? 'ig-btn ig-btn-primary' : 'ig-btn',
                onClick: () => setCompareActive(!compareActive),
              },
              '↔ ' + (compareActive ? (t('card.hideCompare') || 'Hide Compare') : (t('card.compare') || 'Compare'))
            )
          )
        }
        actions.push(
          react.createElement('button', {
            key: 'regenerate',
            type: 'button',
            className: regenerateOpen ? 'ig-btn ig-btn-primary' : 'ig-btn',
            onClick: () => {
              setRegeneratePrompt(prompt || '')
              setRegenerateOpen(!regenerateOpen)
            },
          }, '🔄 ' + (t('card.actionRegenerate') || 'Regenerate…')),
          react.createElement('button', { key: 'inpaint', type: 'button', className: 'ig-btn', onClick: () => setInpaintOpen(!inpaintOpen) }, '🖌️ ' + (t('card.inpaint') || 'Inpaint')),
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

      const regenerateDrawer = regenerateOpen ? react.createElement(
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
          react.createElement('span', { style: { fontSize: '12px', fontWeight: '700', color: 'var(--dsw-alias-label-primary)' } }, '🔄 ' + (t('card.regenerateTitle') || 'Regenerate with Edited Prompt')),
          react.createElement('button', {
            type: 'button',
            className: 'ig-btn',
            style: { padding: '2px 6px', fontSize: '11px' },
            onClick: () => setRegenerateOpen(false),
          }, '✕')
        ),
        react.createElement('textarea', {
          rows: 3,
          value: regeneratePrompt,
          onChange: (e) => setRegeneratePrompt(e.target.value),
          placeholder: t('card.regeneratePlaceholder') || 'Enter updated prompt…',
          className: 'ig-field-input',
          style: { fontSize: '12px', padding: '6px 10px', resize: 'vertical' },
        }),
        react.createElement(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' } },
          react.createElement(
            'div',
            { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
            react.createElement(
              'button',
              {
                type: 'button',
                className: regenerateSeed === 'random' ? 'ig-tab-btn ig-tab-btn-active' : 'ig-tab-btn',
                style: { padding: '3px 8px', fontSize: '11px' },
                onClick: () => setRegenerateSeed('random'),
              },
              '🎲 ' + (t('card.seedRandom') || 'New Seed')
            ),
            react.createElement(
              'button',
              {
                type: 'button',
                className: regenerateSeed === 'keep' ? 'ig-tab-btn ig-tab-btn-active' : 'ig-tab-btn',
                style: { padding: '3px 8px', fontSize: '11px' },
                onClick: () => setRegenerateSeed('keep'),
              },
              '🔒 ' + (t('card.seedKeep') || 'Same Seed')
            )
          ),
          react.createElement(
            'div',
            { style: { display: 'flex', gap: '6px' } },
            react.createElement(
              'button',
              {
                type: 'button',
                className: 'ig-btn',
                style: { padding: '4px 10px', fontSize: '11px' },
                onClick: () => setRegenerateOpen(false),
              },
              t('card.cancel') || 'Cancel'
            ),
            react.createElement(
              'button',
              {
                type: 'button',
                className: 'ig-save-btn',
                style: { padding: '4px 12px', fontSize: '11px', fontWeight: '600' },
                disabled: !regeneratePrompt.trim(),
                onClick: () => {
                  const seedArg = regenerateSeed === 'keep' && typeof args.seed === 'number' ? args.seed : Math.floor(Math.random() * 100000)
                  const aspectArg = args.aspect_ratio || args.aspectRatio || ''
                  let cmd = `generate_image(prompt: "${regeneratePrompt.trim()}"`
                  if (seedArg !== undefined) cmd += `, seed: ${seedArg}`
                  if (aspectArg) cmd += `, aspect_ratio: "${aspectArg}"`
                  cmd += ')'
                  sendActionPrompt(cmd)
                  setRegenerateOpen(false)
                },
              },
              '🚀 ' + (t('card.regenerateRun') || 'Run')
            )
          )
        )
      ) : null

      const inpaintDrawer = inpaintOpen ? react.createElement(InpaintCanvasOverlay, {
        react,
        t,
        parsed,
        imgUrl: parsed.url || (parsed.attachment ? attachmentImageUrl(parsed.attachment) : ''),
        targetRef: (parsed.attachment && (parsed.attachment.attachmentId || parsed.attachment.id)) || parsed.url || 'latest',
        sendActionPrompt,
        onClose: () => setInpaintOpen(false),
      }) : null

      return react.createElement(
        'div',
        { className: 'ig-section-card ig-card-preview', 'data-ig-preview': '1', style: { margin: '8px 0', position: 'relative' } },
        head,
        body,
        actions.length > 0 ? react.createElement('div', { className: 'ig-row', style: { marginTop: '8px' } }, actions) : null,
        remixDrawer,
        regenerateDrawer,
        inpaintDrawer
      )
    }