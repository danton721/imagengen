import { API_KEYS, MODEL_LIST_CACHE_TTL_MS } from '../config.js';
import { createTtlCache } from './cache.js';
import { pickDefaultModel } from './heuristics.js';
import type { EditParams, GenerateParams, GeneratedImage, ImageProvider, ModelInfo } from './types.js';

const API_BASE = 'https://api.openai.com/v1';

const FALLBACK_MODELS = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'];

// "mini" is the stripped-down variant; keep it out of the default slot.
const AVOID_KEYWORDS_FOR_DEFAULT = ['mini'];

const DEFAULT_QUALITY = 'medium';

const modelsCache = createTtlCache<ModelInfo[]>(MODEL_LIST_CACHE_TTL_MS);

function authHeaders(): Record<string, string> {
    const key = API_KEYS['gpt-image'];
    if (!key) throw new Error('OPENAI_API_KEY is not set');
    return { Authorization: `Bearer ${key}` };
}

async function fetchModelIdsFromApi(): Promise<string[]> {
    const res = await fetch(`${API_BASE}/models`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`OpenAI models list failed: ${res.status} ${await res.text()}`);
    const body: any = await res.json();
    return (body.data ?? []).map((m: any) => m.id as string).filter((id: string) => id.startsWith('gpt-image'));
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
        const defaultId = pickDefaultModel(ids, AVOID_KEYWORDS_FOR_DEFAULT);
        return ids.map(id => ({ id, isDefault: id === defaultId }));
    }, forceRefresh);
}

async function getDefaultModel(forceRefresh = false): Promise<string> {
    const models = await listModels(forceRefresh);
    return models.find(m => m.isDefault)?.id ?? models[0]?.id ?? FALLBACK_MODELS[0];
}

function parseImageData(entry: any): GeneratedImage {
    if (entry.b64_json) return { data: entry.b64_json, mimeType: 'image/png' };
    throw new Error('Expected b64_json in OpenAI image response; got: ' + JSON.stringify(entry).slice(0, 300));
}

async function generate(params: GenerateParams): Promise<GeneratedImage[]> {
    const res = await fetch(`${API_BASE}/images/generations`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: params.model,
            prompt: params.prompt,
            n: params.n ?? 1,
            quality: params.quality ?? DEFAULT_QUALITY,
            ...(params.size ? { size: params.size } : {})
        })
    });
    if (!res.ok) throw new Error(`OpenAI image generation failed: ${res.status} ${await res.text()}`);
    const body: any = await res.json();
    return (body.data ?? []).map(parseImageData);
}

async function edit(params: EditParams): Promise<GeneratedImage[]> {
    const form = new FormData();
    form.append('model', params.model);
    form.append('prompt', params.prompt);
    form.append('quality', params.quality ?? DEFAULT_QUALITY);
    if (params.size) form.append('size', params.size);
    if (params.n) form.append('n', String(params.n));

    params.inputImages.forEach((img, i) => {
        const bytes = Buffer.from(img.data, 'base64');
        form.append('image[]', new Blob([bytes], { type: img.mimeType }), `input-${i}.png`);
    });

    const res = await fetch(`${API_BASE}/images/edits`, {
        method: 'POST',
        headers: authHeaders(),
        body: form
    });
    if (!res.ok) throw new Error(`OpenAI image edit failed: ${res.status} ${await res.text()}`);
    const body: any = await res.json();
    return (body.data ?? []).map(parseImageData);
}

export const gptImageProvider: ImageProvider = {
    id: 'gpt-image',
    isConfigured: () => Boolean(API_KEYS['gpt-image']),
    listModels,
    getDefaultModel,
    generate,
    edit
};
