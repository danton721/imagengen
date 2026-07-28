import { ALL_PROVIDER_IDS } from '../config.js';
import { resolveProvider, type ResolveResult } from '../providers/registry.js';
import type { ImageProvider } from '../providers/types.js';

export interface ToolTextContent {
    [x: string]: unknown;
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}

export interface ResolvedTarget {
    provider: ImageProvider;
    model: string;
}

function describeResolutionFailure(result: Exclude<ResolveResult, { ok: true }>): ToolTextContent {
    switch (result.reason) {
        case 'ambiguous':
            return jsonError({
                error: 'needs_provider_choice',
                available: result.available,
                instructions:
                    'Multiple image providers are configured and no IMAGE_PROVIDER_DEFAULT is set. ' +
                    'First check your memory for a stored user preference for a default image provider. ' +
                    'If there is none, ask the user which provider to use (' +
                    result.available.join(', ') +
                    '), then retry this tool call with the `provider` argument set, and remember their answer for next time.'
            });
        case 'no_provider_configured':
            return jsonError({
                error: 'no_provider_configured',
                instructions:
                    'No image provider API key is configured. Set one of GEMINI_API_KEY, XAI_API_KEY, OPENAI_API_KEY, or IMPOSSIBL_API_KEY ' +
                    'as an environment variable for this MCP server.'
            });
        case 'not_configured':
            return jsonError({
                error: 'provider_not_configured',
                provider: result.provider,
                instructions: `The requested provider "${result.provider}" has no API key configured for this server.`
            });
        case 'unknown_provider':
            return jsonError({
                error: 'unknown_provider',
                requested: result.requested,
                valid_providers: ALL_PROVIDER_IDS
            });
    }
}

function jsonError(payload: unknown): ToolTextContent {
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
}

export function isToolTextContent(value: unknown): value is ToolTextContent {
    return typeof value === 'object' && value !== null && 'content' in value;
}

export async function resolveTarget(
    requestedProvider: string | undefined,
    requestedModel: string | undefined
): Promise<ResolvedTarget | ToolTextContent> {
    const result = resolveProvider(requestedProvider);
    if (!result.ok) return describeResolutionFailure(result);

    const model = requestedModel ?? (await result.provider.getDefaultModel());
    return { provider: result.provider, model };
}

export function handlerError(err: unknown): ToolTextContent {
    return {
        content: [{ type: 'text', text: `Image request failed: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true
    };
}
