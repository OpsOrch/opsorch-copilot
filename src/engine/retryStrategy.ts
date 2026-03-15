/**
 * Retry strategy with exponential backoff and jitter for resilient LLM and MCP calls.
 */

import { RetryConfig } from "../types.js";

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  jitterFactor: 0.3,
};

export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly isTransient: boolean = true,
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitBreakerError";
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Determines if an error is transient and should be retried.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof RetryableError) {
    return error.isTransient;
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  // Network errors
  if (
    lowerMessage.includes("econnreset") ||
    lowerMessage.includes("econnrefused") ||
    lowerMessage.includes("etimedout") ||
    lowerMessage.includes("network")
  ) {
    return true;
  }

  // Rate limiting
  if (
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("429") ||
    lowerMessage.includes("too many requests")
  ) {
    return true;
  }

  // Temporary server errors
  if (
    lowerMessage.includes("503") ||
    lowerMessage.includes("502") ||
    lowerMessage.includes("504") ||
    lowerMessage.includes("service unavailable")
  ) {
    return true;
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter.
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = Math.min(
    config.baseDelayMs * Math.pow(2, attempt),
    config.maxDelayMs,
  );

  const jitter =
    exponentialDelay * config.jitterFactor * (Math.random() - 0.5) * 2;
  return Math.max(0, exponentialDelay + jitter);
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Circuit breaker to prevent cascading failures.
 */
class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private readonly threshold: number = 5,
    private readonly resetTimeMs: number = 60000,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure < this.resetTimeMs) {
        throw new CircuitBreakerError("Circuit breaker is open");
      }
      this.state = "half-open";
    }

    try {
      const result = await fn();
      if (this.state === "half-open") {
        this.reset();
      }
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.threshold) {
      this.state = "open";
    }
  }

  private reset(): void {
    this.failureCount = 0;
    this.state = "closed";
  }
}

// Store circuit breakers per context to avoid global state issues in tests
const circuitBreakers = new Map<string, CircuitBreaker>();

function getCircuitBreaker(context?: string): CircuitBreaker {
  const key = context || "default";
  if (!circuitBreakers.has(key)) {
    circuitBreakers.set(key, new CircuitBreaker());
  }
  return circuitBreakers.get(key)!;
}

/**
 * Retry a function with exponential backoff.
 * @param fn Function to retry
 * @param config Retry configuration
 * @param context Context identifier for circuit breaker isolation (optional)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  context?: string,
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const circuitBreaker = getCircuitBreaker(context);
  let lastError: unknown;

  for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      return await circuitBreaker.execute(fn);
    } catch (error) {
      lastError = error;

      if (error instanceof CircuitBreakerError) {
        console.warn(
          `[Retry]${context ? ` [${context}]` : ""} Circuit breaker open, not retrying`,
        );
        throw error;
      }

      if (!isTransientError(error)) {
        console.warn(
          `[Retry]${context ? ` [${context}]` : ""} Non-transient error, not retrying: ${formatErrorMessage(error)}`,
        );
        throw error;
      }

      if (attempt < finalConfig.maxRetries) {
        const delay = calculateDelay(attempt, finalConfig);
        console.warn(
          `[Retry]${context ? ` [${context}]` : ""} Attempt ${attempt + 1}/${finalConfig.maxRetries} failed, retrying in ${delay}ms:`,
          error instanceof Error ? error.message : String(error),
        );
        await sleep(delay);
      }
    }
  }

  console.error(
    `[Retry]${context ? ` [${context}]` : ""} All ${finalConfig.maxRetries} retries exhausted`,
  );
  throw lastError;
}
