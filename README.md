# imagengen

An MCP server that generates and edits images via **Gemini** (Nano Banana), **Grok Image**, and **GPT-image**, for MCP clients — like Claude Code — that have no native image generation capability.

- Model lists are **discovered live** from each provider's API, not hardcoded, so new models show up automatically.
- Defaults to each provider's newest non-top-tier model and a non-maximum quality setting, so a plain "generate an image" request doesn't silently pick the most expensive option.
- Images are saved to disk; tools return the file path.

## Tools

| Tool | Purpose |
|---|---|
| `list_image_providers` | Reports which providers are configured, their available models, and the resolved default. |
| `text-to-image` | Generate an image from a text prompt. |
| `image-to-image` | Edit/transform one or more input images from a text prompt. |

## Providers & API keys

| Provider | Env var | Models (discovered live) |
|---|---|---|
| Gemini | `GEMINI_API_KEY` | Nano Banana family, e.g. `gemini-3.1-flash-image`, `gemini-3-pro-image`, `gemini-2.5-flash-image` |
| Grok Image | `XAI_API_KEY` | `grok-imagine-image`, `grok-imagine-image-quality` |
| GPT-image | `OPENAI_API_KEY` | `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini` |

Set only the keys for the providers you want to use. If none are set, the tools return a clear `no_provider_configured` error.

### Choosing a default provider

- If exactly **one** API key is set, it's used automatically.
- If **more than one** is set, set `IMAGE_PROVIDER_DEFAULT` to `gemini`, `grok`, or `gpt-image` to avoid being asked every time.
- If more than one key is set and `IMAGE_PROVIDER_DEFAULT` is not set, the tools return a `needs_provider_choice` response — Claude Code is instructed (via the tool descriptions) to check its memory for a previously stated preference, or otherwise ask you, then retry with the `provider` argument.

### Other configuration

| Env var | Default | Purpose |
|---|---|---|
| `IMAGE_OUTPUT_DIR` | `./output` | Where generated/edited images are saved. |

## Install

```bash
npx -y imagengen
```

Add it to your MCP client:

### Claude Code

```bash
claude mcp add imagengen \
  -e GEMINI_API_KEY=your-gemini-key \
  -e XAI_API_KEY=your-xai-key \
  -e OPENAI_API_KEY=your-openai-key \
  -e IMAGE_PROVIDER_DEFAULT=gemini \
  -- npx -y imagengen
```

(Omit any `-e` you don't need. `IMAGE_PROVIDER_DEFAULT` is optional — see above.)

### Claude Desktop / other MCP clients

Add to your MCP config file (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "imagengen": {
      "command": "npx",
      "args": ["-y", "imagengen"],
      "env": {
        "GEMINI_API_KEY": "your-gemini-key",
        "XAI_API_KEY": "your-xai-key",
        "OPENAI_API_KEY": "your-openai-key",
        "IMAGE_PROVIDER_DEFAULT": "gemini"
      }
    }
  }
}
```

## Known limitations

- Grok image edits currently support one input image per call (the documented request shape takes a single `image` field).
- The Gemini provider talks to Google's newer "Interactions" image API (`/v1beta/interactions`); if Google adjusts that response shape, `src/providers/gemini.ts` may need a small update.

## License

MIT
