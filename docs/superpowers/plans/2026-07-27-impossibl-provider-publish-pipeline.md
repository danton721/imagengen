# impossibl.com Provider + npm Publish Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `impossibl.com` as a fourth (generate-only) image provider to the `imagengen` MCP server, add a tag-triggered GitHub Actions workflow that publishes to npm via Trusted Publishing, then land everything on `master` via a PR.

**Architecture:** Follow the existing `ImageProvider` interface (`src/providers/types.ts`) exactly as `gptImage.ts`/`grok.ts` do — same discovery/cache/fallback pattern, same `b64_json` parsing. `edit()` throws synchronously since impossibl.com has no working edit endpoint (confirmed live during design). The publish workflow is a standard tag-triggered `npm publish --provenance` job using OIDC, no stored secret.

**Tech Stack:** TypeScript (Node ESM, `tsc` build), `@modelcontextprotocol/sdk`, `zod`, native `fetch`. GitHub Actions for CI. No test framework exists in this repo today.

## Global Constraints

- Node >= 18 (per `package.json` `engines`).
- `npm run build` (bare `tsc`, per `tsconfig.json`) must exit 0 before every commit that touches `src/`.
- No test framework exists in this repo — verification is via (a) the TypeScript build, and (b) live smoke checks against the real impossibl.com API using the `IMPOSSIBL_API_KEY` environment variable the user already supplied earlier this session. **Never write the literal API key string into any file that gets committed** — always reference it via `$env:IMPOSSIBL_API_KEY` / `process.env.IMPOSSIBL_API_KEY`, and run smoke-check scripts from the scratchpad directory, never from inside the repo.
- Match existing code style exactly: 4-space indent, single quotes — just copy the formatting conventions already visible in `src/providers/grok.ts` and `src/providers/gptImage.ts`.
- Provider id string is `'impossibl'`, env var is `IMPOSSIBL_API_KEY`, model id is `'openai/gpt-image-2'` — use these exact strings everywhere.

---

### Task 1: Add `impossibl` to provider config

**Files:**
- Modify: `src/config.ts`

**Interfaces:**
- Produces: `ProviderId` now includes `'impossibl'`; `API_KEYS.impossibl: string | undefined` reads `process.env.IMPOSSIBL_API_KEY`; `ALL_PROVIDER_IDS` includes `'impossibl'`.

- [ ] **Step 1: Edit `src/config.ts`**

Change:

```ts
export type ProviderId = 'gemini' | 'grok' | 'gpt-image';

export const ALL_PROVIDER_IDS: ProviderId[] = ['gemini', 'grok', 'gpt-image'];

export const API_KEYS: Record<ProviderId, string | undefined> = {
    gemini: process.env.GEMINI_API_KEY,
    grok: process.env.XAI_API_KEY,
    'gpt-image': process.env.OPENAI_API_KEY
};
```

To:

```ts
export type ProviderId = 'gemini' | 'grok' | 'gpt-image' | 'impossibl';

export const ALL_PROVIDER_IDS: ProviderId[] = ['gemini', 'grok', 'gpt-image', 'impossibl'];

export const API_KEYS: Record<ProviderId, string | undefined> = {
    gemini: process.env.GEMINI_API_KEY,
    grok: process.env.XAI_API_KEY,
    'gpt-image': process.env.OPENAI_API_KEY,
    impossibl: process.env.IMPOSSIBL_API_KEY
};
```

- [ ] **Step 2: Verify the build fails cleanly (registry.ts doesn't handle the new id yet, which is expected)**

Run: `cd "C:\Users\danto\Claude\Projects\mcp-image" && npm run build`
Expected: FAIL — `src/providers/registry.ts` error, `Property 'impossibl' is missing in type 'Record<"gemini" | "grok" | "gpt-image", ImageProvider>'` (or similar). This confirms the type change is live and forces the next task.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "Add impossibl provider id and IMPOSSIBL_API_KEY config"
```

---

### Task 2: Implement the impossibl provider

**Files:**
- Create: `src/providers/impossibl.ts`
- Modify: `src/providers/registry.ts`

**Interfaces:**
- Consumes: `API_KEYS.impossibl` and `MODEL_LIST_CACHE_TTL_MS` from `src/config.ts` (Task 1); `createTtlCache<T>(ttlMs)` from `src/providers/cache.ts` (returns `{ get(fetcher, forceRefresh?): Promise<T> }`); `pickDefaultModel(modelIds: string[], avoidKeywords: string[]): string | undefined` from `src/providers/heuristics.ts`; types `EditParams`, `GenerateParams`, `GeneratedImage`, `ImageProvider`, `ModelInfo` from `src/providers/types.ts`.
- Produces: `export const impossiblProvider: ImageProvider` with `id: 'impossibl'`, consumed by `registry.ts` in this task and by the tool layer in Task 3.

- [ ] **Step 1: Create `src/providers/impossibl.ts`**

```ts
import { API_KEYS, MODEL_LIST_CACHE_TTL_MS } from '../config.js';
import { createTtlCache } from './cache.js';
import { pickDefaultModel } from './heuristics.js';
import type { EditParams, GenerateParams, GeneratedImage, ImageProvider, ModelInfo } from './types.js';

const API_BASE = 'https://api.impossibl.com/v1';

const FALLBACK_MODELS = ['openai/gpt-image-2'];

const modelsCache = createTtlCache<ModelInfo[]>(MODEL_LIST_CACHE_TTL_MS);

function authHeaders(): Record<string, string> {
    const key = API_KEYS.impossibl;
    if (!key) throw new Error('IMPOSSIBL_API_KEY is not set');
    return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function fetchModelIdsFromApi(): Promise<string[]> {
    const res = await fetch(`${API_BASE}/models`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`impossibl models list failed: ${res.status} ${await res.text()}`);
    const body: any = await res.json();
    return (body.data ?? []).map((m: any) => m.id as string).filter((id: string) => /\/gpt-image/i.test(id));
}

async function listModels(forceRefresh = false): Promise<ModelInfo[]> {
    return modelsCache.get(async () => {
        let ids: string[];
        try {
            ids = await fetchModelIdsFromApi();
            if (ids.length === 0) ids = FALLBACK_MODELS;
        } catch {
            ids = FALLBACK_MODELS;
        }
        const defaultId = pickDefaultModel(ids, []);
        return ids.map(id => ({ id, isDefault: id === defaultId }));
    }, forceRefresh);
}

async function getDefaultModel(forceRefresh = false): Promise<string> {
    const models = await listModels(forceRefresh);
    return models.find(m => m.isDefault)?.id ?? models[0]?.id ?? FALLBACK_MODELS[0];
}

function parseImageData(entry: any): GeneratedImage {
    if (entry.b64_json) return { data: entry.b64_json, mimeType: 'image/png' };
    throw new Error('Expected b64_json in impossibl image response; got: ' + JSON.stringify(entry).slice(0, 300));
}

async function generate(params: GenerateParams): Promise<GeneratedImage[]> {
    const res = await fetch(`${API_BASE}/images/generations`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
            model: params.model,
            prompt: params.prompt,
            n: params.n ?? 1,
            ...(params.size ? { size: params.size } : {})
        })
    });
    if (!res.ok) throw new Error(`impossibl image generation failed: ${res.status} ${await res.text()}`);
    const body: any = await res.json();
    return (body.data ?? []).map(parseImageData);
}

async function edit(_params: EditParams): Promise<GeneratedImage[]> {
    throw new Error(
        'impossibl.com does not support image editing (its /v1/images/edits endpoint does not exist, and ' +
            'the /v1/images/generations endpoint silently ignores input images rather than editing them). ' +
            'Use another provider (gemini, grok, or gpt-image) for image-to-image edits.'
    );
}

export const impossiblProvider: ImageProvider = {
    id: 'impossibl',
    isConfigured: () => Boolean(API_KEYS.impossibl),
    listModels,
    getDefaultModel,
    generate,
    edit
};
```

- [ ] **Step 2: Wire it into `src/providers/registry.ts`**

Change:

```ts
import { ALL_PROVIDER_IDS, CONFIGURED_DEFAULT_PROVIDER, type ProviderId } from '../config.js';
import { geminiProvider } from './gemini.js';
import { grokProvider } from './grok.js';
import { gptImageProvider } from './gptImage.js';
import type { ImageProvider } from './types.js';

export const PROVIDERS: Record<ProviderId, ImageProvider> = {
    gemini: geminiProvider,
    grok: grokProvider,
    'gpt-image': gptImageProvider
};
```

To:

```ts
import { ALL_PROVIDER_IDS, CONFIGURED_DEFAULT_PROVIDER, type ProviderId } from '../config.js';
import { geminiProvider } from './gemini.js';
import { grokProvider } from './grok.js';
import { gptImageProvider } from './gptImage.js';
import { impossiblProvider } from './impossibl.js';
import type { ImageProvider } from './types.js';

export const PROVIDERS: Record<ProviderId, ImageProvider> = {
    gemini: geminiProvider,
    grok: grokProvider,
    'gpt-image': gptImageProvider,
    impossibl: impossiblProvider
};
```

- [ ] **Step 3: Build**

Run: `cd "C:\Users\danto\Claude\Projects\mcp-image" && npm run build`
Expected: PASS (exit 0, `dist/providers/impossibl.js` created).

- [ ] **Step 4: Live smoke-check `generate()` end-to-end**

From the scratchpad directory (NOT inside the repo), create a throwaway script `smoke_generate.mjs`:

```js
import { impossiblProvider } from 'C:/Users/danto/Claude/Projects/mcp-image/dist/providers/impossibl.js';

const models = await impossiblProvider.listModels();
console.log('models:', models);

const [image] = await impossiblProvider.generate({
    prompt: 'A single blue square on a white background.',
    model: await impossiblProvider.getDefaultModel()
});
console.log('got image bytes:', Buffer.from(image.data, 'base64').length, 'mimeType:', image.mimeType);
```

Run (with the key already set in your shell env this session): `node smoke_generate.mjs` from the scratchpad directory, with `IMPOSSIBL_API_KEY` set in the environment.
Expected: prints `models: [ { id: 'openai/gpt-image-2', isDefault: true } ]` and `got image bytes: <some large number> mimeType: image/png`.

- [ ] **Step 5: Live smoke-check `edit()` throws the expected error**

Add to the same throwaway script or a new one:

```js
try {
    await impossiblProvider.edit({ prompt: 'x', model: 'openai/gpt-image-2', inputImages: [] });
    console.log('UNEXPECTED: edit() did not throw');
} catch (err) {
    console.log('edit() threw as expected:', err.message);
}
```

Expected: logs `edit() threw as expected: impossibl.com does not support image editing...` — and note this check requires no network call (the function throws before any `fetch`).

- [ ] **Step 6: Commit**

```bash
git add src/providers/impossibl.ts src/providers/registry.ts
git commit -m "Add impossibl.com image provider (generate-only)"
```

---

### Task 3: Wire impossibl into the MCP tool layer

**Files:**
- Modify: `src/tools/textToImage.ts`
- Modify: `src/tools/imageToImage.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `impossiblProvider` is reached indirectly via `resolveProvider()`/`PROVIDERS` (Task 2) — these files only need the string literal `'impossibl'` added to the zod enum and description text.

- [ ] **Step 1: Update `src/tools/textToImage.ts`**

In `textToImageInputSchema`, change:

```ts
    provider: z
        .enum(['gemini', 'grok', 'gpt-image'])
```

To:

```ts
    provider: z
        .enum(['gemini', 'grok', 'gpt-image', 'impossibl'])
```

And update the description string immediately below it (the one starting `'Which image provider to use. REQUIRED when more than one of GEMINI_API_KEY / XAI_API_KEY / '`) to:

```ts
        .describe(
            'Which image provider to use. REQUIRED when more than one of GEMINI_API_KEY / XAI_API_KEY / ' +
                'OPENAI_API_KEY / IMPOSSIBL_API_KEY is configured and IMAGE_PROVIDER_DEFAULT is not set. In that case: ' +
                'first check your memory for a stored user preference for a default image provider; if there is none, ' +
                'ask the user which provider to use before calling this tool, then remember their answer for future calls.'
        ),
```

- [ ] **Step 2: Update `src/tools/imageToImage.ts`**

Same enum change as Step 1. Also update the `input_images` field's `.describe(...)` to flag that impossibl can't be used here, changing:

```ts
    input_images: z
        .array(z.string())
        .min(1)
        .describe('One or more input images, each as a local file path or a data: URI. Grok supports 1 image per call; Gemini and GPT-image support multiple.'),
```

To:

```ts
    input_images: z
        .array(z.string())
        .min(1)
        .describe(
            'One or more input images, each as a local file path or a data: URI. Grok supports 1 image per call; ' +
                'Gemini and GPT-image support multiple. impossibl.com does not support image editing at all — do not ' +
                'select it for this tool.'
        ),
```

And update the `provider` field's `.describe(...)` the same way as Step 1 (mentioning `IMPOSSIBL_API_KEY`).

- [ ] **Step 3: Update `src/index.ts` tool descriptions**

Change the three description strings that list `(gemini, grok, gpt-image)` / `Gemini, Grok Image, or GPT-image` to also mention impossibl, with its generate-only caveat on the `image-to-image` tool. Specifically:

```ts
        description:
            'Lists which image providers (gemini, grok, gpt-image, impossibl) are configured via API key, their available ' +
            'models (discovered live from each provider), and which provider/model would be used by default.',
```

```ts
        description: 'Generates an image from a text prompt using Gemini, Grok Image, GPT-image, or impossibl.com, and saves it to disk.',
```

```ts
        description:
            'Edits or transforms one or more input images according to a text prompt, using Gemini, Grok Image, ' +
            'or GPT-image, and saves the result to disk. (impossibl.com does not support this tool.)',
```

- [ ] **Step 4: Build**

Run: `cd "C:\Users\danto\Claude\Projects\mcp-image" && npm run build`
Expected: PASS.

- [ ] **Step 5: Live smoke-check the full tool handler**

From the scratchpad directory, create `smoke_tool.mjs`:

```js
import { textToImageHandler } from 'C:/Users/danto/Claude/Projects/mcp-image/dist/tools/textToImage.js';

process.env.IMAGE_OUTPUT_DIR = '.';
const result = await textToImageHandler({ prompt: 'A single blue square on a white background.', provider: 'impossibl' });
console.log(JSON.stringify(result, null, 2));
```

Run with `IMPOSSIBL_API_KEY` set: `node smoke_tool.mjs`
Expected: `content[0].text` is JSON containing a `paths` array pointing at a saved PNG file, and `"provider": "impossibl"`. Confirm the file exists and is a valid, non-trivial PNG.

- [ ] **Step 6: Commit**

```bash
git add src/tools/textToImage.ts src/tools/imageToImage.ts src/index.ts
git commit -m "Expose impossibl.com through the MCP tool schemas"
```

---

### Task 4: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add impossibl to the intro sentence**

Change:

```md
An MCP server that generates and edits images via **Gemini** (Nano Banana), **Grok Image**, and **GPT-image**, for MCP clients — like Claude Code — that have no native image generation capability.
```

To:

```md
An MCP server that generates and edits images via **Gemini** (Nano Banana), **Grok Image**, **GPT-image**, and **impossibl.com**, for MCP clients — like Claude Code — that have no native image generation capability.
```

- [ ] **Step 2: Add a row to the Providers & API keys table**

Change:

```md
| Provider | Env var | Models (discovered live) |
|---|---|---|
| Gemini | `GEMINI_API_KEY` | Nano Banana family, e.g. `gemini-3.1-flash-image`, `gemini-3-pro-image`, `gemini-2.5-flash-image` |
| Grok Image | `XAI_API_KEY` | `grok-imagine-image`, `grok-imagine-image-quality` |
| GPT-image | `OPENAI_API_KEY` | `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini` |
```

To:

```md
| Provider | Env var | Models (discovered live) |
|---|---|---|
| Gemini | `GEMINI_API_KEY` | Nano Banana family, e.g. `gemini-3.1-flash-image`, `gemini-3-pro-image`, `gemini-2.5-flash-image` |
| Grok Image | `XAI_API_KEY` | `grok-imagine-image`, `grok-imagine-image-quality` |
| GPT-image | `OPENAI_API_KEY` | `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini` |
| impossibl.com | `IMPOSSIBL_API_KEY` | `openai/gpt-image-2` (generation only — see Known limitations) |
```

- [ ] **Step 3: Add `-e IMPOSSIBL_API_KEY` to both install examples**

In the `claude mcp add` example, change:

```bash
claude mcp add imagengen \
  -e GEMINI_API_KEY=your-gemini-key \
  -e XAI_API_KEY=your-xai-key \
  -e OPENAI_API_KEY=your-openai-key \
  -e IMAGE_PROVIDER_DEFAULT=gemini \
  -- npx -y imagengen
```

To:

```bash
claude mcp add imagengen \
  -e GEMINI_API_KEY=your-gemini-key \
  -e XAI_API_KEY=your-xai-key \
  -e OPENAI_API_KEY=your-openai-key \
  -e IMPOSSIBL_API_KEY=your-impossibl-key \
  -e IMAGE_PROVIDER_DEFAULT=gemini \
  -- npx -y imagengen
```

In the JSON config example, add `"IMPOSSIBL_API_KEY": "your-impossibl-key"` alongside the other three env vars in the `env` object.

- [ ] **Step 4: Add a bullet to "Known limitations"**

Change:

```md
## Known limitations

- Grok image edits currently support one input image per call (the documented request shape takes a single `image` field).
- The Gemini provider talks to Google's newer "Interactions" image API (`/v1beta/interactions`); if Google adjusts that response shape, `src/providers/gemini.ts` may need a small update.
```

To:

```md
## Known limitations

- Grok image edits currently support one input image per call (the documented request shape takes a single `image` field).
- The Gemini provider talks to Google's newer "Interactions" image API (`/v1beta/interactions`); if Google adjusts that response shape, `src/providers/gemini.ts` may need a small update.
- impossibl.com only supports text-to-image generation, not editing. Its `/v1/images/edits` endpoint does not exist (404), and passing an `image` field to `/v1/images/generations` is silently ignored rather than performing an edit. Calling `image-to-image` with `provider: "impossibl"` returns a clear error.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Document impossibl.com provider in README"
```

---

### Task 5: npm publish pipeline

**Files:**
- Create: `.github/workflows/publish.yml`
- Modify: `package.json`

- [ ] **Step 1: Create `.github/workflows/publish.yml`**

```yaml
name: Publish to npm

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - run: npm ci

      - run: npm run build

      - run: npm publish --provenance --access public
```

- [ ] **Step 2: Add `prepublishOnly` script and bump the version in `package.json`**

Change:

```json
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  },
```

To:

```json
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "prepublishOnly": "npm run build"
  },
```

Also change the top-level `"version": "0.1.1"` to `"version": "0.2.0"`.

- [ ] **Step 3: Verify `package.json` is still valid JSON and the build still passes**

Run: `cd "C:\Users\danto\Claude\Projects\mcp-image" && node -e "require('./package.json')" && npm run build`
Expected: no output from the `node -e` check (valid JSON), and `npm run build` exits 0.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/publish.yml package.json
git commit -m "Add tag-triggered npm publish workflow via Trusted Publishing, bump to 0.2.0"
```

---

### Task 6: Push, open PR, and merge

**Files:** none (git/GitHub operations only)

- [ ] **Step 1: Push the branch**

```bash
cd "C:\Users\danto\Claude\Projects\mcp-image"
git push -u origin feat/impossibl-provider-publish-pipeline
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "Add impossibl.com image provider and npm publish pipeline" --body "$(cat <<'EOF'
## Summary
- Adds impossibl.com as a fourth, generate-only image provider (IMPOSSIBL_API_KEY, model openai/gpt-image-2). Its /v1/images/edits endpoint does not exist and it silently ignores input images on /v1/images/generations, so edit() throws a clear error directing users to another provider — verified live during design.
- Adds a tag-triggered (`v*.*.*`) GitHub Actions workflow that publishes to npm using Trusted Publishing (OIDC) - no stored token. Requires a one-time trusted-publisher registration on npmjs.com before the first real publish will succeed.
- Bumps package version to 0.2.0.

## Test plan
- [x] `npm run build` passes
- [x] Live smoke-checked `impossiblProvider.generate()` returns real PNG bytes
- [x] Live smoke-checked `impossiblProvider.edit()` throws the expected error
- [x] Live smoke-checked the `text-to-image` MCP tool handler end-to-end with `provider: "impossibl"`
EOF
)"
```

- [ ] **Step 3: Wait for user confirmation, then merge**

Confirm with the user that the PR looks good, then:

```bash
gh pr merge --squash
```

- [ ] **Step 4: Report the merged PR URL back to the user, and remind them of the outstanding manual step**

Tell the user: the PR is merged; before tagging a release (`git tag v0.2.0 && git push origin v0.2.0`), they still need to register this repo/workflow as a trusted publisher for `imagengen` on npmjs.com (Package Settings → Publishing access), or the publish workflow will fail to authenticate.

---

## Self-Review Notes

- **Spec coverage:** Task 1-2 cover provider implementation; Task 3 covers tool wiring; Task 4 covers README; Task 5 covers the publish pipeline; Task 6 covers the git/PR/merge workflow. All spec sections have a corresponding task.
- **Placeholder scan:** No TBD/TODO; all code blocks are complete and copy-pasteable.
- **Type consistency:** `ImageProvider`, `GenerateParams`, `EditParams`, `GeneratedImage`, `ModelInfo` are used with the exact same shapes as `src/providers/types.ts` already defines (read during design) — no new types introduced. `impossiblProvider.id` is `'impossibl'` everywhere it's referenced (registry, config `ProviderId`, tool enums).
