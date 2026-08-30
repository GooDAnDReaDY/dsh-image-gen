# 📦 @goodandready/dsh-image-gen

<div align="center">

<h3>DeepSeek Harness 智能体图像生成扩展插件（支持 FAL、OpenAI 规范与免 Key 订阅账号）</h3>

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

**`dsh-image-gen`** 为 **DeepSeek Harness** 智能体赋予 `generate_image` 图像生成能力，并将生成的画作直接在聊天流中内嵌渲染，支持缩放与一键下载。

```mermaid
graph LR
    subgraph Trigger [智能体交互]
        Agent[🤖 提示词: 帮我画一张图] --> ToolCall[调用工具: generate_image]
    end

    subgraph Dispatcher [dsh-image-gen 调度中枢]
        ToolCall --> Router{服务商分发}
        Router -->|FAL 极速队列| FAL[FAL.ai: FLUX.1 / SDXL]
        Router -->|OpenAI 规范接口| Custom[自定义 API / SiliconFlow / ComfyUI]
        Router -->|免 Key 订阅账号| Codex[ChatGPT Plus/Pro / Grok 订阅通道]
    end

    subgraph Delivery [聊天面板展示]
        FAL --> Handler[附件处理 / GET /dsh-image-gen/image]
        Custom --> Handler
        Codex --> Handler
        Handler --> Viewer[🖼️ 交互式图片卡片查看器]
    end

    style Trigger fill:#1e1e2e,stroke:#89b4fa,stroke-width:2px,color:#cdd6f4
    style Dispatcher fill:#181825,stroke:#cba6f7,stroke-width:2px,color:#cdd6f4
    style Delivery fill:#11111b,stroke:#a6e3a1,stroke-width:2px,color:#cdd6f4
```

---

## 🎨 支持的绘图后端

| 服务商 | 后端服务 | 鉴权要求 | 说明与常用模型 |
|---|---|---|---|
| `fal` (默认) | [FAL.ai](https://fal.ai) Queue | `FAL_API_KEY` | 极速生图网络 (`fal-ai/flux-2/klein/9b`, `FLUX.1-schnell`, `SDXL`) |
| `custom` | OpenAI 格式接口 | `OPENAI_API_KEY` | 支持 DALL-E 3、硅基流动、Together 或本地 ComfyUI |
| `codex` | ChatGPT 订阅绘图 (`gpt-image-2`) | *免 Key (OAuth)* | 直接复用 `dsh-subscriptions` 中的 ChatGPT 账号 |
| `grok` | Grok 订阅绘图 (`grok-imagine-image-2.0`) | *免 Key (OAuth)* | 直接复用 `dsh-subscriptions` 中的 Grok 账号 |

---

## 📦 安装指南

```bash
dsh plugin --profile web add @goodandready/dsh-image-gen
```

---

## 📄 开源协议

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)
