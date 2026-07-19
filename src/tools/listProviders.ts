import { z } from 'zod';
import { ALL_PROVIDER_IDS, CONFIGURED_DEFAULT_PROVIDER } from '../config.js';
import { configuredProviderIds, PROVIDERS } from '../providers/registry.js';

export const listProvidersInputSchema = {
    refresh: z.boolean().optional().describe('Bypass the ~1 hour model list cache and re-fetch each configured provider now.')
};

export async function listProvidersHandler({ refresh }: { refresh?: boolean }) {
    const configured = configuredProviderIds();
    const providers: Record<string, unknown> = {};

    for (const id of ALL_PROVIDER_IDS) {
        const provider = PROVIDERS[id];
        if (!provider.isConfigured()) {
            providers[id] = { configured: false, models: [], default_model: null };
            continue;
        }
        try {
            const models = await provider.listModels(refresh);
            providers[id] = {
                configured: true,
                models: models.map(m => m.id),
                default_model: models.find(m => m.isDefault)?.id ?? null
            };
        } catch (err) {
            providers[id] = {
                configured: true,
                models: [],
                default_model: null,
                error: err instanceof Error ? err.message : String(err)
            };
        }
    }

    const resolvedDefault =
        CONFIGURED_DEFAULT_PROVIDER && configured.includes(CONFIGURED_DEFAULT_PROVIDER)
            ? CONFIGURED_DEFAULT_PROVIDER
            : configured.length === 1
              ? configured[0]
              : null;

    const payload = {
        configured_providers: configured,
        resolved_default_provider: resolvedDefault,
        needs_provider_choice: configured.length > 1 && !resolvedDefault,
        providers
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}
