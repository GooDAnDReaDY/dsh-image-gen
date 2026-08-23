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
