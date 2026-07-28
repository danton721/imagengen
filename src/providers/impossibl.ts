import { API_KEYS, MODEL_LIST_CACHE_TTL_MS, USER_AGENT } from '../config.js';
import { createTtlCache } from './cache.js';
import { pickDefaultModel } from './heuristics.js';
import type { EditParams, GenerateParams, GeneratedImage, ImageProvider, ModelInfo } from './types.js';

const API_BASE = 'https://api.impossibl.com/v1';

const FALLBACK_MODELS = ['openai/gpt-image-2'];

const modelsCache = createTtlCache<ModelInfo[]>(MODEL_LIST_CACHE_TTL_MS);

function authHeaders(): Record<string, string> {
    const key = API_KEYS.impossibl;
    if (!key) throw new Error('IMPOSSIBL_API_KEY is not set');
    return { Authorization: `Bearer ${key}`, 'User-Agent': USER_AGENT };
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
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
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
