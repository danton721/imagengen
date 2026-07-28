# impossibl.com provider + npm publish pipeline

## Context

Two independent additions to the `imagengen` MCP server:

1. Add `impossibl.com` as a fourth image-generation provider alongside Gemini, Grok, and GPT-image.
2. Add a CI pipeline that publishes the npm package automatically, then land the work via a PR merged to `main`.

## impossibl.com research findings

impossibl.com is documented as an OpenAI-compatible LLM gateway (chat completions across many providers), and its published OpenAPI spec (`https://api.impossibl.com/openapi.yaml`) lists no image-generation endpoints — only text-in/text-out chat/completions/messages endpoints with image-as-*input* support (vision).

However, `/v1/models` does list one image-capable model: `openai/gpt-image-2`. Live testing (with a user-supplied API key, one-off calls only) confirmed:

- `POST /v1/chat/completions` with that model returns a 400 explicitly redirecting to `/v1/images/generations`.
- `POST /v1/images/generations` (undocumented, not in the OpenAPI spec) with `{model: "openai/gpt-image-2", prompt}` returns `200` with the standard OpenAI shape: `{ data: [{ b64_json }], usage }`. Verified the returned bytes decode to a real PNG matching the prompt.
- `POST /v1/images/edits` (the OpenAI-standard multipart edit endpoint) returns `404`.
- Passing an `image` field into `/v1/images/generations` does not perform an edit — it silently ignores the field and generates an unrelated image from the text prompt alone (verified: asked to recolor a red apple, got back an unrelated green-apple-on-windowsill scene, not an edited version of the input).

**Conclusion: impossibl.com supports text-to-image generation only, via the undocumented `/v1/images/generations` endpoint. Image editing is not available through this gateway.**

One more note from research: impossibl's docs include agent-facing material (`/auth.md`, `/agent/identity/claim`) that invites an AI agent to autonomously self-provision an account and API key. No such autonomous signup was performed — the API key used for testing was supplied directly by the user.

## Design

### 1. Provider implementation

- `src/config.ts`: add `'impossibl'` to `ProviderId` and `ALL_PROVIDER_IDS`; add `IMPOSSIBL_API_KEY` to `API_KEYS`.
- `src/providers/impossibl.ts` (new file), following the existing `gptImage.ts`/`grok.ts` pattern:
  - `API_BASE = 'https://api.impossibl.com/v1'`
  - `FALLBACK_MODELS = ['openai/gpt-image-2']`
  - `listModels()`: fetch `${API_BASE}/models`, filter ids matching `/\/gpt-image/i`, fall back to `FALLBACK_MODELS` on error or empty result (same resilience pattern as other providers).
  - `getDefaultModel()`: reuse `pickDefaultModel` with no avoid-keywords (single model today; consistent with other providers if impossibl adds more `gpt-image-*` variants later).
  - `generate()`: `POST ${API_BASE}/images/generations`, JSON body `{model, prompt, n, size}`, parse `data[].b64_json` as `image/png` (identical shape to `gptImage.ts`'s `parseImageData`).
  - `edit()`: throws synchronously with a message explaining impossibl.com has no working image-edit endpoint and to use another provider — no network call made.
  - `isConfigured()`: `Boolean(API_KEYS.impossibl)`.
- `src/providers/registry.ts`: import and register `impossiblProvider`.
- `src/tools/textToImage.ts` and `src/tools/imageToImage.ts`: add `'impossibl'` to the `provider` zod enum; update the provider-choice description text to include it.
- `src/index.ts`: update the three tool descriptions to mention impossibl where they currently list gemini/grok/gpt-image.
- `README.md`: add impossibl row to the providers table (env var `IMPOSSIBL_API_KEY`, model `openai/gpt-image-2`, note "generation only, no editing"), add `-e IMPOSSIBL_API_KEY=...` to both install examples, and add a bullet under "Known limitations" documenting the no-edit-support finding.

### 2. npm publish pipeline

- `.github/workflows/publish.yml`: triggered on push of tags matching `v*.*.*`. Steps: checkout, `actions/setup-node` with `registry-url: https://registry.npmjs.org`, `npm ci`, `npm run build`, `npm publish --provenance`.
- Uses npm Trusted Publishing (OIDC) — workflow needs `permissions: id-token: write, contents: read`. No `NPM_TOKEN` secret is stored in the repo.
- **Manual step required from the user, outside this PR**: register this GitHub repo + workflow as a trusted publisher for the `imagengen` package on npmjs.com (Package Settings → Publishing access). The workflow will fail to authenticate until that's done.
- `package.json`: add `"prepublishOnly": "npm run build"` so publishing can't ship a stale `dist/`; bump `version` from `0.1.1` to `0.2.0` (new provider = minor version bump per semver).
- This PR does **not** create or push the `v0.2.0` tag — that's the deliberate action that triggers a real publish, left for the user (or an explicit follow-up ask) once the trusted-publisher setup is confirmed.

### 3. Git workflow

- New branch `feat/impossibl-provider-publish-pipeline` off `master`.
- Commit only files touched by this design — the pre-existing untracked scratch files (`mcp-list.mjs`, `test-mcp.mjs`, `test-sdk.mjs`) are left alone as out of scope.
- Push, open a PR via `gh pr create`, then `gh pr merge --squash` into `master` once the user confirms.

## Out of scope

- Any CI workflow for tests/typecheck on PRs (not requested; no test suite exists today).
- Actually performing the first real npm publish (blocked on the user's one-time npmjs.com trusted-publisher setup).
- Touching the pre-existing untracked scratch files in the repo root.
