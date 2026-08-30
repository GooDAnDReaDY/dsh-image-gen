# 📦 @goodandready/dsh-image-gen

<div align="center">

[![npm version](https://img.shields.io/npm/v/@goodandready/dsh-image-gen.svg?style=flat-square)](https://www.npmjs.com/package/@goodandready/dsh-image-gen)
[![license](https://img.shields.io/github/license/GooDAnDReaDY/dsh-image-gen.svg?style=flat-square)](LICENSE)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-6366f1.svg?style=flat-square)](https://github.com/topics/dsh-plugin)

**[ 🇬🇧 English ](#-english) • [ 🇷🇺 Русский ](#-русский) • [ 🇨🇳 中文 ](#-中文)**

</div>

---

<a name="-english"></a>
## 🇬🇧 English

Image generation tool for DeepSeek Harness: a `generate_image` tool backed by FAL queue API and OpenAI-compatible endpoints, with rendered images shown directly inside the conversation.

### Features

- **Native Agent Tool**: Registers `generate_image(prompt, image_size?, num_images?, seed?)` in `ctx.tools`.
- **FAL Queue API**: Ultra-fast async rendering on FAL infrastructure (FLUX.1-schnell, FLUX.1-dev, SDXL, Lightning).
- **OpenAI-Compatible Backends**: Connect DALL-E 3, Together, SiliconFlow, or local ComfyUI/Automatic1111 endpoints.
- **Inline Chat Viewer**: Displays generated pictures with zoom, metadata inspecting, and one-click download.

### Install

```bash
dsh plugin --profile web add @goodandready/dsh-image-gen
```

### Configuration (Web GUI)

Settings → **Plugins → Plugin settings → Image Generation**:
- **Default Provider**: Choose between `fal` and custom OpenAI-compatible image endpoints.
- **Default Model**: e.g., `fal-ai/flux/schnell`, `dall-e-3`, `black-forest-labs/FLUX.1-schnell`.
- **API Credentials**: Reference `FAL_KEY` or `OPENAI_API_KEY` in DSH Credentials service.

---

<a name="-русский"></a>
<details open>
<summary><h2>🇷🇺 Русский (Полное руководство)</h2></summary>

Инструмент генерации изображений для DeepSeek Harness: инструмент `generate_image` на базе FAL Queue API и OpenAI-совместимых эндпоинтов с интерактивным просмотром в окне диалога.

### Возможности

- **Инструмент агента**: регистрирует `generate_image(prompt, image_size?, num_images?, seed?)` в `ctx.tools`.
- **FAL Queue API**: сверхбыстрая асинхронная генерация на инфраструктуре FAL (FLUX.1-schnell, FLUX.1-dev, SDXL).
- **OpenAI-совместимые API**: подключение DALL-E 3, Together, SiliconFlow, ComfyUI или Automatic1111.
- **Встроенный просмотрщик**: зум, просмотр промпта и параметров, скачивание в 1 клик.

### Установка

```bash
dsh plugin --profile web add @goodandready/dsh-image-gen
```

### Настройка (Web GUI)

Настройки → **Плагины → Настройки плагинов → Генерация изображений**:
- **Провайдер по умолчанию**: выбор между `fal` и OpenAI-совместимыми эндпоинтами.
- **Модель**: например, `fal-ai/flux/schnell` или `dall-e-3`.
- **Учётные данные**: привязка `FAL_KEY` или `OPENAI_API_KEY` через сервис Credentials.

</details>

---

<a name="-中文"></a>
<details>
<summary><h2>🇨🇳 中文 (完整技术文档)</h2></summary>

DeepSeek Harness 图像生成扩展插件：为智能体提供 `generate_image` 工具，支持 FAL 队列 API 与 OpenAI 格式接口，生成的图片直接在聊天界面中内嵌渲染。

### 核心亮点

- **智能体原生工具**：向 `ctx.tools` 注册 `generate_image(prompt, image_size?, num_images?, seed?)`。
- **FAL 队列 API 联动**：基于 FAL 极速生成网络（支持 FLUX.1-schnell、FLUX.1-dev、SDXL 等）。
- **兼容 OpenAI 图像接口**：支持接入 DALL-E 3、Together、SiliconFlow 及本地 ComfyUI 等端点。
- **内嵌图片查看器**：支持在聊天流中直接放大预览、查看生成参数及一键保存。

### 安装方法

```bash
dsh plugin --profile web add @goodandready/dsh-image-gen
```

</details>
