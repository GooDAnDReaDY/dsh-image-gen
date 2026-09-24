    // Dual compatibility with DSH 0.1.5-rc.3 (settingsScope) and 0.1.6+ (configForms) (#291)
    const inject = ['slots', 'locale', 'sessions']

    function resolveActiveScope(ctx) {
      if (!ctx) return null
      if (ctx.get && typeof ctx.get === 'function') {
        try {
          const lan = ctx.get('lanSettings')
          if (lan && typeof lan.get === 'function') {
            const s = lan.get(SETTINGS_NS)
            if (s) return s
          }
        } catch (_) { /* scope unavailable */ }
        try {
          const cf = ctx.get('configForms')
          if (cf && typeof cf.get === 'function') {
            const s = cf.get(SETTINGS_NS)
            if (s) return s
          }
        } catch (_) { /* scope unavailable */ }
        try {
          const ss = ctx.get('settingsScope')
          if (ss && typeof ss.bind === 'function') {
            const s = ss.bind({ namespace: SETTINGS_NS })
            if (s) return s
          }
        } catch (_) { /* scope unavailable */ }
      }
      if (ctx.configForms && typeof ctx.configForms.get === 'function') {
        try {
          const s = ctx.configForms.get(SETTINGS_NS)
          if (s) return s
        } catch (_) { /* scope unavailable */ }
      }
      if (ctx.settingsScope && typeof ctx.settingsScope.bind === 'function') {
        try {
          const s = ctx.settingsScope.bind({ namespace: SETTINGS_NS })
          if (s) return s
        } catch (_) { /* scope unavailable */ }
      }
      return null
    }

    function createDynamicSettingsScope(ctx) {
      const listeners = new Set()
      let activeTarget = resolveActiveScope(ctx)
      let activeUnsub = null

      const bindTarget = (target) => {
        if (!target || target === activeTarget) return
        if (typeof activeUnsub === 'function') {
          try { activeUnsub() } catch (_) { /* scope unavailable */ }
          activeUnsub = null
        }
        activeTarget = target
        if (typeof activeTarget.subscribe === 'function') {
          try {
            activeUnsub = activeTarget.subscribe(() => {
              for (const fn of listeners) fn()
            })
          } catch (_) { /* scope unavailable */ }
        }
        for (const fn of listeners) fn()
      }

      if (activeTarget && typeof activeTarget.subscribe === 'function') {
        try {
          activeUnsub = activeTarget.subscribe(() => {
            for (const fn of listeners) fn()
          })
        } catch (_) { /* scope unavailable */ }
      }

      if (typeof ctx?.inject === 'function') {
        try {
          ctx.inject(['configForms'], (sctx) => {
            try {
              const s = sctx?.configForms?.get?.(SETTINGS_NS)
              if (s) bindTarget(s)
            } catch (_) { /* scope unavailable */ }
          })
        } catch (_) { /* scope unavailable */ }
        try {
          ctx.inject(['settingsScope'], (sctx) => {
            try {
              const s = sctx?.settingsScope?.bind?.({ namespace: SETTINGS_NS })
              if (s) bindTarget(s)
            } catch (_) { /* scope unavailable */ }
          })
        } catch (_) { /* scope unavailable */ }
      }

      return {
        getSnapshot() {
          const target = activeTarget || resolveActiveScope(ctx)
          if (target && typeof target.getSnapshot === 'function') {
            return target.getSnapshot()
          }
          return { status: 'unavailable', writable: false, value: {} }
        },
        async set(key, val) {
          const target = activeTarget || resolveActiveScope(ctx)
          if (target && typeof target.set === 'function') {
            return target.set(key, val)
          }
        },
        async delete(key) {
          const target = activeTarget || resolveActiveScope(ctx)
          if (target && typeof target.delete === 'function') {
            return target.delete(key)
          }
        },
        subscribe(fn) {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
      }
    }

    function apply(ctx) {
      if (ctx.locale && typeof ctx.locale.define === 'function') {
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
              try {
                return registerFn()
              } catch (err) {
                console.warn('[dsh-image-gen] Error registering slot ' + slotName + ':', err)
              }
            })
            return
          } catch (err) {
            console.warn('[dsh-image-gen] Failed to inject slot ' + slotName + ':', err)
          }
        }
        if (typeof ctx.slots.register === 'function') {
          try {
            registerFn()
          } catch (err) {
            console.warn('[dsh-image-gen] Failed direct registration for ' + slotName + ':', err)
          }
        }
      }

      // Register toolviews for all 8 visual tools
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
        } catch (e) { /* native sidebar unavailable */ }

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
        } catch (e) { /* betterSidebar unavailable */ }
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

      // List seat (plugins.item)
      registerSlotWhenReady('plugins.item', () =>
        ctx.slots.register(
          {
            name: 'plugins.item',
            id: 'dsh-image-gen',
            order: 60,
            label: () => 'Image Studio',
            locale: NS,
            inject: () => cardOnce().inject(),
          },
          (props) => react.createElement(ErrorBoundary, null, react.createElement(FalSettingsCard, props))
        )
      )

      // Settings card item (legacy seat, kept as a fallback)
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

