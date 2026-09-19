# Changelog

Notable changes to `@goodandready/dsh-image-gen`.

## 0.10.28

### Fixed
- **Settings reachable again on the plugin's own page**: the current DSH core
  (0.1.6-alpha.2) renders a plugin's configuration page only for entries registered
  in the plugin-list seat `plugins.item`. The card is now registered there
  (`id: 'dsh-image-gen'`, order 60, static label) and became view-aware: `summary`
  renders the one-line description and `page` renders the form bare and open instead
  of inside our card frame. The legacy `settings.plugin.item` seat stays as a
  fallback. Sources edited in `src/client`, `lib/client.js` rebuilt.

## 0.10.27

### Fixed
- **Settings reachable again**: the card registered into `settings.plugin.item`, a
  slot the current DSH core (0.1.6-alpha.2) no longer renders, so the plugin's
  settings were unreachable. The surface now registers into the Plugins page row
  seat `plugins.row.config`, keyed `@goodandready/dsh-image-gen#dsh-image-gen`
  (`rowConfigKey(package, rowId)`): the plugin's row gains a configure control whose
  page is the settings form (`view: 'page'`, without our card header — the host page
  draws the title, icon, crumb and padding) plus a one-line state for
  `view: 'summary'`. The legacy seat stays registered as a fallback for older cores.
- The docs test no longer requires `AGENTS.md` / `index.md`: commit `338219c`
  untracked them and added them to `.gitignore`, so the test now checks the design
  contract and the published README trio instead.

### Added
- This changelog.
