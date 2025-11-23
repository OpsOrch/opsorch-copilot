/**
 * Shared timestamp validation and normalization utilities
 */

/**
 * Check if value is a valid timestamp (string or number)
 */
export function isValidTimestamp(value: any): boolean {
    if (typeof value === 'string') {
        return /\d{4}-\d{2}-\d{2}T/.test(value);
    }
    if (typeof value === 'number') {
        // Unix timestamp (seconds or milliseconds)
        return value > 1000000000 && value < 9999999999999;
    }
    return false;
}

/**
 * Normalize timestamp to ISO string
 */
export function normalizeTimestamp(value: any): string {
    if (typeof value === 'string') {
        if (isValidTimestamp(value)) {
            return value;
        }
        // Fall through to return current time for invalid strings
    }
    if (typeof value === 'number') {
        // Convert to milliseconds if needed
        const ms = value < 10000000000 ? value * 1000 : value;
        return new Date(ms).toISOString();
    }
    return new Date().toISOString();
}

/**
 * Validate ISO date string
 */
export function isValidISODate(dateString: string): boolean {
    const date = new Date(dateString);
    return !isNaN(date.getTime()) && dateString.includes('T');
}

/**
 * Check if string is valid ISO 8601 timestamp
 */
export function isValidISO8601(value: string): boolean {
    if (typeof value !== 'string') return false;

    // Basic format check
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
        return false;
    }

    // Try parsing
    const date = new Date(value);
    return !isNaN(date.getTime());
}

/**
 * Get timestamp in milliseconds from ISO date string
 */
export function getTimestampMs(dateString: string): number {
    return new Date(dateString).getTime();
}

/**
 * Calculate duration in milliseconds between two ISO date strings
 */
export function calculateDurationMs(start: string, end: string): number {
    return getTimestampMs(end) - getTimestampMs(start);
}

/**
 * Parse time expression like "last 2 hours", "past 30 minutes"
 * Returns time window with start and end timestamps
 */
export function parseTimeExpression(text: string): { start: string; end: string } | undefined {
    const match = text.match(/(last|past|previous)\s+(\d+)\s+(minute|hour|day)s?/i);
    if (!match) return undefined;

    const amount = parseInt(match[2], 10);
    const unit = match[3].toLowerCase();

    let milliseconds = 0;
    if (unit === 'minute') milliseconds = amount * 60 * 1000;
    else if (unit === 'hour') milliseconds = amount * 60 * 60 * 1000;
    else if (unit === 'day') milliseconds = amount * 24 * 60 * 60 * 1000;

    const end = new Date();
    const start = new Date(end.getTime() - milliseconds);

    return {
        start: start.toISOString(),
        end: end.toISOString(),
    };
}
