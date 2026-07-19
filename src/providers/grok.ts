import { API_KEYS, MODEL_LIST_CACHE_TTL_MS } from '../config.js';
import { createTtlCache } from './cache.js';
import { pickDefaultModel } from './heuristics.js';
import type { EditParams, GenerateParams, GeneratedImage, ImageProvider, ModelInfo } from './types.js';

const API_BASE = 'https://api.x.ai/v1';

const FALLBACK_MODELS = ['grok-imagine-image', 'grok-imagine-image-quality'];

// "-quality" is the explicit top-tier variant; keep it out of the default slot.
const AVOID_KEYWORDS_FOR_DEFAULT = ['quality'];

const modelsCache = createTtlCache<ModelInfo[]>(MODEL_LIST_CACHE_TTL_MS);

function authHeaders(): Record<string, string> {
    const key = API_KEYS.grok;
    if (!key) throw new Error('XAI_API_KEY is not set');
    return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function fetchModelIdsFromApi(): Promise<string[]> {
    const res = await fetch(`${API_BASE}/models`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`xAI models list failed: ${res.status} ${await res.text()}`);
    const body: any = await res.json();
    return (body.data ?? []).map((m: any) => m.id as string).filter((id: string) => /image/i.test(id));
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
    if (entry.b64_json) return { data: entry.b64_json, mimeType: 'image/jpeg' };
    throw new Error('Expected b64_json in xAI image response; got: ' + JSON.stringify(entry).slice(0, 300));
}

async function generate(params: GenerateParams): Promise<GeneratedImage[]> {
    const res = await fetch(`${API_BASE}/images/generations`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
            model: params.model,
            prompt: params.prompt,
            n: params.n ?? 1,
            response_format: 'b64_json',
            ...(params.size ? { size: params.size } : {})
        })
    });
    if (!res.ok) throw new Error(`xAI image generation failed: ${res.status} ${await res.text()}`);
    const body: any = await res.json();
    return (body.data ?? []).map(parseImageData);
}

async function edit(params: EditParams): Promise<GeneratedImage[]> {
    if (params.inputImages.length > 1) {
        throw new Error('Grok image edit currently supports one input image per call in this server.');
    }
    const [image] = params.inputImages;
    const res = await fetch(`${API_BASE}/images/edits`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
            model: params.model,
            prompt: params.prompt,
            image: `data:${image.mimeType};base64,${image.data}`,
            response_format: 'b64_json'
        })
    });
    if (!res.ok) throw new Error(`xAI image edit failed: ${res.status} ${await res.text()}`);
    const body: any = await res.json();
    return (body.data ?? []).map(parseImageData);
}

export const grokProvider: ImageProvider = {
    id: 'grok',
    isConfigured: () => Boolean(API_KEYS.grok),
    listModels,
    getDefaultModel,
    generate,
    edit
};
