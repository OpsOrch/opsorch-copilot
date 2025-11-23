/**
 * Normalize metric step to a positive integer
 */
export function normalizeMetricStep(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const integer = Math.trunc(value);
        return integer > 0 ? integer : undefined;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        // Ensure string contains only digits (no '60s', '1m', etc.)
        if (!/^\d+$/.test(trimmed)) return undefined;

        const parsed = Number.parseInt(trimmed, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return undefined;
}
