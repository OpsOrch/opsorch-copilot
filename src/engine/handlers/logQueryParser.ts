/**
 * generateSearchExpression:
 * Extracts log search terms from text (incident title, metric name, user question)
 * using a comprehensive operational vocabulary.
 *
 * Maps specific operational terms to targeted log queries.
 * Returns a default "error OR exception" if no keywords are found.
 */
import { DEFAULT_STOP_WORDS } from "../constants.js";

type SearchClause =
    | { type: "term"; term: string }
    | { type: "anyOf"; terms: string[] }
    | { type: "phrase"; phrase: string }
    | { type: "not"; term: string }
    | { type: "field"; key: string; value: string };

interface SearchQueryIR {
    all: SearchClause[];
}

const vocabulary: Record<string, string[]> = {
    // --- Performance ---
    latency: ["latency", "lag", "slow", "duration"],
    lag: ["lag", "latency", "delay"],
    slow: ["slow", "latency", "timeout"],
    timeout: ["timeout", "timed out", "deadline"],
    throttl: ["throttl*", "rate limit", "quota"],
    stall: ["stalled", "stuck", "hang"],
    degrad: ["degraded", "slow"],

    // --- Resources ---
    cpu: ["cpu", "high load", "utilization"],
    memory: ["memory", "heap", "leak", "rss"],
    oom: ["oom", "out of memory", "kill"],
    disk: ["disk", "space", "full", "capacity"],
    space: ["space", "full", "capacity"],
    quot: ["quota", "limit", "capacity"],
    gc: ["gc", "garbage collection", "pause"],
    garbage: ["gc", "garbage collection", "pause"],
    leak: ["leak", "memory"],

    // --- Network ---
    connect: ["connection", "conn", "reset", "refused"],
    network: ["network", "dns", "unreachable", "packet"],
    dns: ["dns", "lookup", "resolve"],
    port: ["port", "bind", "in use"],
    unreachable: ["unreachable", "route", "down"],
    reset: ["reset", "closed"],

    // --- Database / Storage ---
    database: ["database", "db", "sql", "query"],
    db: ["db", "database", "sql"],
    sql: ["sql", "query", "lock"],
    deadlock: ["deadlock", "lock", "wait"],
    lock: ["lock", "wait", "blocked"],
    transaction: ["transaction", "tx", "rollback"],
    rollback: ["rollback", "abort"],
    commit: ["commit", "fail"],
    pool: ["pool", "connection", "exhaust"],
    redis: ["redis", "cache", "timeout"],
    cache: ["cache", "miss", "hit"],

    // --- Security ---
    auth: ["auth", "login", "token", "session"],
    permission: ["permission", "denied", "forbidden"],
    denied: ["denied", "forbidden", "403"],
    forbidden: ["forbidden", "denied", "403"],
    token: ["token", "jwt", "expire"],
    key: ["key", "secret", "invalid"],
    attack: ["attack", "injection", "ddos"],
    vulnerab: ["vulnerable", "exploit"],

    // --- Application / Code ---
    null: ["null pointer", "npe", "undefined"],
    undef: ["undefined", "null"],
    crash: ["crash", "panic", "stack", "exception"],
    stack: ["stack", "trace"],
    panic: ["panic", "fatal"],
    segfault: ["segfault", "segmentation fault"],
    exception: ["exception", "error", "stack"],
    error: ["error", "fail", "exception"],
    fail: ["fail", "error", "crash"],
    bug: ["bug", "error", "issue"],

    // --- Traffic / Ingress ---
    traffic: ["traffic", "request", "rps"],
    request: ["request", "http", "status"],
    ingress: ["ingress", "load balancer", "lb"],
    "500": ["500", "502", "503", "504"],
    "502": ["502", "bad gateway"],
    "503": ["503", "unavailable"],
    "504": ["504", "gateway timeout"],
    "404": ["404", "not found"],
    "403": ["403", "forbidden"],
    "401": ["401", "unauthorized"],

    // --- Infrastructure ---
    pod: ["pod", "restart", "crashloop"],
    container: ["container", "docker", "image"],
    node: ["node", "kubelet", "drain"],
    restart: ["restart", "boot", "start"],
    deploy: ["deploy", "rollout", "version"],
    config: ["config", "yaml", "map"],
};

const stopWords = new Set(DEFAULT_STOP_WORDS);

/**
 * Tokenize input string into defined types.
 */
type Token =
    | { type: "field"; key: string; value: string }
    | { type: "quoted"; value: string }
    | { type: "negation"; value: string }
    | { type: "word"; value: string };

function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    // Regex for:
    // 1. Quoted string: "foo bar"
    // 2. Field: key:value or key="value"
    // 3. Negation: -term or NOT term (heuristic for NOT)
    // 4. Word: standard term

    // Using a simple loop with regex to consume string
    let remaining = text.trim();

    while (remaining.length > 0) {
        // Field with quotes: key="value"
        let match = remaining.match(/^([a-zA-Z0-9_\-.]+):"([^"]+)"/);
        if (match) {
            tokens.push({ type: "field", key: match[1], value: match[2] });
            remaining = remaining.slice(match[0].length).trim();
            continue;
        }

        // Field simple: key:value
        match = remaining.match(/^([a-zA-Z0-9_\-.]+):([a-zA-Z0-9_\-.*]+)/);
        if (match) {
            tokens.push({ type: "field", key: match[1], value: match[2] });
            remaining = remaining.slice(match[0].length).trim();
            continue;
        }

        // Quoted String: "foo bar"
        match = remaining.match(/^"([^"]+)"/);
        if (match) {
            tokens.push({ type: "quoted", value: match[1] });
            remaining = remaining.slice(match[0].length).trim();
            continue;
        }

        // Negation: -term
        match = remaining.match(/^-([a-zA-Z0-9_\-.*]+)/);
        if (match) {
            tokens.push({ type: "negation", value: match[1] });
            remaining = remaining.slice(match[0].length).trim();
            continue;
        }

        // Explicit NOT: NOT term
        // Lookahead to ensure we match "NOT " followed by a word
        match = remaining.match(/^NOT\s+([a-zA-Z0-9_\-.*]+)/);
        if (match) {
            tokens.push({ type: "negation", value: match[1] });
            remaining = remaining.slice(match[0].length).trim();
            continue;
        }

        // Standard Word
        // Match up to next whitespace or quote or start of special char
        match = remaining.match(/^([^\s"]+)/);
        if (match) {
            const word = match[1];
            // If word looks like `word` (no special structure), add it.
            // But we already handled structure above, so this is likely a plain word.
            tokens.push({ type: "word", value: word });
            remaining = remaining.slice(match[0].length).trim();
            continue;
        }

        // Safety break if no match found (should be covered by "Standard Word" unless exotic chars)
        // Skip one char
        remaining = remaining.slice(1).trim();
    }

    return tokens;
}

/**
 * Expand a single word concept using vocabulary.
 */
function expandConcept(word: string): SearchClause | null {
    const lower = word.toLowerCase();
    for (const [trigger, terms] of Object.entries(vocabulary)) {
        const isStatusCode = /^\d+$/.test(trigger);
        if (
            (isStatusCode && lower === trigger) ||
            (!isStatusCode && lower.includes(trigger))
        ) {
            return { type: "anyOf", terms };
        }
    }
    return null;
}

/**
 * Turn free text (title, metric name, question) into a provider-agnostic IR.
 */
export function buildSearchQueryIR(text: string): SearchQueryIR {
    const tokens = tokenize(text);
    const clauses: SearchClause[] = [];
    const seenGroups = new Set<string>();

    for (const token of tokens) {
        if (token.type === "field") {
            clauses.push({ type: "field", key: token.key, value: token.value });
        } else if (token.type === "quoted") {
            clauses.push({ type: "phrase", phrase: token.value });
        } else if (token.type === "negation") {
            // Negations are not expanded usually, just strict exclusion
            clauses.push({ type: "not", term: token.value });
        } else if (token.type === "word") {
            const word = token.value;
            // Stop word check only for free words
            if (stopWords.has(word.toLowerCase())) {
                continue;
            }

            const expanded = expandConcept(word);
            if (expanded) {
                if (expanded.type === "anyOf") {
                    const key = expanded.terms.join("|");
                    if (!seenGroups.has(key)) {
                        seenGroups.add(key);
                        clauses.push(expanded);
                    }
                }
            } else {
                // Free term
                clauses.push({ type: "term", term: word });
            }
        }
    }

    // Fallback: no signal → default error search
    if (clauses.length === 0) {
        return {
            all: [
                {
                    type: "anyOf",
                    terms: ["error", "exception"],
                },
            ],
        };
    }

    return { all: clauses };
}

/**
 * Serializes the IR into a string representation for downstream tools (like LogQL or simple string search).
 */
export function generateSearchExpression(text: string): string {
    const ir = buildSearchQueryIR(text);

    return ir.all
        .map((clause) => {
            switch (clause.type) {
                case "term":
                    return clause.term;
                case "anyOf":
                    return `(${clause.terms.join(" OR ")})`;
                case "phrase":
                    return `"${clause.phrase}"`;
                case "not":
                    return `NOT ${clause.term}`;
                case "field":
                    return `${clause.key}:${clause.value}`;
            }
        })
        .join(" AND ");
}

// For backward compatibility if needed, though we updated the main export above.
export const generateSearchIRFromText = buildSearchQueryIR;