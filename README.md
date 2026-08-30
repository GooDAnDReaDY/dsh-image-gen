# 📦 @goodandready/dsh-image-gen

<div align="center">

<h3>Native Image Generation Tool with FAL Queue, OpenAI APIs, and Subscription Backends</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@goodandready/dsh-image-gen"><img src="https://img.shields.io/npm/v/@goodandready/dsh-image-gen.svg?style=for-the-badge&color=6366f1&labelColor=1e1b4b" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/GooDAnDReaDY/dsh-image-gen.svg?style=for-the-badge&color=10b981&labelColor=064e3b" alt="license"></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-Plugin-8b5cf6.svg?style=for-the-badge&labelColor=2e1065" alt="DSH Plugin"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-20%2B-f59e0b.svg?style=for-the-badge&labelColor=451a03" alt="Node version"></a>
</p>

<p align="center">
  <a href="README.md"><b>🇬🇧 English</b></a> •
  <a href="README.ru.md"><b>🇷🇺 Русский</b></a> •
  <a href="README.zh.md"><b>🇨🇳 中文说明</b></a>
</p>

</div>

---

## ⚡ Overview

**`dsh-image-gen`** equips your **DeepSeek Harness** agent with a versatile `generate_image` tool, rendering generated artwork directly in the conversation with zoom, parameter inspect, and instant download.

```mermaid
graph LR
    Agent[🤖 DSH Agent / Tool Call] -->|generate_image prompt| Plugin[dsh-image-gen Engine]
    Plugin --> Switch{Configured Backend}
    
    Switch -->|Default Queue| FAL[FAL.ai / FLUX.1 / SDXL]
    Switch -->|OpenAI Format| Custom[Custom API / ComfyUI]
    Switch -->|Subscription OAuth| Codex[ChatGPT / Grok Subscription]
    
    FAL --> Viewer[🖼️ Inline Chat Card Viewer]
    Custom --> Viewer
    Codex --> Viewer
```

---

## ✨ Key Features

* 🎨 **Multi-Backend Architecture**: Supports FAL Queue API, OpenAI-compatible image endpoints (DALL-E 3, SiliconFlow, Together), and ChatGPT/Grok OAuth subscriptions (via `dsh-subscriptions`).
* 🖼️ **Dedicated Tool Card Viewer**: Renders generated images with full-width responsive preview, lightbox zoom, and one-click download.
* 📦 **Flexible Delivery Modes**: Choose `link` (universal for text-only models) or `image` (for multimodal reasoning with `dsh-vision-bridge`).
* 🔒 **Subscription Support**: Leverage ChatGPT Plus/Pro or Grok subscriptions without paying per-image API costs.

---

## 📦 Quick Installation

```bash
dsh plugin --profile web add @goodandready/dsh-image-gen
```

---

## 📄 License

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)
