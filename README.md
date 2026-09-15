
## 🚀 Updates v0.10.8: Lossless JSON Unification, Dual-Output & Strict Validation (#199)
- **Lossless JSON & Dual-Output Unification**: `upscale_image`, `remove_background`, `blend_images`, and `vectorize_image` now consistently return `toLosslessJson` and formatted markdown `summary` for text-only LLMs.
- **Strict Input Image Validation**: `extract_design_tokens`, `image_to_css_gradient`, and `check_image_contrast` explicitly validate source image readability instead of silent fallback.
- **Unit Testing Suite**: Added `test/tool-consistency.test.mjs` covering tokenization, gradient generator, and PWA suite.

# 📦 @goodandready/dsh-image-gen

<div align="center">

<h3>Comprehensive Visual Generation & Image Processing Suite for DeepSeek Harness</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@goodandready/dsh-image-gen"><img src="https://img.shields.io/npm/v/@goodandready/dsh-image-gen.svg?style=for-the-badge&color=6366f1&labelColor=1e1b4b" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/GooDAnDReaDY/dsh-image-gen.svg?style=for-the-badge&color=10b981&labelColor=064e3b" alt="license"></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-Plugin-8b5cf6.svg?style=for-the-badge&labelColor=2e1065" alt="DSH Plugin"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-20%2B-f59e0b.svg?style=for-the-badge&labelColor=451a03" alt="Node version"></a>
</p>

<p align="center">
  <a href="https://goodandready.app/"><img src="https://img.shields.io/badge/All_Author_Projects-goodandready.app-ff4500.svg?style=for-the-badge&logo=rocket&logoColor=white&labelColor=1a1a2e" alt="All Projects"></a>
</p>

<p align="center">
  <a href="README.md"><b>🇬🇧 English</b></a> •
  <a href="README.ru.md"><b>🇷🇺 Русский</b></a> •
  <a href="README.zh.md"><b>🇨🇳 中文说明</b></a>
</p>

<table align="center">
  <tr>
    <td align="center">
      ⭐ <strong>If you like this plugin, please star it on GitHub</strong> — it shows me that the plugin is useful to you and motivates me to keep developing it.
      <br><br>
      🐛 <strong>If you find a bug or would like to request a feature</strong>, open a GitHub issue in any language — I will review your proposal and implement useful suggestions in a future plugin version.
    </td>
  </tr>
</table>

</div>

---

## 🚀 Updates v0.10.23: In-App Auto-Updater, Settings Synchronization, Active Probes & Language Purity (#232)
* **One-Click In-App Auto-Updater**: Direct 1-click update support inside the plugin Settings Card (`UpdaterSection`) backed by `/api/dsh-image-gen/update`. Fetches the npm registry for release manifests, verifies semver differences, and securely triggers `dsh plugin add @goodandready/dsh-image-gen@latest` restricted to loopback and private LAN connections.
* **1:1 Settings Synchronization**: Fully synchronized host `Config` schema in `lib/index.js` with client UI fields (`lib/client.js`), exposing `autoEnhancePrompt` and `defaultStylePreset` under the `✨ Enhancer` tab.
* **Active Diagnostic Probes**: Added real HTTP network probes in `testProviderConnection` for Replicate (`/v1/models`), Google Gemini (`/v1beta/models`), and ByteDance Seedream with timeout protection and live roundtrip latency tracking.
* **Strict Multi-Language Compliance**: Pure standard `en` and `zh` localization bundles embedded in core package; modularized Russian language support via `goodandready/dsh-russian-lang` per DSH plugin guidelines. Exactly 0 Cyrillic characters in product code (`lib/`).
* **WAI-ARIA Accessibility Hardening**: Enhanced tab navigation and input form validation with `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, `role="tabpanel"`, `aria-describedby`, and `role="alert"`.

## 🚀 Updates v0.10.22: Referential Stability & React Error #185 Infinite Loop Fix (#230)
* **Settings Card Referential Stability**: Resolved React Error #185 (`Maximum update depth exceeded`) in `FalSettingsCardController` and `CardForm.prototype.bind`. Store snapshots are referentially cached during render cycles (`Object.is(prev, next) === true`), completely preventing infinite re-render loops in React 18 / `useSyncExternalStore`.
* **Deep DSH Store Integration**: Added seamless runtime integration with `@deepseek-ai/dsh-client-store` (`runtime.createSnapshotStore`) paired with a robust standalone snapshot caching fallback.
* **Automated Regression Test Suite**: Added dedicated referential identity test in `test/client-syntax.test.mjs` verifying snapshot immutability across repeated reads, single-notification publish triggers, and clean listener lifecycle.

## 🚀 Updates v0.10.21: Variations Workbench, Smart Aspect Ratio Crop & Brand Asset Pack (#228)
* **Variations & Style Remix Workbench**: Interactive visual drawer embedded directly in `FalImageCard` and Gallery. Fine-tune variations with a continuous creativity / denoising strength slider (0.05 to 0.95), preset quick buttons ("Subtle 0.25", "Creative 0.65"), and prompt modifier guidance.
* **Intelligent Aspect-Ratio Canvas Cropper & Resizer (`smart_crop_image`)**: Instant lossless aspect ratio framing for social and responsive surfaces (`1:1`, `16:9`, `9:16`, `4:3`, `3:2`, `2:3`) supporting focal heuristics (`auto_focus`, `center`, `rule_of_thirds`, `letterbox`) via zero-dependency pure Node.js SVG vector raster wrapper.
* **Project Asset Pack & Social Card Exporter (`export_asset_pack`)**: Production-ready automated brand asset generation producing SVG favicons, PWA application icon suite (`icon-192.svg`, `icon-512.svg`), `manifest.webmanifest`, high-resolution OpenGraph social banner preview (`og-card.svg` at 1200×630), and an asset manifest catalog (`catalog.json`).
* **Dedicated Toolviews for 12 Visual Tools**: Direct interactive action buttons and visual renderers in conversation sessions for all generation, editing, inpainting, remix, crop, export, and collage tools.
* **Strict Localization Standard**: Complete `zh` and `en` UI dictionary integration; Russian locale registered via `goodandready/dsh-russian-lang`.

## 🚀 Updates v0.10.19: Sidebar Gallery, Diagnostics & Style Engine (#224)
* **Native Sidebar Gallery & History Drawer**: Integrated directly into DSH's native right sidebar pane (`sidebarRightTabs` and `sidebar.right.pane.tab`), `betterSidebar`, and a quick-access utility chip in the conversation header (`conversation.session.header.utilities`). Browse past generations, inspect metadata, copy prompts, and export links without cluttering the chat.
* **Interactive Provider Diagnostics**: Real-time "Test Connection" button in the Settings Card under the Providers tab. Ping Fal.ai, ComfyUI, Automatic1111, or Custom OpenAI-compatible endpoints with live roundtrip latency tracking and status badges (Ready, High Latency, Unreachable).
* **Curated Style Presets & Smart Prompt Polisher**: Built-in artistic engine with 10 curated styles (`cinematic`, `photorealistic`, `anime`, `minimalist_vector`, `isometric_3d`, `analog_film`, `cyberpunk`, `pixel_art`, `oil_painting`, `claymation`), optional `autoEnhancePrompt` setting, and `style_preset` tool parameter.
* **Collage & Comparison Grid Assembler (`assemble_image_grid`)**: Stitch 2 to 4 images into clean side-by-side, 2x2 grid, or vertical collage comparison graphics via pure Node.js SVG raster rendering, zero heavy external binaries (< 250 KiB package size).
* **Color Palette-Constrained Generation**: Pass `palette_colors` (hex color array) into `generate_image` to mathematically bias the prompt and negative prompt toward your exact brand color palette with automated WCAG contrast validation.
* **Inpainting & Mask Support in `edit_image`**: Added `mask_image` (alias for `mask`) and fine-grained `strength` (0.0 to 1.0) control for localized inpainting in Fal.ai and custom gateways.
* **Full Chinese & English UI Dictionaries**: Complete `zh` and `en` localization coverage in Web UI, with Russian translation registered via `goodandready/dsh-russian-lang`.

## 🚀 Updates v0.10.18: Speed Acceleration & Quality Hardening (#222)
* **Parallel Batch & Pack Generation**: Multi-variation requests (`count > 1`, `prompts` array) and `generate_image_pack` multi-ratio workflows now execute concurrently with a concurrency limit (`concurrency: 3`) via `asyncPool`, reducing generation wait times by up to **3x**.
* **Zero-Delay Initial Polling**: Eliminated artificial initial delay in `pollStatus` and queue runners (Fal.ai, ComfyUI), inspecting generation status immediately on first attempt and shaving 1–1.5s off fast generative workflows.
* **Sub-Millisecond L1 In-Memory Cache**: Built-in 32-entry in-memory LRU cache atop disk cache L2 provides instantaneous (< 0.1 ms) cache hits without synchronous disk I/O.
* **Fast-Fail Quota Detection**: Added classification for HTTP 402 (Payment Required) and exhausted account quota/credits in `isFatalClientError`, enabling immediate, clean fallback transitions without fruitless retry loops.
* **Expanded Test Suite**: Added `test/batch5-speed-quality.test.mjs`, bringing total test coverage to **136 automated unit tests (100% pass)**.

## 🚀 Updates v0.10.17: Modular Tool Lifecycle (#216, #217)
* **Tool modules extracted from `apply()`**: host lifecycle in `lib/index.js` is now a thin cordis entry (~650 lines). Tool definitions live in `lib/tools/{generation,processing,editing,inspect,frontend}.js` behind `lib/register-tools.js`.
* **Per-tool labeled `ctx.effect`**: each of the 15 tools registers in its own effect (`dsh-image-gen: tool <name>`) for clean unload/reload disposal.
* **Project meta**: `AGENTS.md` and `index.md` document architecture, constraints, and the test matrix (internal workflow files — not shipped in the npm package).
* **Design contract**: `docs/design/DESIGN.md` no longer advertises the removed HistoryGallery UI (#203).
* **Regression lock**: `test/lifecycle-structure.test.mjs` asserts modular layout, labeled effects, and meta files. Suite: **132 unit tests**.

## ⚡ Overview

**`@goodandready/dsh-image-gen`** is a premier graphic generation and visual processing suite for DeepSeek Harness. It equips autonomous agents with an extensible set of tools for image generation, transformation, background removal, upscaling, vectorization, multi-reference blending, and quality inspection across 8 generative backends.

---

## 🛡️ Reliability, Performance & Quality (v0.10.0)

* **Exponential Backoff with Jitter**: Adaptive polling for FAL, Replicate, and ComfyUI queues protects against HTTP 429 rate limits.
* **Error Classification in Fallback Cascade**: Client-side errors (Content Policy, 400 Bad Request, NSFW) fail fast without wasting API credits on other providers.
* **Deterministic Hash Caching**: Exact matches of prompt, model, and seed return instantly from local storage with zero API expense.
* **ComfyUI & Automatic1111 Drag-and-Drop**: Metadata is packed into PNG `Parameters` chunks in standard format.
* **Dimension Snapping**: Automatic normalization to multiples of 64 guarantees VAE bucket compatibility.
* **Enhanced Style Presets**: Built-in styles include tailor-made negative prompts and optimal guidance scale settings.

---

## 🛠️ Complete Tools Reference

* **`generate_image`**: Generate images with pluggable providers, seeds, aspect ratios, and style presets.
* **`edit_image`**: Targeted inpainting and modification with automatic session reference resolution (#142, #144, #145).
* **`vary_image`**: Controlled variation generation preserving composition (#143, #144).
* **`remove_background`**: Extract subject with transparent PNG output (FAL BiRefNet / Rembg).
* **`upscale_image`**: 2x / 4x super-resolution with clarity reconstruction.
* **`vectorize_image`**: Convert raster graphics to clean scalable SVG vectors with palette quantization.
* **`blend_images`**: Multi-reference composition mixing.
* **`generate_image_pack`**: Simultaneous multi-aspect ratio rendering with graceful partial recovery.
* **`compare_images`**: Pixel-level visual difference ratio comparison.
* **`inspect_image_quality`**: Automated visual audit, Laplacian sharpness scoring, and defect detection.
* **`extract_design_tokens`**: Extract CSS Variables, Tailwind color palettes, and W3C Design Tokens from concept art (#172).
* **`image_to_css_gradient`**: Generate lightweight pure CSS Mesh / Radial / Linear gradients (< 1KB) from image colors (#174).
* **`check_image_contrast`**: Evaluate background luminance and WCAG 2.1 AA/AAA contrast for text with scrim suggestions (#175).
* **`optimize_vector_svg`**: Clean and sanitize SVG, normalize viewBox, and export ready-to-use React TSX components (#176).
* **`generate_pwa_icon_suite`**: Generate full PWA icon sets, HTML meta tags, and web app manifest.json (#190).

---

## 🚀 Updates in v0.10.4: Cordis Lifecycle, Full Settings GUI, and i18n
- **Cordis Lifecycle (#136)**: wrapped all 7 tool registrations in `ctx.effect` for proper disposal on reload.
- **Settings GUI Completeness (#137)**: exposed fields for Replicate, SeaDream, Gemini, Local ComfyUI/A1111, style presets, and LLM enhancer.
- **Package Manifest (#138)**: declared kernel `peerDependencies` (`host-webserver`, `settings`, `llm`, `system-prompt`).
- **React Cleanup (#139)**: removed dead state hooks from `FalImageCard`.
- **Complete Localization (#140)**: eliminated hardcoded strings, wiring comprehensive dictionaries for en, ru, and zh.

### 🚀 What's New in v0.10.7 (#197)
* **Robust Error Formatting**: completely prevents `[object Object]` from appearing in provider refusal chains, extracting deep `.message`, `.detail`, and `.error` objects cleanly.
* **Deduplicated Provider Prefixes**: eliminates redundant `codex: codex: ...` prefixes.
* **FAL Credential Aliasing**: seamless fallback between `FAL_API_KEY` and `FAL_KEY` in credentials and environment.
* **Subscription Aspect Ratio Mapping**: maps aspect ratios (`16:9`, `3:2`, `9:16`, `2:3`) to appropriate subscription dimensions (`1536x1024` / `1024x1536`) instead of falling back to default square `1024x1024`.

### 🚀 What's New in v0.10.16
* **Safe Attachment Service Fallback (#214)**: Added graceful fallback handling in `saveAttachmentSafe` across all 8 visual tools (`generate_image`, variations, `remove_background`, `upscale_image`, `blend_images`, etc.). When running in headless CLI mode or when the attachment store is unavailable, outputs are safely written to disk with full file paths and data references rather than crashing tool execution.
* **HTTP Image Endpoint Strict Validation**: Hardened `/dsh-image-gen/image` route against malformed or NaN parameters (`b`, `w`, `h`), cleanly responding with HTTP 400 or 404 without leaking internal system traces.
* **ComfyUI Node Error Extraction**: Integrated `extractComfyNodeErrors` to parse node execution errors from `/history/{pid}` status responses, immediately reporting root-cause node diagnostics rather than timing out.
* **Custom Provider Error Normalization**: Standardized gateway error extracts through `formatErrorMessage`, eliminating raw JSON or `[object Object]` artifacts on 4xx/5xx API responses.
* **Cache & History Consistency**: Ensured content-addressed disk cache hits synchronize seamlessly with generation history and sidecar metadata.
* **Test Suite Expansion**: Added `test/batch4-hardening.test.mjs`, expanding test coverage to **128 automated unit tests (100% pass)**.

### 🚀 What's New in v0.10.15
* **Loop Guard Zero-Limit Bypass (#212)**: Fixed an edge case where setting `loopGuardLimit: 0` (configured to disable protection) enforced a limit of 1 due to `Math.max(1, limit)`. Setting limit to 0 now properly bypasses loop checks.
* **Security Hardening (Token Masking)**: Added automatic pattern masking for Replicate API tokens (`r8_...`) and Google Gemini API keys (`AIza...`) in `sanitizeErrorAndLogs`.
* **Cache Resilience**: Isolated LRU touch updates in `getCachedGeneration` so that metadata write contention does not discard valid image bytes on cache hits.
* **Defensive File Safety**: Added explicit file existence, empty file (0 bytes), and 50 MB maximum size cap checks in `resolveConversationImage` preventing OOM crashes on huge files.
* **Vectorize Image Attachment & Toolview Preview**: `vectorize_image` now registers the SVG in `ctx.attachments` and provides `url`, enabling interactive preview in `tool.call.toolview`.
* **SVG Markup Validation**: Added strict validation in `optimizeSvgContent` rejecting non-SVG strings with descriptive errors.
* **Cost Meter Safety**: Hardened `assertBudgetAvailable` to handle string/undefined/NaN values safely.
* **Expanded Test Suite**: Added `test/batch3-quality.test.mjs` expanding suite to **126 automated tests (100% pass)**.

### 🚀 What's New in v0.10.14
* **dsh-clinebot Unified Visual Overhaul (#210)**: Redesigned client settings card following the high-end `dsh-clinebot` unified design system. Added top quick stats row (`.ig-grid-4`, `.ig-stat-box`) showing active provider, default specs, safety/loop guard, and daily budget/cache status. Integrated status badges (`.ig-badge-ok/warn/bad`).
* **5 Categorized Settings Tabs**: Settings fields organized into intuitive tabs: ⚙️ General, 🔌 Provider, ✨ Prompt & Styles, 🛡️ Safety & Budget, ⚡ Cache & Storage.
* **Client ErrorBoundary Protection**: Wrapped all settings forms and toolviews in an `ErrorBoundary` with retry capability, preventing any component render crash from affecting DSH core UI.
* **Full Host Config ↔ Client Fields Synchronization**: Synchronized all 40 config properties between `Config` schema in `lib/index.js`, staged `FIELDS` in `lib/client.js`, and localization dictionaries (`en`/`ru`). Exposes controls: `qualityGate`, `dailyBudgetUsd`, `loopGuardLimit`, `diskCache`, `subscriptionQuality`, `cacheBySeed`, `cacheByPrompt`.
* **Complete Toolview Registration**: Registered `tool.call.toolview` for all 8 visual tools (`generate_image`, `edit_image`, `vary_image`, `blend_images`, `generate_image_pack`, `remove_background`, `upscale_image`, `vectorize_image`).
* **Safety, Budget & Loop Guard Hardening**: Extended `trackAndAssertLoopGuard`, `assertBudgetAvailable`, and `sanitizeErrorAndLogs` error masking across `edit_image`, `vary_image`, `blend_images`, `remove_background`, and `upscale_image`. Added `seedreamBaseURL` support.

### 🚀 What's New in v0.10.13
* **Plugin Settings Location (#208)**: Moved settings card exclusively into the standard `Settings → Plugins → Plugin settings` section (`settings.plugin.item` slot). Removed the legacy fallback to `settings.section` that previously caused duplicate entries in the top-level sidebar navigation.
* **Deferred Slot Injection (`registerSlotWhenReady`)**: Implemented robust deferred injection via `ctx.slots.inject` ensuring the settings card safely mounts when the parent settings container is rendered, eliminating timing collisions at startup.

### 🚀 What's New in v0.10.12
* **Fix Syntax Error (#208)**: Resolved variable redeclaration collision (`const hPrompt`) in `checkCache` within `lib/index.js` which could prevent plugin initialization on strict Node.js runtimes. Added automated syntax check across all source modules to test suite.

### 🚀 What's New in v0.10.11 (#165, #166, #167, #168, #169, #170)
* **Negative Prompt Sanitizer (#165)**: Automatic defect filtering and deduplication for diffusion models (SDXL, ComfyUI, Seedream, Local) with style-conflict protection (preserves intentional grainy, vintage, or dark aesthetics).
* **Automated Quality Gate & Silent Re-roll (#166)**: Heuristic variance and sharpness inspection combined with `dsh-vision-bridge` hook; performs silent re-rolls (up to 2 attempts) for blank, corrupted, or solid frames before returning results.
* **Cost Metering & Daily Budget (#167)**: Full rate card pricing per provider and resolution, spend tracking in `~/.dsh/storages/dsh-image-gen-spend.json`, dispatch to `dsh-cost-meter`, and hard daily budget enforcement via `dailyBudgetUsd`.
* **Fail-Fast Loop Guard (#168)**: Session-scoped circuit breaker prevents runaway agent retry loops (default max 3 consecutive generations without user interaction).
* **Secure Credential Masking (#169)**: Comprehensive masking of tokens in logs, URLs, and errors (`Bearer sk-...abcd`), with `0600` file permission enforcement.
* **Content-Addressed Disk Cache (#170)**: Instant retrieval (<50ms, zero API cost) for identical requests by SHA-256 hash, with automated LRU disk eviction (500 MB limit) and `force: true` bypass.

### 🚀 What's New in v0.10.10 (#201, #203)
* **Settings GUI Stabilization (#201)**: Fixed `booleanField` spec in client runtime that prevented the settings configuration pane from rendering in DSH Web UI. All configuration fields (providers, model identifiers, API credentials, style presets, LLM enhancer, timeouts, cache retention) render cleanly.
* **Streamlined Settings UI (#203)**: Removed the bulky in-settings history gallery to keep the configuration panel focused, fast, and organized.
* **Comprehensive Localization (#201)**: Added 100% dictionary coverage for all provider credentials, endpoints, and field hints in English and Russian.
* **Robust Slot Mounting**: Implemented `registerFirst` helper with graceful fallback between `settings.plugin.item` and `settings.section`.

## 🎨 Supported Generation Backends

* **`fal`** (Default): FAL.ai queue for FLUX.1, SDXL, Clarity Upscaler, and BiRefNet.
* **`replicate`**: FLUX and SDXL models via Replicate API.
* **`custom`**: OpenAI-compatible endpoint (DALL-E 3, SiliconFlow, Together AI, local gateways).
* **`codex`**: ChatGPT Plus/Pro subscription generation via `dsh-subscriptions` (OAuth).
* **`grok`**: Grok Imagine subscription generation via `dsh-subscriptions` (OAuth).
* **`local`**: Local ComfyUI workflow execution or Automatic1111 web API.
* **`seedream`**: ByteDance SeaDream generative API.
* **`gemini`**: Google Imagen 3 via GenAI API.

---

## 📦 Quick Installation

```bash
dsh plugin --profile web add @goodandready/dsh-image-gen
```

---

## 📄 License

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)