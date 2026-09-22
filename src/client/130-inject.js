    const inject = ['slots', 'configForms', 'locale', 'sessions']

    function apply(ctx) {
      if (ctx.locale && typeof ctx.locale.define === 'function') {
        ctx.locale.define('en', NS, en)
        ctx.locale.define('zh', NS, zh)
      }

      let card
      const cardOnce = () => {
        if (card === undefined) {
          const scope = ((ctx.get && ctx.get('lanSettings')) || ctx.configForms).get(SETTINGS_NS)
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


      // Native Sidebar Right Pane Tab & BetterSidebar
      if (typeof ctx.inject === 'function') {
        try {
          ctx.inject(['sidebarRightTabs'], (sctx) => {
            const tabs = sctx && sctx.sidebarRightTabs
            if (!tabs || typeof tabs.register !== 'function') return
            try {
              const def = {
                id: '@goodandready/dsh-image-gen:gallery',
                kind: 'image-gallery',
                priority: 'extension',
                title: () => 'Gallery',
                guide: [
                  {
                    order: 45,
                    title: () => 'Image Studio Gallery',
                    description: () => 'Browse and inspect recent image generations',
                    icon: () => react.createElement('span', null, '🖼️'),
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
                      (props) => react.createElement(ErrorBoundary, null, react.createElement(GalleryView, { ...props, ctx }))
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
                component: ({ scope }) => react.createElement(ErrorBoundary, null, react.createElement(GalleryView, { ctx, scope })),
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

      // List seat (plugins.item): the seat the Plugins page renders as the plugin's own
      // page with its configuration. The label is a static string on purpose — it is
      // resolved while the page renders, and a locale lookup there would take the whole
      // client batch down with it.
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

