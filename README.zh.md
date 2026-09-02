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

## ⚡ 核心功能与架构提升 (v0.10.0)

**`@goodandready/dsh-image-gen`** 为 DeepSeek Harness 提供工业级高可用的图像生成与视觉处理工具链：
* **8大后端全面支持**: FAL.ai、Replicate、OpenAI/SiliconFlow、ChatGPT Plus (OAuth)、Grok Imagine (OAuth)、ComfyUI/A1111 本地生成、ByteDance SeaDream 与 Google Imagen 3。
* **指数退避与 Jitter 队列防爆**: 针对 FAL 与 Replicate 异步队列引入智能 Backoff 轮询，彻底杜绝 429 报错。
* **确定性哈希缓存 (Deterministic Cache)**: 相同 Prompt 与 Seed 的重复请求直接从本地秒级返回，零 API 消耗。
* **ComfyUI / Automatic1111 拖拽直通**: PNG 元数据原生内嵌标准 `Parameters` 块，生成图片可直接拖入 WebUI/ComfyUI 还原参数。
* **尺寸 64 倍数自动对齐**: 自动对齐 VAE 运算尺寸，避免图像失真。
* **多风格预设增强**: 内置 `cinematic`、`anime` 等风格的独立 Negative Prompt 与 Guidance Scale 优化。

---

## 📦 安装

```bash
dsh plugin --profile web add @goodandready/dsh-image-gen
```

---

## 📄 许可证

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)