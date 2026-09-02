# 📦 @goodandready/dsh-image-gen

<div align="center">

<h3>Комплексный графический комбайн и генератор изображений для DeepSeek Harness</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@goodandready/dsh-image-gen"><img src="https://img.shields.io/npm/v/@goodandready/dsh-image-gen.svg?style=for-the-badge&color=6366f1&labelColor=1e1b4b" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/GooDAnDReaDY/dsh-image-gen.svg?style=for-the-badge&color=10b981&labelColor=064e3b" alt="license"></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-Plugin-8b5cf6.svg?style=for-the-badge&labelColor=2e1065" alt="DSH Plugin"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-20%2B-f59e0b.svg?style=for-the-badge&labelColor=451a03" alt="Node version"></a>
</p>

<p align="center">
  <a href="https://goodandready.app/"><img src="https://img.shields.io/badge/Все_проекты_автора-goodandready.app-ff4500.svg?style=for-the-badge&logo=rocket&logoColor=white&labelColor=1a1a2e" alt="Все проекты автора"></a>
</p>

<p align="center">
  <a href="README.md"><b>🇬🇧 English</b></a> •
  <a href="README.ru.md"><b>🇷🇺 Русский</b></a> •
  <a href="README.zh.md"><b>🇨🇳 中文说明</b></a>
</p>

</div>

---

## ⚡ Обзор возможностей

**`@goodandready/dsh-image-gen`** — флагманский графический плагин для экосистемы DeepSeek Harness, превращающий агента в полноценную творческую студию. Плагин предоставляет богатый набор инструментов для генерации, трансформации, апскейла, векторизации и анализа изображений с поддержкой 8 провайдеров генерации, интеллектуальным кэшированием и интерактивной карточкой в чате.

```mermaid
graph LR
    subgraph Input [🤖 Агент и Пользователь]
        Agent[Промпт / Задача агента]
        UserUI[Интерактивные кнопки / Чат]
    end

    subgraph Tools [🛠️ Пакет инструментов]
        T1[generate_image]
        T2[remove_background]
        T3[upscale_image]
        T4[vectorize_image]
        T5[blend_images]
        T6[generate_image_pack]
        T7[compare_images]
        T8[inspect_image_quality]
    end

    subgraph Core [🛡️ Ядро надежности и кэша]
        Cache[Детерминированный sha256 Hash Cache]
        Backoff[Exponential Backoff + Jitter]
        Classifier[Классификатор фатальных ошибок 400]
        Snap64[VAE 64-Multiple Dimension Snapping]
    end

    subgraph Engine [⚙️ Диспетчер бэкендов]
        P_FAL[FAL.ai Queue]
        P_REP[Replicate API]
        P_CUST[OpenAI / SiliconFlow]
        P_COD[ChatGPT Plus/Pro OAuth]
        P_GROK[Grok Imagine OAuth]
        P_LOC[ComfyUI / A1111]
        P_SEA[ByteDance SeaDream]
        P_GEM[Google Imagen 3]
    end

    subgraph Store [💾 Хранение и UI]
        Sidecar[.json Sidecar + Parameters tEXt]
        A1111[Drag-and-Drop в ComfyUI / WebUI]
        Card[🖼️ Карточка в чате с Re-roll, Правкой, NoBG]
    end

    Input --> Tools
    Tools --> Core
    Core --> Engine
    Engine --> Store

    style Input fill:#1e1e2e,stroke:#89b4fa,stroke-width:2px,color:#cdd6f4
    style Tools fill:#181825,stroke:#cba6f7,stroke-width:2px,color:#cdd6f4
    style Core fill:#11111b,stroke:#fab387,stroke-width:2px,color:#cdd6f4
    style Engine fill:#11111b,stroke:#a6e3a1,stroke-width:2px,color:#cdd6f4
    style Store fill:#1e1e2e,stroke:#f38ba8,stroke-width:2px,color:#cdd6f4
```

---

## 🛠️ Полный реестр инструментов

| Инструмент | Назначение | Ключевые параметры |
|---|---|---|
| **`generate_image`** | Генерация изображения по тексту | `prompt`, `image_size`, `seed`, `style`, `negative_prompt`, `count` |
| **`remove_background`** | Удаление фона с сохранением прозрачного PNG | `image`, `model`, `output_name` |
| **`upscale_image`** | Увеличение разрешения в 2x / 4x с детализацией | `image`, `scale` (2/4), `prompt`, `creativity` |
| **`vectorize_image`** | Векторизация растра в чистый SVG с квантованием палитры | `image`, `color_mode`, `paletteSize` |
| **`blend_images`** | Смешивание нескольких изображений в единую композицию | `images`, `weights`, `prompt` |
| **`generate_image_pack`** | Пакетный рендеринг форматов 1:1, 16:9, 9:16 с сохранением частичных результатов | `prompt`, `aspect_ratios` |
| **`compare_images`** | Сравнение двух картинок (доля различий пикселей) | `image_a`, `image_b` |
| **`inspect_image_quality`** | Аудит качества, расчет резкости и проверка дефектов | `image`, `expected_elements` |

---

## 🛡️ Отказоустойчивость, производительность и качество (v0.10.0)

* **Экспоненциальный Backoff с Jitter**: опрос очередей генерации (FAL, Replicate, ComfyUI) автоматически адаптирует задержки, исключая ошибки `429 Too Many Requests`.
* **Классификатор ошибок в Fallback Cascade**: клиентские ошибки (Content Policy, 400 Bad Request, NSFW) отсекаются немедленно, предотвращая пустую трату денег на резервных провайдерах.
* **Детерминированный хэш-кэш**: повторные генерации с тем же промптом, моделью и сидом отдаются мгновенно из локального кэша с нулевой стоимостью API.
* **Совместимость с ComfyUI / Automatic1111**: метаданные вшиваются в PNG `tEXt` чанки в стандартном формате `Parameters: Prompt\nNegative prompt: ...\nSteps: ... Seed: ...`, обеспечивая нативный Drag-and-Drop.
* **Кратность 64**: все пользовательские и адаптивные размеры автоматически округляются до кратных 64 для исключения искажений VAE.
* **Обогащенные пресеты стилей**: каждый стиль в `STYLE_PRESETS` содержит индивидуальный `negative_prompt` и рекомендуемый `guidance_scale`.

---

## 🎨 Поддерживаемые провайдеры генерации

* **`fal`** *(дефолт)*: Сверхбыстрая очередь FAL.ai (`FLUX.1-schnell`, `FLUX-dev`, `SDXL`, BiRefNet, Clarity Upscaler).
* **`replicate`**: Модели сообщества через Replicate API.
* **`custom`**: Любой OpenAI-совместимый эндпоинт (DALL-E 3, SiliconFlow, Together AI, локальный шлюз).
* **`codex`**: Генерация через ChatGPT Plus/Pro подписку (`dsh-subscriptions` OAuth без оплаты токенов).
* **`grok`**: Генерация через Grok Imagine подписку (`dsh-subscriptions` OAuth).
* **`local`**: Локальный ComfyUI (граф нод) или Automatic1111 (SD WebUI).
* **`seedream`**: ByteDance Doubao / SeaDream API.
* **`gemini`**: Google Imagen 3 через GenAI API.

---

## 📦 Быстрая установка

```bash
dsh plugin --profile web add @goodandready/dsh-image-gen
```

---

## ⚙️ Пример конфигурации (`settings.yaml`)

```yaml
dsh-image-gen:
  provider: fal                          # fal | replicate | custom | codex | grok | local | seedream | gemini
  model: fal-ai/flux-2/klein/9b          # Модель по умолчанию
  apiKeyEnv: FAL_API_KEY                 # Переменная окружения для ключа
  defaultSize: landscape_4_3             # square_hd | landscape_4_3 | landscape_16_9 | portrait_4_3 | portrait_16_9
  defaultFormat: png                     # png | jpeg | webp
  cacheBySeed: true                      # Детерминированное кэширование повторных запросов
  pruneDays: 30                          # Автоочистка файлов и sidecar старше 30 дней
  outputDir: generated/images            # Каталог сохранения готовых изображений
```

---

## 📄 Лицензия

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)