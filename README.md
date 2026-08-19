# dsh-fal-image-gen

**Image generation** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh): a `generate_image` tool backed by the [FAL](https://fal.ai) REST queue API. Default model — `fal-ai/flux-2/klein/9b`.

A generated image is:

- shown inline in the conversation, in the plugin's own tool card;
- saved into the session working directory (`<session cwd>/generated/fal/*.png`);
- returned to the model with its path, size and seed.

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
| The link points to | this plugin's own route, as durable as the attachment | `fal.media`, which expires |

Pick `image` when the conversation should be able to discuss what was drawn —
"make the cat bluer" needs a model that can actually see it. Without a vision
model in the chat that mode fails the turn with `does not support image input`,
which is precisely what `dsh-vision-bridge` exists to prevent: it swaps the
picture for a description from a vision model you choose.

Set it in **Settings → Plugins → FAL Image Generation → How the image reaches
the chat**, or in the profile:

```yaml
- id: dsh-fal-image-gen
  config:
    deliverAs: image
```

## Install

```bash
# From npm after publishing:
dsh plugin --profile web add @goodandready/dsh-fal-image-gen

# From GitHub:
dsh plugin --profile web add github:GooDAnDReaDY/dsh-fal-image-gen

# Locally from a checkout:
dsh plugin --profile web add /path/to/dsh-fal-image-gen
```

Restart the Web UI afterwards.

## Configure (Web GUI)

All settings live in **Settings → Plugins → Plugin configuration → FAL Image Generation**:

| Field | Default | Description |
|---|---|---|
| `model` | `fal-ai/flux-2/klein/9b` | FAL model id, called as `{baseURL}/{model}`. |
| `apiKeyEnv` | `FAL_API_KEY` | API key reference (credentials / env var). |
| `baseURL` | `https://queue.fal.run` | FAL queue base URL. |
| `defaultSize` | `landscape_4_3` | Default image size. |
| `defaultFormat` | `png` | Default output format. |
| `pollIntervalMs` | `2000` | Job status poll interval. |
| `timeoutMs` | `180000` | Total generation timeout. |
| `deliverAs` | `link` | `link` — the result is text with a link, works with any chat model. `image` — the result carries the picture, needs `dsh-vision-bridge` or a vision-capable model. |
| `outputDir` | `generated/fal` | Output folder. A relative path resolves against the session working directory; an absolute path is used as given. |
| `numImagesMax` | `4` | Max images per call. |

Equivalent values can be set in `$DSH_HOME/settings.yaml` under `dsh-fal-image-gen:` — the GUI writes to the same settings document, so both ways are equivalent.

## API key

Store your key in **Credentials** (Web: **Settings → Credentials**, name `FAL_API_KEY`) or in `$DSH_HOME/.credentials.yaml`:

```yaml
FAL_API_KEY: <your key from https://fal.ai/dashboard/keys>
```

The plugin prepends the `Key ` auth prefix automatically.

## Usage

Just ask the model to draw an image:

> Generate an image: neon cyberpunk city at night in the rain, 16:9

Tool parameters (all except `prompt` are optional):

| Parameter | Description |
|---|---|
| `prompt` | required, detailed image description |
| `image_size` | `square_hd` / `square` / `portrait_4_3` / `portrait_16_9` / `landscape_4_3` / `landscape_16_9` |
| `seed` | seed for reproducibility |
| `output_format` | `png` (default) / `jpeg` / `webp` |
| `output_name` | file name without extension |

## Structure

```
dsh-fal-image-gen/
├── package.json            # dsh bundle/plugin metadata + peerDependencies
├── cordis.patch.yml        # bundle layer: inserts the plugin row
├── lib/index.js            # host: generate_image tool + FAL queue client
├── lib/client.js           # browser: settings card + the generate_image tool card
├── README.md
└── LICENSE                 # MIT
```

## Why the plugin ships its own tool card

Tool cards in dsh do not render image blocks — only user and assistant messages
do — so a picture returned by a tool would otherwise show up as JSON. The plugin
registers a keyed `tool.call.toolview` entry for `generate_image` and serves the
stored bytes from its own route (`GET /dsh-fal-image-gen/image`), which is what
puts the image in the conversation.

No npm runtime dependencies (the `@deepseek-ai/*` peer deps resolve from the dsh install), no build step — plain ESM.

## License

MIT
