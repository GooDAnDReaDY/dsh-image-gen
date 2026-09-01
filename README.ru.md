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

**`@goodandready/dsh-image-gen`** — флагманский графический плагин для экосистемы DeepSeek Harness, превращающий агента в полноценную творческую студию. Плагин предоставляет богатый набор инструментов для генерации, трансформации, апскейла, векторизации и анализа изображений с поддержкой 8 провайдеров генерации и интерактивной карточкой в чате.

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

    subgraph Engine [⚙️ Диспетчер бэкендов]
        Router{Умный маршрутизатор}
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
        Sidecar[.json Sidecar + PNG tEXt]
        Attach[ctx.attachments & Disk]
        Card[🖼️ Карточка в чате с Re-roll, Upscale, NoBG]
    end

    Input --> Tools
    Tools --> Router
    Router --> P_FAL & P_REP & P_CUST & P_COD & P_GROK & P_LOC & P_SEA & P_GEM
    P_FAL & P_REP & P_CUST & P_COD & P_GROK & P_LOC & P_SEA & P_GEM --> Sidecar
    Sidecar --> Attach --> Card

    style Input fill:#1e1e2e,stroke:#89b4fa,stroke-width:2px,color:#cdd6f4
    style Tools fill:#181825,stroke:#cba6f7,stroke-width:2px,color:#cdd6f4
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
| **`vectorize_image`** | Векторизация растра в чистый SVG | `image`, `color_mode` (`color`/`binary`) |
| **`blend_images`** | Смешивание нескольких изображений в единую композицию | `images`, `weights`, `prompt` |
| **`generate_image_pack`** | Пакетный рендеринг форматов 1:1, 16:9, 9:16 под соцсети | `prompt`, `aspect_ratios` |
| **`compare_images`** | Сравнение двух картинок (доля различий пикселей) | `image_a`, `image_b` |
| **`inspect_image_quality`** | Аудит качества и артефактов генерации | `image`, `expected_elements` |

---

## 🎨 Поддерживаемые провайдеры генерации

| Провайдер | Бэкенд | Ключи / Доступ | Назначение и особенности |
|---|---|---|---|
| **`fal`** *(дефолт)* | FAL.ai Queue | `FAL_API_KEY` | Сверхбыстрая генерация (`FLUX.1-schnell`, `FLUX-dev`, `SDXL`), Upscaler, BiRefNet |
| **`replicate`** | Replicate API | `REPLICATE_API_TOKEN` | Модели сообщества (`black-forest-labs/flux-schnell`, `stability-ai/sdxl`) |
| **`custom`** | OpenAI-совместимый эндпоинт | `OPENAI_API_KEY` | DALL-E 3, SiliconFlow, Together AI, локальный OpenAI шлюз |
| **`codex`** | ChatGPT Plus/Pro | *Без ключа (OAuth)* | Использование учетной записи из `dsh-subscriptions` без тарификации API |
| **`grok`** | Grok Imagine | *Без ключа (OAuth)* | Использование учетной записи Grok из `dsh-subscriptions` без тарификации API |
| **`local`** | Локальный сервер | *Не требуется* | ComfyUI (граф нод / prompt queue) или Automatic1111 (txt2img/img2img) |
| **`seedream`** | ByteDance Doubao / SeaDream | `SEEDREAM_API_KEY` | Азиатские фотореалистичные генеративные модели |
| **`gemini`** | Google GenAI API | `GEMINI_API_KEY` | Imagen 3 через официальный Gemini API |

---

## 🎭 Библиотека стилей (`style_presets`)

Плагин содержит встроенные профили стилизации:
* **`cinematic`**: Кинематографичный кадр, 35mm оптика, естественный свет и глубина резкости.
* **`anime`**: Аниме-эстетика в стиле Макото Синкая, сочные цвета, тонкий лайн-арт.
* **`isometric`**: Изометрический 3D-рендер, пластилиновый стиль, мягкий студийный свет.
* **`cyberpunk`**: Киберпанк, неоновые отражения, объемный туман, ночная атмосфера.
* **`pixel_art`**: 16-битный ретро пиксель-арт, четкие контуры, дизеринг.
* **`oil_painting`**: Классическая масляная живопись, фактура холста, пастозные мазки.
* **`minimalist`**: Минималистичный плоский вектор, чистые линии, строгая геометрия.

---

## 🖼️ Интерактивная карточка в чате

Встроенный слот Web UI (`tool.call.toolview`) обеспечивает:
* **Кнопки быстрых действий**:
  * 🔄 **Re-roll**: повторная генерация со следующим сидом;
  * 🔍 **2x Upscale**: быстрый вызов инструмента увеличения разрешения;
  * ✂️ **Remove BG**: вырезание фона в прозрачный PNG;
  * 📋 **Копирование промпта и сида** в буфер обмена в один клик.
* **Вшивание метаданных**: параметры генерации (промпт, сид, модель) автоматически внедряются в `tEXt` чанки PNG-файлов.
* **Sidecar JSON**: для каждого файла создается `.json` файл с полными параметрами генерации, стоимостью и таймстемпом.

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
  model: fal-ai/flux-2/klein/9b          # Идентификатор модели по умолчанию
  apiKeyEnv: FAL_API_KEY                 # Переменная окружения для ключа
  defaultSize: landscape_4_3             # square_hd | landscape_4_3 | landscape_16_9 | portrait_4_3 | portrait_16_9
  defaultFormat: png                     # png | jpeg | webp
  replicateModel: black-forest-labs/flux-schnell
  replicateKeyEnv: REPLICATE_API_TOKEN
  outputDir: generated/images            # Каталог сохранения готовых изображений
```

---

## 📄 Лицензия

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)