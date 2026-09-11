# AGENTS.md — @goodandready/dsh-image-gen

## Project
DSH plugin: multi-provider image generation and visual processing suite for DeepSeek Harness.
Package: `@goodandready/dsh-image-gen`. Host entry: `lib/index.js`. Browser entry: `lib/client.js`.
Canonical source language: English (locale keys + UI strings). Russian translation via dsh-russian-lang / translation plugin.

## Paths
- DEV: `/mnt/external/Project/DEV/dhsplugins/dsh-image-gen`
- Worktrees: `.worktrees/<branch>` only. Never edit DEV-root for feature work.
- Runtime/OPT: none — pure npm plugin installed into a DSH profile.
- Gitea: `goodandready/dsh-image-gen`. Git wrapper: `git-mimo` (or the assigned agent wrapper).

## Architecture
- `lib/index.js` — cordis host: Config schema, settings namespace `dsh-image-gen`, web routes, `registerAllTools`.
- `lib/register-tools.js` — orchestrator calling group registrars.
- `lib/tools/{generation,processing,editing,inspect,frontend}.js` — `defineTool` blocks; each tool inside its own labeled `ctx.effect`.
- `lib/providers.js` — FAL / OpenAI-compatible / Replicate / Gemini / Seedream / local backends.
- `lib/client.js` — settings card (`settings.plugin.item`) + toolviews; styles marked `data-dsh-plugin`.
- Safety modules: `quality-gate.js`, `loop-guard.js`, `cost-meter.js`, `generation-cache.js`, `security.js`, `negative-sanitizer.js`.
- Design contract: `docs/design/DESIGN.md` (must match shipped UI).

## Constraints (MUST NOT)
- Do not hardcode API keys, absolute machine paths, LAN IPs, or credentials.
- Do not register settings outside `settings.plugin.item` without owner approval.
- Do not ship files larger than 256 KiB in the npm package.
- Do not change package identity (`@goodandready/dsh-image-gen`) in the three required places without a migration task.
- Do not publish to npm/GitHub without explicit owner «Публикуем релиз?» / «ок».

## Commands
```bash
npm test          # node --test test/*.test.mjs
node --check lib/index.js
node --check lib/register-tools.js
```

## Test matrix
- unit: `npm test` (must be green before merge)
- syntax: `node --check` on `lib/index.js`, `lib/register-tools.js`, `lib/providers.js`, `lib/client.js`
- release: file size scan via `npm pack --dry-run`; test server cycle before publish

## Conventions
- Tool registrations go in `register-tools.js`, not inline in `apply()`.
- Dual-output contract (#10/#150): text LLM gets markdown summary; UI gets attachments.
- Errors returned to the model must pass `sanitizeErrorAndLogs`.
