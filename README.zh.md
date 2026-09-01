# 📦 @goodandready/dsh-image-gen

<div align="center">

<h3>DeepSeek Harness 全能图像生成与视觉处理插件</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@goodandready/dsh-image-gen"><img src="https://img.shields.io/npm/v/@goodandready/dsh-image-gen.svg?style=for-the-badge&color=6366f1&labelColor=1e1b4b" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/GooDAnDReaDY/dsh-image-gen.svg?style=for-the-badge&color=10b981&labelColor=064e3b" alt="license"></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-Plugin-8b5cf6.svg?style=for-the-badge&labelColor=2e1065" alt="DSH Plugin"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-20%2B-f59e0b.svg?style=for-the-badge&labelColor=451a03" alt="Node version"></a>
</p>

<p align="center">
  <a href="https://goodandready.app/"><img src="https://img.shields.io/badge/作者所有项目-goodandready.app-ff4500.svg?style=for-the-badge&logo=rocket&logoColor=white&labelColor=1a1a2e" alt="所有项目"></a>
</p>

<p align="center">
  <a href="README.md"><b>🇬🇧 English</b></a> •
  <a href="README.ru.md"><b>🇷🇺 Русский</b></a> •
  <a href="README.zh.md"><b>🇨🇳 中文说明</b></a>
</p>

</div>

---

## ⚡ 核心功能

**`@goodandready/dsh-image-gen`** 为 DeepSeek Harness 提供完整的图像生成与视觉处理工具链：
* **8大后端支持**: FAL.ai、Replicate、OpenAI/SiliconFlow、ChatGPT Plus (OAuth)、Grok Imagine (OAuth)、ComfyUI/A1111 本地生成、ByteDance SeaDream 与 Google Imagen 3。
* **丰富工具箱**: `generate_image`、`remove_background` (抠图)、`upscale_image` (超分辨率放大)、`vectorize_image` (转矢量 SVG)、`blend_images` (多图融合)、`generate_image_pack` (多比例适配) 与 `compare_images`。
* **交互式卡片**: 聊天窗口内置 Re-roll 重新生成、2x 超分、一键抠图与 Prompt/Seed 快速复制。

---

## 📦 安装

```bash
dsh plugin --profile web add @goodandready/dsh-image-gen
```

---

## 📄 许可证

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)