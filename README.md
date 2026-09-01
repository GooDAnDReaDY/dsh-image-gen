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

## 🛠️ Complete Tools Reference

* **`generate_image`**: Generate images with pluggable providers, seeds, aspect ratios, and style presets.
* **`remove_background`**: Extract subject with transparent PNG output (FAL BiRefNet / Rembg).
* **`upscale_image`**: 2x / 4x super-resolution with clarity reconstruction.
* **`vectorize_image`**: Convert raster graphics to clean scalable SVG vectors.
* **`blend_images`**: Multi-reference composition mixing.
* **`generate_image_pack`**: Simultaneous multi-aspect ratio rendering (1:1, 16:9, 9:16).
* **`compare_images`**: Pixel-level visual difference ratio comparison.
* **`inspect_image_quality`**: Automated visual audit and defect detection.

---

## 🎨 Supported Generation Backends

* **`fal`** (Default): High-speed queue for FLUX.1, SDXL, Clarity Upscaler, and BiRefNet.
* **`replicate`**: FLUX and SDXL models via Replicate API.
* **`custom`**: OpenAI-compatible endpoint (DALL-E 3, SiliconFlow, Together AI, local ComfyUI).
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