export function createTtlCache<T>(ttlMs: number) {
    let value: T | undefined;
    let fetchedAt = 0;

    return {
        async get(fetcher: () => Promise<T>, forceRefresh = false): Promise<T> {
            const isFresh = value !== undefined && Date.now() - fetchedAt < ttlMs;
            if (!forceRefresh && isFresh) {
                return value as T;
            }
            value = await fetcher();
            fetchedAt = Date.now();
            return value;
        }
    };
}
