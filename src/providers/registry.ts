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

export function configuredProviderIds(): ProviderId[] {
    return ALL_PROVIDER_IDS.filter(id => PROVIDERS[id].isConfigured());
}

export type ResolveResult =
    | { ok: true; provider: ImageProvider }
    | { ok: false; reason: 'unknown_provider'; requested: string }
    | { ok: false; reason: 'not_configured'; provider: ProviderId }
    | { ok: false; reason: 'no_provider_configured' }
    | { ok: false; reason: 'ambiguous'; available: ProviderId[] };

/**
 * Resolution order: explicit `requested` argument > IMAGE_PROVIDER_DEFAULT env
 * var > the single configured provider (if only one) > ambiguous (caller must
 * ask the user and retry with `provider` set).
 */
export function resolveProvider(requested?: string): ResolveResult {
    if (requested) {
        if (!(ALL_PROVIDER_IDS as string[]).includes(requested)) {
            return { ok: false, reason: 'unknown_provider', requested };
        }
        const id = requested as ProviderId;
        if (!PROVIDERS[id].isConfigured()) {
            return { ok: false, reason: 'not_configured', provider: id };
        }
        return { ok: true, provider: PROVIDERS[id] };
    }

    if (CONFIGURED_DEFAULT_PROVIDER && PROVIDERS[CONFIGURED_DEFAULT_PROVIDER].isConfigured()) {
        return { ok: true, provider: PROVIDERS[CONFIGURED_DEFAULT_PROVIDER] };
    }

    const configured = configuredProviderIds();
    if (configured.length === 0) return { ok: false, reason: 'no_provider_configured' };
    if (configured.length === 1) return { ok: true, provider: PROVIDERS[configured[0]] };
    return { ok: false, reason: 'ambiguous', available: configured };
}
