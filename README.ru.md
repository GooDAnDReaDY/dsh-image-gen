# 📦 @goodandready/dsh-image-gen

<div align="center">

<h3>Инструмент генерации изображений через FAL Queue, OpenAI API и личные подписки</h3>

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

## ⚡ Обзор

**`dsh-image-gen`** предоставляет агенту **DeepSeek Harness** инструмент `generate_image`, отображая сгенерированные изображения прямо в окне диалога с возможностью зума и скачивания.

```mermaid
graph LR
    Agent[🤖 Агент DSH / Tool Call] -->|generate_image промпт| Plugin[Движок dsh-image-gen]
    Plugin --> Switch{Выбранный бэкенд}
    
    Switch -->|Очередь по умолчанию| FAL[FAL.ai / FLUX.1 / SDXL]
    Switch -->|Формат OpenAI| Custom[OpenAI API / ComfyUI]
    Switch -->|Подписки OAuth| Codex[Подписка ChatGPT / Grok]
    
    FAL --> Viewer[🖼️ Встроенный просмотрщик в чате]
    Custom --> Viewer
    Codex --> Viewer
```

---

## ✨ Ключевые возможности

* 🎨 **Мультибэкенд архитектура**: поддержка FAL Queue, OpenAI-совместимых эндпоинтов и генерации через подписки ChatGPT/Grok (через `dsh-subscriptions`).
* 🖼️ **Интерактивный просмотрщик**: рендеринг картинок в чате с зумом и быстрым сохранением.
* 📦 **Два режима доставки**: `link` (работает с любыми текстовыми моделями) и `image` (для мультимодального анализа).

---

## 📦 Быстрая установка

```bash
dsh plugin --profile web add @goodandready/dsh-image-gen
```

---

## 📄 Лицензия

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)
