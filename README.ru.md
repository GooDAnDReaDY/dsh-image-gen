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

**`dsh-image-gen`** предоставляет агенту **DeepSeek Harness** инструмент `generate_image` и размещает сгенерированные изображения прямо в ленте диалога с поддержкой зума, просмотра метаданных и скачивания в 1 клик.

Выбор сервиса для отрисовки настраивается в параметрах без изменения кода: переключайтесь между очередью FAL, сторонними OpenAI-совместимыми эндпоинтами или личными подписками ChatGPT/Grok.

```mermaid
graph LR
    subgraph Trigger [Вызов агента]
        Agent[🤖 Промпт агента: Нарисуй картинку] --> ToolCall[Инструмент: generate_image]
    end

    subgraph Dispatcher [Диспетчер бэкендов dsh-image-gen]
        ToolCall --> Router{Выбор провайдера}
        Router -->|Очередь FAL API| FAL[FAL.ai: FLUX.1-schnell / dev / SDXL]
        Router -->|Формат OpenAI| Custom[OpenAI API / SiliconFlow / ComfyUI]
        Router -->|Подписки OAuth| Codex[Подписка ChatGPT Plus/Pro / Grok]
    end

    subgraph Delivery [Отображение в чате]
        FAL --> Handler[Обработчик / GET /dsh-image-gen/image]
        Custom --> Handler
        Codex --> Handler
        Handler --> Viewer[🖼️ Интерактивная карточка в чате с зумом]
    end

    style Trigger fill:#1e1e2e,stroke:#89b4fa,stroke-width:2px,color:#cdd6f4
    style Dispatcher fill:#181825,stroke:#cba6f7,stroke-width:2px,color:#cdd6f4
    style Delivery fill:#11111b,stroke:#a6e3a1,stroke-width:2px,color:#cdd6f4
```

---

## 🎨 Поддерживаемые бэкенды генерации

| Провайдер | Бэкенд | Учётные данные | Описание и модели |
|---|---|---|---|
| `fal` (дефолт) | [FAL.ai](https://fal.ai) Queue | `FAL_API_KEY` | Сверхбыстрая генерация (`fal-ai/flux-2/klein/9b`, `FLUX.1-schnell`, `SDXL`) |
| `custom` | OpenAI-совместимый API | `OPENAI_API_KEY` | Подключение DALL-E 3, SiliconFlow, Together или локального ComfyUI |
| `codex` | Подписка ChatGPT (`gpt-image-2`) | *Без ключа (OAuth)* | Использование аккаунта ChatGPT из `dsh-subscriptions` без платы за API |
| `grok` | Подписка Grok (`grok-imagine-image-2.0`) | *Без ключа (OAuth)* | Использование аккаунта Grok из `dsh-subscriptions` без платы за API |

---

## 📐 Таблица трансляции именованных размеров

Агент задает размер в универсальном именованном виде (`image_size`). Плагин автоматически переводит его под формат активного сервиса:

| Имя размера | Имя в FAL | Пиксели для OpenAI / Custom | Пропорции для Grok |
|---|---|---|---|
| `square_hd` (дефолт) | `square_hd` | `1024x1024` | `1:1` |
| `square` | `square` | `512x512` | `1:1` |
| `landscape_4_3` | `landscape_4_3` | `1024x768` | `4:3` |
| `landscape_16_9` | `landscape_16_9` | `1792x1024` | `16:9` |
| `portrait_4_3` | `portrait_4_3` | `768x1024` | `3:4` |
| `portrait_16_9` | `portrait_16_9` | `1024x1792` | `9:16` |

> [!TIP]
> Если кастомный эндпоинт требует нестандартного разрешения, укажите `customSize` (например `1280x720`) в настройках для передачи точной строки.

---

## 🔑 Генерация через подписки без API-ключей (`codex` и `grok`)

`codex` и `grok` **не требуют API-ключей**. Они используют активную сессию из [`dsh-subscriptions`](https://github.com/GooDAnDReaDY/dsh-subscriptions):
* **Внутрипроцессный обмен**: плагины общаются через сервисы Cordis внутри процесса Node.js без сетевых HTTP-вызовов, что исключает утечку сессионных токенов.
* **Качество подписки**: настройка детализации через `subscriptionQuality` (`low`, `medium`, `high`).
* **Понятные ошибки**: если `dsh-subscriptions` не установлен или аккаунт отключен, инструмент выдаёт понятное предупреждение.

---

## 📦 Режимы доставки: `link` или `image`

| Сравнение | Режим `link` (По умолчанию) | Режим `image` |
|---|---|---|
| **Что получает модель чата** | Текст и ссылку на файл | Бинарные данные картинки |
| **Отображение в Web UI** | Да, интерактивная карточка | Да |
| **Работа с текстовыми LLM** | **Да, полностью самостоятельно** | Требуется [`dsh-vision-bridge`](https://github.com/GooDAnDReaDY/dsh-vision-bridge) |
| **Анализ картинки моделью** | По тексту промпта и ссылке | Полноценный визуальный анализ |
| **Долговечность ссылки** | Постоянный роут хоста (`GET /image`) | CDN провайдера (срок жизни ограничен) |

---

## 🎮 Пример использования

Просто попросите агента:
> "Сгенерируй фотореалистичную улицу Токио ночью в стиле киберпанк под дождём, неоновые отражения, 16:9"

### Параметры инструмента

| Параметр | Тип | Описание |
|---|---|---|
| `prompt` | `string` (Обязательный) | Детальное текстовое описание генерируемого изображения |
| `image_size` | `string` | `square_hd`, `square`, `landscape_4_3`, `landscape_16_9`, `portrait_4_3`, `portrait_16_9` |
| `seed` | `number` | Сид для детерминированной повторяемости результата |
| `output_format` | `string` | Формат файла: `png` (по умолчанию), `jpeg` или `webp` |
| `output_name` | `string` | Пользовательское имя файла без расширения |

---

## 📦 Быстрая установка

```bash
dsh plugin --profile web add @goodandready/dsh-image-gen
```

---

## ⚙️ Рецепты конфигурации (`settings.yaml`)

### 1. Настройка FAL.ai (По умолчанию)
```yaml
dsh-image-gen:
  provider: fal
  model: fal-ai/flux-2/klein/9b
  apiKeyEnv: FAL_API_KEY
  defaultSize: landscape_4_3
  defaultFormat: png
  outputDir: generated/images
```

### 2. Подключение OpenAI / SiliconFlow
```yaml
dsh-image-gen:
  provider: custom
  customBaseURL: https://api.siliconflow.cn/v1
  customModel: black-forest-labs/FLUX.1-schnell
  customKeyEnv: SILICONFLOW_API_KEY
  defaultSize: square_hd
```

### 3. Локальный ComfyUI / Шлюз (Без авторизации)
```yaml
dsh-image-gen:
  provider: custom
  customBaseURL: http://127.0.0.1:8188/v1
  customModel: sd-xl-base-1.0
  customKeyEnv: ""   # Пусто = без заголовка Authorization
```

### 4. Генерация через подписку ChatGPT / Grok
```yaml
dsh-image-gen:
  provider: codex   # или 'grok'
  subscriptionQuality: high
  defaultSize: landscape_16_9
```

---

## 🖼️ Почему у плагина собственная карточка инструмента

Стандартные карточки DSH отображают только JSON. `dsh-image-gen` регистрирует слот `tool.call.toolview` для инструмента `generate_image` и отдаёт картинку через свой защищённый маршрут (`GET /dsh-image-gen/image`), показывая изображение прямо в интерфейсе чата.

---

## 🔄 Миграция с `dsh-fal-image-gen`

Установка `@goodandready/dsh-image-gen` автоматически подхватывает настройки из пространства `dsh-fal-image-gen`, а все ранее сгенерированные изображения в старых сессиях продолжают корректно отображаться.

---

## 📄 Лицензия

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)
