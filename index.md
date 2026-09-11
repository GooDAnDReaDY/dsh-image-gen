# index.md — @goodandready/dsh-image-gen

Multi-provider image generation & visual processing plugin for DeepSeek Harness.

## Status
- Package version: see `package.json` (currently 0.10.16 lineage)
- Unit tests: `npm test` — 128 tests, expected 100% pass
- Design contract: `docs/design/DESIGN.md`

## Entry points
| Surface | File | Role |
|---|---|---|
| Host plugin | `lib/index.js` | cordis `name`/`inject`/`Config`/`apply` |
| Tool suite | `lib/register-tools.js` + `lib/tools/*` | 15 tools, each in labeled `ctx.effect` |
| Providers | `lib/providers.js` | FAL, OpenAI-compatible, Replicate, Gemini, Seedream, Codex, Grok, local |
| Browser UI | `lib/client.js` | settings card + toolviews |
| Bundle patch | `cordis.patch.yml` | profile insert |

## Tools
`generate_image`, `edit_image`, `vary_image`, `compare_images`, `remove_background`, `upscale_image`, `vectorize_image`, `blend_images`, `generate_image_pack`, `inspect_image_quality`, `extract_design_tokens`, `image_to_css_gradient`, `check_image_contrast`, `optimize_vector_svg`, `generate_pwa_icon_suite`

## Web routes
- `GET /dsh-image-gen/image` (legacy alias `/dsh-fal-image-gen/image`)
- `GET /dsh-image-gen/history`

## Build / test
```bash
npm test
node --check lib/*.js
```
No compile step; ESM only (`"type": "module"`).

## Docs
- `README.md` / `README.ru.md` / `README.zh.md`
- `docs/design/DESIGN.md`
- `AGENTS.md`
