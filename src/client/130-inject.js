    // Dual compatibility with DSH 0.1.5-rc.3 (settingsScope) and 0.1.6+ (configForms) (#291, #295)
    const inject = ['slots', 'locale', 'sessions']

    function resolveActiveScope(ctx) {
      if (!ctx) return null
      try {
        const lan = (ctx.get && ctx.get('lanSettings')) || ctx.lanSettings
        if (lan?.get) return lan.get(SETTINGS_NS)
        const cf = (ctx.get && ctx.get('configForms')) || ctx.configForms
        if (cf?.get) return cf.get(SETTINGS_NS)
        const ss = (ctx.get && ctx.get('settingsScope')) || ctx.settingsScope
        if (ss?.bind) return ss.bind({ namespace: SETTINGS_NS })
      } catch (_) { /* scope unavailable */ }
      return null
    }

    function createDynamicSettingsScope(ctx) {
      const listeners = new Set()
      let activeTarget = resolveActiveScope(ctx)
      let activeUnsub = null
      let httpSnapshot = { status: 'loading', writable: true, value: {} }

      const notify = () => { for (const fn of listeners) fn() }

      const syncHttpConfig = () => {
        if (typeof fetch !== 'function') return
        fetch('/dsh-image-gen/config', { cache: 'no-store' })
          .then((r) => r.json())
          .then((data) => {
            if (data && data.ok && data.config) {
              httpSnapshot = { status: 'ready', writable: true, value: data.config }
              notify()
            }
          })
          .catch(() => {})
      }
      syncHttpConfig()

      const bindTarget = (target) => {
        if (!target || target === activeTarget) return
        if (typeof activeUnsub === 'function') {
          try { activeUnsub() } catch { /* ignore */ }
          activeUnsub = null
        }
        activeTarget = target
        if (typeof activeTarget.subscribe === 'function') {
          try {
            activeUnsub = activeTarget.subscribe(notify)
          } catch { /* ignore */ }
        }
        notify()
      }

      if (activeTarget?.subscribe) {
        try { activeUnsub = activeTarget.subscribe(notify) } catch { /* ignore */ }
      }

      if (typeof ctx?.inject === 'function') {
        try {
          ctx.inject(['configForms'], (sctx) => {
            const s = sctx?.configForms?.get?.(SETTINGS_NS)
            if (s) bindTarget(s)
          })
          ctx.inject(['settingsScope'], (sctx) => {
            const s = sctx?.settingsScope?.bind?.({ namespace: SETTINGS_NS })
            if (s) bindTarget(s)
          })
        } catch { /* ignore */ }
      }

      return {
        getSnapshot() {
          const target = activeTarget || resolveActiveScope(ctx)
          const snap = target?.getSnapshot ? target.getSnapshot() : null
          if (snap?.status === 'ready' && snap.writable) return snap
          if (httpSnapshot.status === 'ready') return httpSnapshot
          return snap || httpSnapshot
        },
        async set(key, val) {
          const target = activeTarget || resolveActiveScope(ctx)
          const snap = target?.getSnapshot ? target.getSnapshot() : null
          if (snap?.status === 'ready' && snap.writable && target.set) return target.set(key, val)
          httpSnapshot = { ...httpSnapshot, value: { ...httpSnapshot.value, [key]: val } }
          notify()
          try {
            await fetch('/dsh-image-gen/config', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [key]: val }),
            })
          } catch { /* ignore */ }
        },
        async delete(key) {
          const target = activeTarget || resolveActiveScope(ctx)
          const snap = target?.getSnapshot ? target.getSnapshot() : null
          if (snap?.status === 'ready' && snap.writable && target.delete) return target.delete(key)
          const nextVal = { ...httpSnapshot.value }
          delete nextVal[key]
          httpSnapshot = { ...httpSnapshot, value: nextVal }
          notify()
          try {
            await fetch('/dsh-image-gen/config', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [key]: undefined }),
            })
          } catch { /* ignore */ }
        },
        subscribe(fn) {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
      }
    }

    function apply(ctx) {
      if (ctx.locale && typeof ctx.locale.register === 'function') {
        try {
          if (typeof ctx.effect === 'function') {
            ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-image-gen: locale')
          } else {
            ctx.locale.register(NS, { en, zh })
          }
        } catch (_) {
          try {
            ctx.locale.register(NS, 'en', en)
            ctx.locale.register(NS, 'zh', zh)
          } catch (_) {}
        }
      } else if (ctx.locale && typeof ctx.locale.define === 'function') {
        ctx.locale.define('en', NS, en)
        ctx.locale.define('zh', NS, zh)
      }

      let card
      const cardOnce = () => {
        if (card === undefined) {
          const scope = createDynamicSettingsScope(ctx)
          card = new FalSettingsCardController(scope)
        }
        return card
      }

      function registerSlotWhenReady(slotName, registerFn) {
        if (!ctx.slots) return
        if (typeof ctx.slots.inject === 'function') {
          try {
            ctx.slots.inject(slotName, () => {
              try { return registerFn() } catch (err) { console.warn('[dsh-image-gen] Slot err ' + slotName + ':', err) }
            })
            return
          } catch (err) { console.warn('[dsh-image-gen] Failed inject ' + slotName + ':', err) }
        }
        if (typeof ctx.slots.register === 'function') {
          try { registerFn() } catch (err) { console.warn('[dsh-image-gen] Direct reg err ' + slotName + ':', err) }
        }
      }

      // Register toolviews for all visual tools
      const toolviewTools = [
        'generate_image',
        'edit_image',
        'vary_image',
        'remix_image',
        'blend_images',
        'generate_image_pack',
        'generate_responsive_mockups',
        'remove_background',
        'upscale_image',
        'vectorize_image',
        'assemble_image_grid',
        'smart_crop_image',
        'export_asset_pack',
        'generate_ui_asset',
      ]

      for (const toolName of toolviewTools) {
        registerSlotWhenReady('tool.call.toolview', () =>
          ctx.slots.register(
            {
              name: 'tool.call.toolview',
              key: toolName,
              locale: NS,
              inject: () => ({ sessions: ctx.sessions }),
            },
            (props) => react.createElement(ErrorBoundary, null, react.createElement(FalImageCard, props))
          )
        )
      }

      registerSlotWhenReady('tool.call.toolview', () =>
        ctx.slots.register(
          {
            name: 'tool.call.toolview',
            key: 'generate_style_matrix',
            locale: NS,
            inject: () => ({ sessions: ctx.sessions }),
          },
          (props) => react.createElement(ErrorBoundary, null, react.createElement(StyleMatrixCard, props))
        )
      )

      registerSlotWhenReady('tool.call.toolview', () =>
        ctx.slots.register(
          {
            name: 'tool.call.toolview',
            key: 'generate_theme_pair',
            locale: NS,
            inject: () => ({ sessions: ctx.sessions }),
          },
          (props) => react.createElement(ErrorBoundary, null, react.createElement(ThemePairView, props))
        )
      )

      // Native Sidebar Right Pane Tab & BetterSidebar
      if (typeof ctx.inject === 'function') {
        try {
          ctx.inject(['sidebarRightTabs'], (sctx) => {
            const tabs = sctx && sctx.sidebarRightTabs
            if (!tabs || typeof tabs.register !== 'function') return
            try {
              const def = {
                id: '@goodandready/dsh-image-gen:studio',
                kind: 'image-studio',
                priority: 'extension',
                title: () => 'Image Studio',
                guide: [
                  {
                    order: 45,
                    title: () => 'Image Studio & Vault',
                    description: () => 'Interactive visual studio & asset browser',
                    icon: () => react.createElement('span', null, '🎨'),
                  },
                ],
              }
              if (typeof sctx.effect === 'function') {
                sctx.effect(() => tabs.register(def))
              } else {
                tabs.register(def)
              }

              if (ctx.slots) {
                const registerPaneTab = () => {
                  try {
                    return ctx.slots.register(
                      {
                        name: 'sidebar.right.pane.tab',
                        key: '@goodandready/dsh-image-gen:gallery',
                        locale: NS,
                        inject: () => ({ ctx }),
                      },
                      (props) => react.createElement(ErrorBoundary, null, react.createElement(ImageStudioView, { ...props, ctx }))
                    )
                  } catch (e) {
                    console.warn('[dsh-image-gen] native sidebar pane tab register failed', e)
                  }
                }
                if (typeof ctx.slots.inject === 'function') {
                  ctx.slots.inject('sidebar.right.pane.tab', registerPaneTab)
                } else {
                  registerPaneTab()
                }
              }
            } catch (e) {
              console.warn('[dsh-image-gen] native sidebar registration failed', e)
            }
          })
        } catch (_) { /* native sidebar unavailable */ }

        try {
          ctx.inject(['betterSidebar'], (sctx) => {
            const svc = sctx && sctx.betterSidebar
            if (!svc || typeof svc.registerTab !== 'function') return
            try {
              svc.registerTab({
                id: 'dsh-image-gen:gallery',
                title: () => 'Gallery',
                icon: () => react.createElement('span', null, '🖼️'),
                order: 45,
                component: ({ scope }) => react.createElement(ErrorBoundary, null, react.createElement(ImageStudioView, { ctx, scope })),
              })
            } catch (e) {
              console.warn('[dsh-image-gen] betterSidebar registerTab failed', e)
            }
          })
        } catch (_) { /* betterSidebar unavailable */ }
      }

      // Conversation header utilities chip (quick-access gallery button in chat header)
      registerSlotWhenReady('conversation.session.header.utilities', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.utilities',
            id: 'dsh-image-gen-gallery-chip',
            order: 8,
            locale: NS,
            inject: () => ({ ctx }),
          },
          (props) => react.createElement(GalleryHeaderChip, { ...props, ctx })
        )
      )

      // Settings card item — sole slot registration for settings card (#208, #300)
      registerSlotWhenReady('settings.plugin.item', () =>
        ctx.slots.register(
          {
            name: 'settings.plugin.item',
            key: SETTINGS_NS,
            locale: NS,
            inject: () => cardOnce().inject(),
          },
          (props) => react.createElement(ErrorBoundary, null, react.createElement(FalSettingsCard, props))
        )
      )
    }
