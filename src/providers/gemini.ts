import { API_KEYS, MODEL_LIST_CACHE_TTL_MS, USER_AGENT } from '../config.js';
import { createTtlCache } from './cache.js';
import { pickDefaultModel } from './heuristics.js';
import type { EditParams, GenerateParams, GeneratedImage, ImageProvider, ModelInfo } from './types.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Live-discovered "Nano Banana" lineup as of writing; only used if models.list fails.
const FALLBACK_MODELS = ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image'];

// "pro" = top-tier quality, "lite" = stripped down: neither should win the default slot.
const AVOID_KEYWORDS_FOR_DEFAULT = ['pro', 'lite'];

const modelsCache = createTtlCache<ModelInfo[]>(MODEL_LIST_CACHE_TTL_MS);

function apiKey(): string {
    const key = API_KEYS.gemini;
    if (!key) throw new Error('GEMINI_API_KEY is not set');
    return key;
}

async function fetchModelIdsFromApi(): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;

    do {
        const url = new URL(`${API_BASE}/models`);
        url.searchParams.set('pageSize', '200');
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const res = await fetch(url, { headers: { 'x-goog-api-key': apiKey(), 'User-Agent': USER_AGENT } });
        if (!res.ok) throw new Error(`Gemini models.list failed: ${res.status} ${await res.text()}`);
        const body: any = await res.json();

        for (const model of body.models ?? []) {
            const name: string = model.name ?? '';
            const shortId = name.replace(/^models\//, '');
            if (/image/i.test(shortId)) ids.push(shortId);
        }
        pageToken = body.nextPageToken;
    } while (pageToken);

    return ids;
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

interface InteractionContentBlock {
    type: string;
    data?: string;
    mime_type?: string;
}

function extractImages(body: any): GeneratedImage[] {
    const images: GeneratedImage[] = [];

    if (body.output_image?.data) {
        images.push({ data: body.output_image.data, mimeType: body.output_image.mime_type ?? 'image/png' });
    }

    for (const step of body.steps ?? []) {
        if (step.type !== 'model_output') continue;
        for (const block of (step.content ?? []) as InteractionContentBlock[]) {
            if (block.type === 'image' && block.data) {
                images.push({ data: block.data, mimeType: block.mime_type ?? 'image/png' });
            }
        }
    }

    if (images.length === 0) {
        throw new Error(`Gemini response did not contain an image: ${JSON.stringify(body).slice(0, 500)}`);
    }
    return images;
}

async function callInteractions(model: string, input: unknown[], size?: string, aspectRatio?: string): Promise<GeneratedImage[]> {
    const res = await fetch(`${API_BASE}/interactions`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({
            model,
            input,
            response_format: {
                type: 'image',
                image_size: size ?? '1K',
                ...(aspectRatio ? { aspect_ratio: aspectRatio } : {})
            }
        })
    });
    if (!res.ok) throw new Error(`Gemini interactions call failed: ${res.status} ${await res.text()}`);
    return extractImages(await res.json());
}

async function generate(params: GenerateParams): Promise<GeneratedImage[]> {
    const n = params.n ?? 1;
    const results: GeneratedImage[] = [];
    for (let i = 0; i < n; i++) {
        const images = await callInteractions(
            params.model,
            [{ type: 'text', text: params.prompt }],
            params.size,
            params.aspectRatio
        );
        results.push(...images);
    }
    return results;
}

async function edit(params: EditParams): Promise<GeneratedImage[]> {
    const input: unknown[] = [{ type: 'text', text: params.prompt }];
    for (const img of params.inputImages) {
        input.push({ type: 'image', mime_type: img.mimeType, data: img.data });
    }
    return callInteractions(params.model, input, params.size, params.aspectRatio);
}

export const geminiProvider: ImageProvider = {
    id: 'gemini',
    isConfigured: () => Boolean(API_KEYS.gemini),
    listModels,
    getDefaultModel,
    generate,
    edit
};
