
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

</div>

---

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