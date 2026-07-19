import path from 'node:path';

export type ProviderId = 'gemini' | 'grok' | 'gpt-image';

export const ALL_PROVIDER_IDS: ProviderId[] = ['gemini', 'grok', 'gpt-image'];

export const API_KEYS: Record<ProviderId, string | undefined> = {
    gemini: process.env.GEMINI_API_KEY,
    grok: process.env.XAI_API_KEY,
    'gpt-image': process.env.OPENAI_API_KEY
};

const rawDefault = process.env.IMAGE_PROVIDER_DEFAULT?.trim().toLowerCase();
export const CONFIGURED_DEFAULT_PROVIDER: ProviderId | undefined =
    rawDefault && (ALL_PROVIDER_IDS as string[]).includes(rawDefault) ? (rawDefault as ProviderId) : undefined;

export const OUTPUT_DIR = path.resolve(process.env.IMAGE_OUTPUT_DIR || './output');

export const MODEL_LIST_CACHE_TTL_MS = 60 * 60 * 1000;
