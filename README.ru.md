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
        T9[edit_image]
        T10[vary_image]
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
| **`edit_image`** | Направленное редактирование / inpainting с авто-поиском оригинала (#142, #144, #145) | `prompt`, `image` (по умолч. `latest`), `mask`, `strength` |
| **`vary_image`** | Генерация вариаций существующей картинки (#143, #144) | `image` (по умолч. `latest`), `prompt`, `variation_strength` (0.1–0.9), `count` |
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



## 🚀 Обновления v0.10.8: унификация Lossless JSON, Dual-Output и строгая валидация (#199)
- **Унификация Lossless JSON и Dual-Output**: Инструменты `upscale_image`, `remove_background`, `blend_images`, `vectorize_image` теперь гарантированно возвращают валидный `toLosslessJson` и генерируют структурированный `summary` с превью для текстовых LLM.
- **Строгая валидация входных изображений**: В инструментах `extract_design_tokens`, `image_to_css_gradient` и `check_image_contrast` добавлена явная проверка существования файла с информативной ошибкой (`Image not found or unreadable: <path>`).
- **Сквозное модульное тестирование**: Добавлен тест-сьют `test/tool-consistency.test.mjs` для проверки отказоустойчивости дизайн- и PWA-инструментов.

## 🚀 Обновления v0.10.4: жизненный цикл Cordis, полнота настроек и интернационализация
- **Жизненный цикл Cordis (#136)**: регистрация всех 7 инструментов обёрнута в `ctx.effect` для штатной отписки при перезагрузке плагина.
- **Полнота настроек в GUI (#137)**: в карточку настроек добавлены поля для Replicate, SeaDream, Gemini, Local ComfyUI/A1111, пресетов стилей и LLM-улучшителя.
- **Манифест зависимостей (#138)**: в `peerDependencies` задекларированы все используемые службы ядра (`host-webserver`, `settings`, `llm`, `system-prompt`).
- **Оптимизация компонентов (#139)**: из `FalImageCard` удалён неиспользуемый мёртвый стейт.
- **100% интернационализация (#140)**: устранены захардкоженные русские строки, добавлены переводы на русский, английский и китайский языки.


### 🚀 Что нового в v0.10.14
* **Единый дизайн в стиле dsh-clinebot (#210)**: Интерфейс настроек переработан в соответствии со стандартами `dsh-clinebot`. Добавлен верхний дашборд быстрой статистики (`.ig-grid-4`, `.ig-stat-box`), отображающий активного провайдера, формат и размер, статус Quality Gate и лимит Loop Guard, дневной бюджет и состояние кэша.
* **5 категорий настроек (табы)**: Поля сгруппированы по вкладкам: ⚙️ Основные, 🔌 Провайдер, ✨ Промпт и стили, 🛡️ Безопасность и бюджет, ⚡ Кэш и хранение.
* **Защита интерфейса через ErrorBoundary**: Все формы настроек и тулвью обёрнуты в компонент `ErrorBoundary` с возможностью повтора (Retry), что изолирует возможные ошибки отрисовки от основного интерфейса DSH.
* **Полная синхронизация Config ↔ Client FIELDS ↔ Словари**: Синхронизированы все 40 параметров конфигурации. В интерфейс выведены управление `qualityGate`, `dailyBudgetUsd`, `loopGuardLimit`, `diskCache`, `subscriptionQuality`, `cacheBySeed`, `cacheByPrompt`.
* **Регистрация Toolview для всех 8 визуальных инструментов**: Карточка `tool.call.toolview` теперь регистрируется для `generate_image`, `edit_image`, `vary_image`, `blend_images`, `generate_image_pack`, `remove_background`, `upscale_image`, `vectorize_image`.
* **Комплексная защита от циклов и утечек API-ключей**: Расширено действие `trackAndAssertLoopGuard`, проверки бюджета `assertBudgetAvailable` и санитизации ошибок `sanitizeErrorAndLogs` на инструменты `edit_image`, `vary_image`, `blend_images`, `remove_background`, `upscale_image`. Добавлен параметр `seedreamBaseURL`.

### 🚀 Что нового в v0.10.13
* **Размещение карточки настроек (#208)**: Карточка настроек плагина перенесена строго в стандартную вкладку «Настройки → Плагины → Настройки плагинов» (слот `settings.plugin.item`). Удалён устаревший запасной путь `settings.section`, из-за которого настройки отображались отдельным пунктом в общем корневом меню настроек.
* **Безопасная отложенная регистрация слота (`registerSlotWhenReady`)**: Регистрация через `ctx.slots.inject` гарантирует корректную загрузку и монтирование формы настроек при открытии страницы в DSH UI без ошибок синхронизации.

### 🚀 Что нового в v0.10.12
* **Исправление синтаксической ошибки (#208)**: Устранено повторное объявление переменной (`const hPrompt`) в функции `checkCache` внутри `lib/index.js`. Добавлена автоматическая проверка синтаксиса всех модулей в набор юнит-тестов.

### 🚀 Что нового в v0.10.11 (#165, #166, #167, #168, #169, #170)
* **Negative Prompt Sanitizer (#165)**: Автоматическая санитизация и дедупликация негативных промптов для диффузионных моделей (SDXL, ComfyUI, Seedream, Local) с защитой от конфликта стилей (сохраняет намеренно запрошенную зернистость, винтажность или тени).
* **Quality Gate и Silent Re-roll (#166)**: Экспресс-контроль резкости/энтропии кадра и интеграция с `dsh-vision-bridge` с автоматическим тихим ре-роллом дефектных, пустых или черных кадров (до 2 попыток).
* **Интеграция с dsh-cost-meter и суточный бюджет (#167)**: Тарифная сетка по провайдерам и разрешениям, фиксация расходов в `~/.dsh/storages/dsh-image-gen-spend.json` и защита от перерасхода суточного бюджета (`dailyBudgetUsd`).
* **Fail-Fast Loop Guard (#168)**: Защита от бесконечного зацикливания агента в рамках сессии (максимум 3 последовательные генерации подряд без ответа пользователя).
* **Маскирование ключей и безопасность (#169)**: Полная санитизация токенов в логах, ошибках и URL (`Bearer sk-...abcd`) и права доступа `0600` на файлы конфигурации.
* **Контентно-адресуемый дисковый кэш (#170)**: Мгновенная отдача (<50мс, нулевая стоимость) повторных идентичных генераций по SHA-256 хэшу параметров с автоочисткой по LRU (лимит 500 МБ) и опцией принудительного обхода `force: true`.

### 🚀 Что нового в v0.10.10 (#201, #203)
* **Стабилизация окна настроек GUI (#201)**: Исправлена спецификация `booleanField` в клиентском коде, вызывавшая падение рендера карточки настроек плагина в DSH Web UI. Форма настроек теперь открывается штатно со всеми полями, селекторами провайдеров, моделями, ссылками на ключи и пресетами.
* **Очистка интерфейса настроек (#203)**: Из окна настроек убрана встроенная галерея истории генераций, загромождавшая карточку настроек.
* **Полная локализация (#201)**: Добавлены все недостающие строки переводов и подсказок на русском и английском языках для всех поддерживаемых провайдеров.
* **Надёжная регистрация слотов**: Реализован `registerFirst` с плавным откатом между `settings.plugin.item` и `settings.section`.

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