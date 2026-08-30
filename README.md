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

# dsh-image-gen

**Image generation** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

The plugin gives the agent one tool, `generate_image`, and puts the result where
a picture belongs — in the conversation. Which service actually draws it is a
setting, not a rewrite: a paid API key, your own OpenAI-compatible endpoint, or a
consumer subscription you are already paying for.

A generated image is:

- shown inline in the conversation, in the plugin's own tool card;
- saved into the session working directory (`<session cwd>/generated/images/*.png`);
- returned to the model with its path, size and seed.

> **Renamed.** This plugin used to be `dsh-fal-image-gen`. FAL is now one
> provider out of four, and the old name said otherwise. Upgrading carries your
> settings over by itself, and images in existing conversations keep working —
> see [Upgrading from dsh-fal-image-gen](#upgrading-from-dsh-fal-image-gen).

## Providers

| `provider` | What it is | What it needs |
|---|---|---|
| `fal` (default) | the [FAL](https://fal.ai) queue, default model `fal-ai/flux-2/klein/9b` | a FAL API key |
| `custom` | any OpenAI-compatible images API — OpenAI itself, a local gateway, anything speaking that shape | a base URL, a model id, usually a key |
| `codex` | ChatGPT's image model (`gpt-image-2`) on your ChatGPT subscription | no key — a ChatGPT account connected in `dsh-subscriptions` |
| `grok` | Grok's image model (`grok-imagine-image-2.0`) on your Grok subscription | no key — a Grok account connected in `dsh-subscriptions` |

The named sizes stay the same whichever provider runs — they are the tool's
language, and the agent should not have to know who is drawing. FAL takes them as
they are; an OpenAI-compatible API gets them translated into pixels (`square_hd`
→ `1024x1024`, `landscape_4_3` → `1024x768`); Grok thinks in aspect ratios and
gets `1:1`, `2:3`, `3:2`. An API picky about sizes gets `customSize`, which is
sent verbatim instead.

`response_format` is deliberately not sent: newer OpenAI models reject it, and
the answer is accepted either way — base64 inline, or a link that gets
downloaded.

### Drawing on a subscription

`codex` and `grok` need no API key at all. They borrow an account that
[`dsh-subscriptions`](https://github.com/GooDAnDReaDY/dsh-subscriptions) already
holds: connect ChatGPT or Grok there once, pick the provider here, and generation
goes through the same subscription you use for chat.

The token never leaves the Host. The two plugins talk through a service inside
the process rather than over the network — a route handing out a live
subscription token would be a hole in a harness that is otherwise reachable
without a password.

If `dsh-subscriptions` is not installed, or no account of that vendor is
connected, these two providers say so instead of failing silently.

### Example: OpenAI

```yaml
- id: dsh-image-gen
  config:
    provider: custom
    customBaseURL: https://api.openai.com/v1
    customModel: gpt-image-1
    customKeyEnv: OPENAI_API_KEY
```

An empty `customKeyEnv` means no authorization header at all, for a local
gateway that needs none.

## Two delivery modes

The picture appears in the conversation either way. What differs is **what the
chat model receives** — and that decides whether the turn survives a text-only
model.

| | `link` (default) | `image` |
|---|---|---|
| The model receives | text and a link | the image itself |
| Shown in the chat | yes, the card renders it from the link | yes |
| Works with a text-only chat model | **yes, on its own** | **no** — needs [`dsh-vision-bridge`](https://github.com/GooDAnDReaDY/dsh-vision-bridge) or a vision-capable chat model |
| The model can reason about the picture | no, only about the prompt and the link | yes |
| The link points to | this plugin's own route, as durable as the attachment | the provider's CDN, which expires |

Pick `image` when the conversation should be able to discuss what was drawn —
"make the cat bluer" needs a model that can actually see it. Without a vision
model in the chat that mode fails the turn with `does not support image input`,
which is precisely what `dsh-vision-bridge` exists to prevent: it swaps the
picture for a description from a vision model you choose.

## Install

```bash
# From npm:
dsh plugin --profile web add @goodandready/dsh-image-gen

# From GitHub:
dsh plugin --profile web add github:GooDAnDReaDY/dsh-image-gen

# Locally from a checkout:
dsh plugin --profile web add /path/to/dsh-image-gen
```

Restart the Web UI afterwards.

## Configure

Everything lives in its own settings section: **Settings → Image generation**.

| Field | Default | Description |
|---|---|---|
| `provider` | `fal` | Who draws: `fal`, `custom`, `codex` or `grok`. |
| `model` | `fal-ai/flux-2/klein/9b` | FAL model id, called as `{baseURL}/{model}`. Used when `provider` is `fal`. |
| `apiKeyEnv` | `FAL_API_KEY` | API key reference (credentials / env var). |
| `baseURL` | `https://queue.fal.run` | FAL queue base URL. |
| `defaultSize` | `landscape_4_3` | Default image size when the tool call omits one. |
| `defaultFormat` | `png` | Default output format: `png`, `jpeg` or `webp`. |
| `pollIntervalMs` | `2000` | Job status poll interval. |
| `timeoutMs` | `180000` | Total generation timeout — submit, poll and download together. |
| `deliverAs` | `link` | `link` — the result is text with a link, works with any chat model. `image` — the result carries the picture, needs `dsh-vision-bridge` or a vision-capable model. |
| `customBaseURL` | — | `provider=custom`: API root, e.g. `https://api.openai.com/v1`. |
| `customModel` | — | `provider=custom`: model id, e.g. `gpt-image-1`. |
| `customKeyEnv` | `OPENAI_API_KEY` | `provider=custom`: key reference. Empty means no authorization header. |
| `customSize` | — | `provider=custom`: fixed size sent verbatim. Empty means the named size is translated. |
| `subscriptionQuality` | — | `provider=codex` or `grok`: quality asked of the subscription — `low`, `medium`, `high`, or empty for the vendor default. |
| `outputDir` | `generated/images` | Output folder. A relative path resolves against the session working directory; an absolute path is used as given. |

The same values can be set in `$DSH_HOME/settings.yaml` under `dsh-image-gen:`.
The card writes to that same document, so neither way is second-class.

## API key

Only `fal` and `custom` need one. Store it in **Credentials** (Web:
**Settings → Credentials**) or in `$DSH_HOME/.credentials.yaml`:

```yaml
FAL_API_KEY: <your key from https://fal.ai/dashboard/keys>
```

The plugin prepends FAL's `Key ` auth prefix automatically when it is missing.

## Usage

Just ask the model to draw something:

> Generate an image: neon cyberpunk city at night in the rain, 16:9

Tool parameters (all except `prompt` are optional):

| Parameter | Description |
|---|---|
| `prompt` | required, detailed image description |
| `image_size` | `square_hd` / `square` / `portrait_4_3` / `portrait_16_9` / `landscape_4_3` / `landscape_16_9` |
| `seed` | seed for reproducibility |
| `output_format` | `png` (default) / `jpeg` / `webp` |
| `output_name` | file name without extension |

## Upgrading from dsh-fal-image-gen

Install `@goodandready/dsh-image-gen` and remove
`@goodandready/dsh-fal-image-gen` from the profile. Two things are carried for
you:

- **Your settings.** They lived under the `dsh-fal-image-gen` namespace. On the
  first start the plugin reads that block and copies it under the new name —
  once, and only when you have not configured the new name yourself. The old
  block is left in the file untouched: deleting lines from someone's settings is
  not a plugin's business.
- **Images in existing conversations.** Their links point at the old route, so
  the plugin still answers on it alongside the new one. Nothing in your history
  goes blank.

The npm package `@goodandready/dsh-fal-image-gen` is deprecated and will not
receive further releases.

## Structure

```
dsh-image-gen/
├── package.json            # dsh bundle/plugin metadata + peerDependencies
├── cordis.patch.yml        # bundle layer: inserts the plugin row
├── lib/index.js            # host: generate_image tool, attachment and file handling
├── lib/providers.js        # host: the providers — FAL queue, OpenAI-compatible API, subscriptions
├── lib/client.js           # browser: settings card + the generate_image tool card
├── test/                   # unit tests for the providers, on a fake fetch
├── README.md
└── LICENSE                 # MIT
```

## Why the plugin ships its own tool card

Tool cards in dsh do not render image blocks — only user and assistant messages
do — so a picture returned by a tool would otherwise show up as JSON. The plugin
registers a keyed `tool.call.toolview` entry for `generate_image` and serves the
stored bytes from its own route (`GET /dsh-image-gen/image`), which is what puts
the image in the conversation.

No npm runtime dependencies (the `@deepseek-ai/*` peer deps resolve from the dsh
install), no build step — plain ESM.

## License

MIT

---

<a name="-русский"></a>
<details open>
<summary><h2>🇷🇺 Русский (Полное руководство)</h2></summary>

**Генерация изображений** для [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

Плагин предоставляет агенту один инструмент — `generate_image`, и размещает результат именно там, где ему положено быть: прямо в окне диалога. Какой сервис выполняет отрисовку — это параметр настройки, не требующий изменения кода:

| Провайдер | Бэкенд | Учётные данные |
|---|---|---|
| `fal` (по умолчанию) | Очередь [FAL](https://fal.ai), модель `fal-ai/flux-2/klein/9b` | API-ключ FAL |
| `custom` | Любой OpenAI-совместимый API изображений (OpenAI, локальный шлюз, ComfyUI) | Базовый URL, ID модели, ключ |
| `codex` | Модель генерации ChatGPT (`gpt-image-2`) через подписку ChatGPT | Без ключа — аккаунт ChatGPT в `dsh-subscriptions` |
| `grok` | Модель генерации Grok (`grok-imagine-image-2.0`) через подписку Grok | Без ключа — аккаунт Grok в `dsh-subscriptions` |

Именованные размеры остаются одинаковыми независимо от провайдера (`square_hd` → `1024x1024`, `landscape_4_3` → `1024x768`, для Grok — `1:1`, `2:3`, `3:2`). Для нестандартных требований API поддерживается `customSize`.

### Генерация через подписки

`codex` и `grok` не требуют API-ключей: они используют аккаунты из [`dsh-subscriptions`](https://github.com/GooDAnDReaDY/dsh-subscriptions). Токены никогда не покидают хост — плагины общаются через внутренний сервис процесса.

### Два режима доставки

| | `link` (по умолчанию) | `image` |
|---|---|---|
| Что получает модель | Текст и ссылку | Само изображение |
| Отображение в чате | Да, карточка рендерит по ссылке | Да |
| Работает с чисто текстовыми LLM | **Да, самостоятельно** | **Нет** — требуется [`dsh-vision-bridge`](https://github.com/GooDAnDReaDY/dsh-vision-bridge) |
| Модель может рассуждать о картинке | Нет, только по промпту | Да |
| Ссылка ведёт на | Собственный маршрут плагина (надёжно) | CDN провайдера (срок жизни ограничен) |

## Установка

```bash
# Из npm:
dsh plugin --profile web add @goodandready/dsh-image-gen

# С GitHub:
dsh plugin --profile web add github:GooDAnDReaDY/dsh-image-gen

# Локально:
dsh plugin --profile web add /path/to/dsh-image-gen
```

## Настройка (Web GUI)

Раздел **Настройки → Генерация изображений**:

| Поле | По умолчанию | Описание |
|---|---|---|
| `provider` | `fal` | Кто рисует: `fal`, `custom`, `codex` или `grok`. |
| `model` | `fal-ai/flux-2/klein/9b` | ID модели FAL. |
| `apiKeyEnv` | `FAL_API_KEY` | Переменная секрета API-ключа. |
| `baseURL` | `https://queue.fal.run` | Базовый URL очереди FAL. |
| `defaultSize` | `landscape_4_3` | Размер изображения по умолчанию. |
| `defaultFormat` | `png` | Формат: `png`, `jpeg` или `webp`. |
| `pollIntervalMs` | `2000` | Интервал опроса статуса генерации. |
| `timeoutMs` | `180000` | Общий таймаут генерации и скачивания. |
| `deliverAs` | `link` | Режим доставки (`link` или `image`). |
| `customBaseURL` | — | Базовый URL OpenAI-совместимого сервиса. |
| `customModel` | — | ID модели для пользовательского сервиса. |
| `outputDir` | `generated/images` | Папка сохранения на диске. |

## Использование

Просто попросите агента нарисовать изображение:
> Нарисуй неоновый киберпанк город ночью под дождём, 16:9

## Лицензия

MIT

</details>

---

<a name="-中文"></a>
<details>
<summary><h2>🇨🇳 中文 (完整技术文档)</h2></summary>

DeepSeek Harness (dsh) 专属的**图像生成工具插件**。

为智能体提供 `generate_image` 工具，并将生成的画作直接内嵌渲染于聊天会话之中。支持任意底层绘图引擎无缝切换：

| 服务商 | 后端引擎 | 鉴权凭证 |
|---|---|---|
| `fal` (默认) | [FAL](https://fal.ai) 极速队列，默认模型 `fal-ai/flux-2/klein/9b` | FAL API 密钥 |
| `custom` | 任意兼容 OpenAI 图像格式的接口（OpenAI、本地 ComfyUI 等） | Base URL、模型 ID 及 Key |
| `codex` | ChatGPT 订阅账号绘图模型 (`gpt-image-2`) | 无需 Key — 联动 `dsh-subscriptions` |
| `grok` | Grok 订阅账号绘图模型 (`grok-imagine-image-2.0`) | 无需 Key — 联动 `dsh-subscriptions` |

统一的命名尺寸规范（`square_hd` → `1024x1024`、`landscape_4_3` → `1024x768`、Grok 比例 `1:1`、`2:3` 等），模型无需关心底层差异。

### 订阅账号绘图支持

`codex` 与 `grok` 引擎完全免 API Key，直接复用 [`dsh-subscriptions`](https://github.com/GooDAnDReaDY/dsh-subscriptions) 已绑定的账号，会话 Token 仅在进程内部流转，安全可靠。

### 两种投递交付模式

| 特性对比 | `link` (默认模式) | `image` 模式 |
|---|---|---|
| 模型接收内容 | 文本说明与图片链接 | 完整的图片二进制载荷 |
| 聊天面板渲染 | 支持，通过链接直出渲染 | 支持 |
| 纯文本模型兼容 | **完美支持，单插件独立运行** | **需配合 [`dsh-vision-bridge`](https://github.com/GooDAnDReaDY/dsh-vision-bridge)** |
| 针对图片二次推理 | 仅基于 Prompt 进行文本理解 | 支持视觉多模态追问 |

## 安装指南

```bash
# 从 npm 安装:
dsh plugin --profile web add @goodandready/dsh-image-gen

# 从 GitHub 安装:
dsh plugin --profile web add github:GooDAnDReaDY/dsh-image-gen
```

## 设置面板 (Web GUI)

在 **设置 → 图像生成** 中可视化配置：
- `provider`: 绘图服务商 (`fal` / `custom` / `codex` / `grok`)
- `model`: 模型 ID（如 `fal-ai/flux-2/klein/9b`）
- `deliverAs`: 交付模式 (`link` 或 `image`)
- `outputDir`: 本地图片保存路径（默认 `generated/images`）

## 开源协议

MIT

</details>
