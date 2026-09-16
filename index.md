# index.md — @goodandready/dsh-image-gen

Multi-provider image generation & visual processing plugin for DeepSeek Harness.

## Status
- Package version: `0.10.24` (see `package.json`)
- Unit tests: `npm test` — 154 tests, expected 100% pass
- Design contract: `docs/design/DESIGN.md`

## Entry points
| Surface | File | Role |
|---|---|---|
| Host plugin | `lib/index.js` | cordis `name`/`inject`/`Config`/`apply` |
| Tool suite | `lib/register-tools.js` + `lib/tools/*` | 15 tools, each in labeled `ctx.effect` |
| Providers | `lib/providers.js` (aggregator) + `lib/provider-utils.js` + `lib/providers/shared-helpers.js` + `lib/providers/backends/*` | FAL, OpenAI-compatible, Replicate, Gemini, Seedream, Codex, Grok, local |
| Browser UI | `lib/client.js` (built from `src/client/*`) | settings card + toolviews |
| Bundle patch | `cordis.patch.yml` | profile insert |

## Tools
Server-side processing tools live in `lib/tools/processing-basic.js` and `lib/tools/processing-advanced.js`.

`generate_image`, `edit_image`, `vary_image`, `compare_images`, `remove_background`, `upscale_image`, `vectorize_image`, `blend_images`, `generate_image_pack`, `inspect_image_quality`, `extract_design_tokens`, `image_to_css_gradient`, `check_image_contrast`, `optimize_vector_svg`, `generate_pwa_icon_suite`

## Web routes
- `GET /dsh-image-gen/image` (legacy alias `/dsh-fal-image-gen/image`)
- `GET /dsh-image-gen/history`

## Build / test
```bash
npm run build:client   # assemble lib/client.js from src/client/*
npm test               # build + node --check client + unit tests
node --check lib/*.js
```
Client is assembled from ordered `src/client/*` fragments (DSH loads one ModuleLoader entry). Server remains plain ESM (`"type": "module"`).

## Docs
- `README.md` / `README.ru.md` / `README.zh.md`
- `docs/design/DESIGN.md`
- `AGENTS.md`
