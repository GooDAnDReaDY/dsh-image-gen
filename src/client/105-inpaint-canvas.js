// 105-inpaint-canvas.js — Interactive in-chat canvas drawing overlay for inpainting (#285, #301, #328, #380).

    function buildEditInstruction(opts) {
      const p = (opts && opts.prompt ? opts.prompt.trim() : '') || 'inpaint masked region'
      const img = (opts && opts.image) || 'latest'
      const m = (opts && opts.mask) || ''
      return 'Use edit_image with prompt: "' + p + '", image: "' + img + '", mask: "' + m + '"'
    }

    function InpaintCanvas(props) {
      const { imgUrl, targetRef, parsed, onClose, sendActionPrompt, t } = props
      const canvasRef = react.useRef(null)
      const isDrawingRef = react.useRef(false)
      const undoStackRef = react.useRef([])
      const [brushSize, setBrushSize] = react.useState(24)
      const [toolMode, setToolMode] = react.useState('brush') // 'brush' | 'eraser'
      const [hasStrokes, setHasStrokes] = react.useState(false)
      const [copied, setCopied] = react.useState(false)
      const [inpaintPrompt, setInpaintPrompt] = react.useState('')
      const [canvasDims, setCanvasDims] = react.useState({ width: 512, height: 512, ratio: '1/1' })

      const effectiveImgUrl = imgUrl || (parsed?.attachment ? attachmentImageUrl(parsed.attachment) : (parsed?.url || ''))
      const effectiveTargetRef = targetRef
        || (parsed?.attachment && (parsed.attachment.attachmentId || parsed.attachment.id))
        || parsed?.attachmentId
        || parsed?.url
        || 'latest'

      const initCanvas = react.useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.fillStyle = 'black'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        undoStackRef.current = [ctx.getImageData(0, 0, canvas.width, canvas.height)]
      }, [])

      react.useEffect(() => {
        initCanvas()
      }, [initCanvas, canvasDims])

      function handleImageLoaded(e) {
        if (e.target && e.target.naturalWidth && e.target.naturalHeight) {
          const nw = e.target.naturalWidth
          const nh = e.target.naturalHeight
          // Preserve 1:1 intrinsic source dimensions for accurate mask generation (#380)
          setCanvasDims({ width: nw, height: nh, ratio: `${nw}/${nh}` })
        }
      }

      function getPos(e, canvas) {
        const rect = canvas.getBoundingClientRect()
        const clientX = e.touches ? e.touches[0].clientX : e.clientX
        const clientY = e.touches ? e.touches[0].clientY : e.clientY
        const scaleX = canvas.width / (rect.width || canvas.width)
        const scaleY = canvas.height / (rect.height || canvas.height)
        return {
          x: (clientX - rect.left) * scaleX,
          y: (clientY - rect.top) * scaleY,
          scale: (scaleX + scaleY) / 2,
        }
      }

      function startDraw(e) {
        if (e.touches && e.touches.length > 1) return
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        isDrawingRef.current = true
        const pos = getPos(e, canvas)
        const actualBrush = brushSize * (pos.scale || 1)
        ctx.beginPath()
        ctx.moveTo(pos.x, pos.y)
        ctx.lineWidth = actualBrush
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        const color = toolMode === 'eraser' ? 'black' : 'white'
        ctx.strokeStyle = color
        ctx.fillStyle = color

        ctx.arc(pos.x, pos.y, actualBrush / 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(pos.x, pos.y)
        setHasStrokes(true)
      }

      function draw(e) {
        if (!isDrawingRef.current) return
        if (e.touches && e.touches.length > 1) return
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const pos = getPos(e, canvas)
        const actualBrush = brushSize * (pos.scale || 1)
        ctx.lineWidth = actualBrush
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        const color = toolMode === 'eraser' ? 'black' : 'white'
        ctx.strokeStyle = color
        ctx.lineTo(pos.x, pos.y)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(pos.x, pos.y)
      }

      function stopDraw() {
        if (!isDrawingRef.current) return
        isDrawingRef.current = false
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.beginPath()
        if (undoStackRef.current.length >= 15) {
          undoStackRef.current.shift()
        }
        undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
      }

      function handleUndo() {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx || undoStackRef.current.length <= 1) return
        undoStackRef.current.pop()
        const prev = undoStackRef.current[undoStackRef.current.length - 1]
        if (prev) {
          ctx.putImageData(prev, 0, 0)
        }
        if (undoStackRef.current.length <= 1) {
          setHasStrokes(false)
        }
      }

      function handleInvert() {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const d = imgData.data
        for (let i = 0; i < d.length; i += 4) {
          d[i] = 255 - d[i]
          d[i + 1] = 255 - d[i + 1]
          d[i + 2] = 255 - d[i + 2]
          d[i + 3] = 255
        }
        ctx.putImageData(imgData, 0, 0)
        if (undoStackRef.current.length >= 15) {
          undoStackRef.current.shift()
        }
        undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
        setHasStrokes(true)
      }

      function handleClear() {
        initCanvas()
        setHasStrokes(false)
      }

      function handleApply() {
        const canvas = canvasRef.current
        if (!canvas) return
        const maskDataUrl = canvas.toDataURL('image/png')
        const promptText = inpaintPrompt.trim() || 'inpaint masked region'
        const instruction = buildEditInstruction({
          prompt: promptText,
          image: effectiveTargetRef,
          mask: maskDataUrl,
        })

        if (typeof sendActionPrompt === 'function') {
          sendActionPrompt(instruction)
        }

        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(instruction)
          setCopied(true)
          setTimeout(() => setCopied(false), 2500)
        }

        try {
          const textarea = document.querySelector('textarea[placeholder*="message"], textarea[class*="chat"], textarea')
          if (textarea) {
            textarea.value = instruction
            if (typeof window !== 'undefined' && typeof window.Event === 'function') textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
          }
        } catch (_err) { /* non-fatal: optional textarea dispatch */ }
      }

      return react.createElement(
        'div',
        { className: 'ig-inpaint-box' },
        react.createElement(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          react.createElement(
            'span',
            { style: { fontSize: '13px', fontWeight: '700', color: 'var(--dsw-alias-label-primary)' } },
            '🖌️ ' + (t('inpaint.title') || 'Inpainting Canvas (Paint white mask over region to edit)')
          ),
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-btn',
              style: { padding: '2px 8px', fontSize: '11px' },
              onClick: onClose,
            },
            '✕'
          )
        ),
        react.createElement(
          'div',
          { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          react.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, (t('inpaint.brush_size') || 'Brush') + ': ' + brushSize + 'px'),
          react.createElement('input', {
            type: 'range',
            min: '6',
            max: '64',
            value: brushSize,
            onChange: (e) => setBrushSize(parseInt(e.target.value, 10)),
            style: { width: '100px', cursor: 'pointer' },
          }),
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-btn' + (toolMode === 'brush' ? ' ig-btn-active' : ''),
              style: { padding: '3px 8px', fontSize: '11px' },
              onClick: () => setToolMode('brush'),
            },
            '🖌️ ' + (t('inpaint.brush') || 'Brush')
          ),
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-btn' + (toolMode === 'eraser' ? ' ig-btn-active' : ''),
              style: { padding: '3px 8px', fontSize: '11px' },
              onClick: () => setToolMode('eraser'),
            },
            '🧹 ' + (t('inpaint.eraser') || 'Eraser')
          ),
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-btn',
              style: { padding: '3px 8px', fontSize: '11px' },
              onClick: handleInvert,
            },
            '🔄 ' + (t('inpaint.invert') || 'Invert')
          ),
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-btn',
              style: { padding: '3px 8px', fontSize: '11px' },
              onClick: handleUndo,
              disabled: !hasStrokes,
            },
            '↩ ' + (t('inpaint.undo') || 'Undo')
          ),
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-btn',
              style: { padding: '3px 8px', fontSize: '11px' },
              onClick: handleClear,
            },
            '🗑️ ' + (t('inpaint.clear') || 'Clear Mask')
          )
        ),
        react.createElement(
          'div',
          {
            style: {
              position: 'relative',
              width: '100%',
              maxWidth: '512px',
              aspectRatio: canvasDims.ratio,
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'black',
              margin: '4px 0',
              userSelect: 'none',
              touchAction: 'none',
            },
          },
          effectiveImgUrl ? react.createElement('img', {
            src: effectiveImgUrl,
            alt: 'Source for Inpaint',
            onLoad: handleImageLoaded,
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              opacity: 0.45,
              pointerEvents: 'none',
            },
          }) : null,
          react.createElement('canvas', {
            ref: canvasRef,
            width: canvasDims.width,
            height: canvasDims.height,
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              cursor: 'crosshair',
              mixBlendMode: 'screen',
            },
            onMouseDown: startDraw,
            onMouseMove: draw,
            onMouseUp: stopDraw,
            onMouseLeave: stopDraw,
            onTouchStart: startDraw,
            onTouchMove: draw,
            onTouchEnd: stopDraw,
          })
        ),
        react.createElement('input', {
          type: 'text',
          placeholder: t('inpaint.prompt_placeholder') || 'Describe what to generate in the masked area...',
          value: inpaintPrompt,
          onChange: (e) => setInpaintPrompt(e.target.value),
          className: 'ig-field-input',
          style: { fontSize: '12px', padding: '6px 10px', width: '100%' },
        }),
        react.createElement(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '2px' } },
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'ig-btn ig-btn-primary',
              style: { padding: '5px 12px', fontSize: '12px' },
              onClick: handleApply,
            },
            copied ? (t('inpaint.copied') || '✓ Instruction Copied!') : ('🖌️ ' + (t('inpaint.apply') || 'Apply Inpainting'))
          )
        )
      )
    }
    var InpaintCanvasOverlay = InpaintCanvas
