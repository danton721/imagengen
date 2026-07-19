/**
 * Ranks discovered model ids to pick a sensible default: prefer newer
 * (higher version number in the name) while avoiding top-tier/"full quality"
 * variants, so the default never silently picks the most expensive option.
 */
export function pickDefaultModel(modelIds: string[], avoidKeywords: string[]): string | undefined {
    if (modelIds.length === 0) return undefined;

    const scored = modelIds.map(id => {
        const lower = id.toLowerCase();
        const versionNumbers = lower.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [0];
        let score = Math.max(...versionNumbers) * 10;
        for (const keyword of avoidKeywords) {
            if (lower.includes(keyword)) score -= 100;
        }
        return { id, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].id;
}
