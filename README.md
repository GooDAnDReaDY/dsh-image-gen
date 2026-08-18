# dsh-fal-image-gen

**Image generation** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh): a `generate_image` tool backed by the [FAL](https://fal.ai) REST queue API. Default model — `fal-ai/flux-2/klein/9b`.

A generated image is:

- saved into the workspace (`<workspace>/generated/fal/*.png`);
- rendered directly in the conversation (via the dsh attachments service);
- its `fal.media` file URL returned to the model with the path, size and seed.

## Install

```bash
# From npm / GitHub after publishing:
dsh plugin --profile web add dsh-fal-image-gen

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
| `outputDir` | `generated/fal` | Output folder (relative to the workspace root). |
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
| `num_images` | 1–4 (default 1; first is displayed) |
| `seed` | seed for reproducibility |
| `output_format` | `png` (default) / `jpeg` / `webp` |
| `output_name` | file name without extension |

## Structure

```
dsh-fal-image-gen/
├── package.json            # dsh bundle/plugin metadata + peerDependencies
├── cordis.patch.yml        # bundle layer: inserts the plugin row
├── lib/index.js            # host: generate_image tool + FAL queue client
├── lib/client.js           # browser: settings card in the Web GUI
├── README.md
└── LICENSE                 # MIT
```

No npm runtime dependencies (the `@deepseek-ai/*` peer deps resolve from the dsh install), no build step — plain ESM.

## License

MIT
