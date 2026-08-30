# 📦 @goodandready/dsh-image-gen

<div align="center">

<h3>DeepSeek Harness 智能体图像生成扩展插件（支持 FAL、OpenAI 与订阅通道）</h3>

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

## ⚡ 插件概览

**`dsh-image-gen`** 为 **DeepSeek Harness** 智能体提供 `generate_image` 图像生成工具，并将生成的画作直接内嵌渲染在聊天会话中。

```mermaid
graph LR
    Agent[🤖 DSH 智能体 / 工具调用] -->|generate_image 提示词| Plugin[dsh-image-gen 核心引擎]
    Plugin --> Switch{配置的绘图后端}
    
    Switch -->|默认极速队列| FAL[FAL.ai / FLUX.1 / SDXL]
    Switch -->|OpenAI 规范| Custom[自定义 API / ComfyUI]
    Switch -->|免 Key 订阅账号| Codex[ChatGPT / Grok 订阅通道]
    
    FAL --> Viewer[🖼️ 聊天卡片交互式查看器]
    Custom --> Viewer
    Codex --> Viewer
```

---

## 📦 安装指南

```bash
dsh plugin --profile web add @goodandready/dsh-image-gen
```

---

## 📄 开源协议

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)
