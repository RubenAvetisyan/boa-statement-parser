/**
 * Retry logic with exponential backoff for Plaid API calls.
 * Handles rate limiting and transient errors.
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    'RATE_LIMIT_EXCEEDED',
    'INTERNAL_SERVER_ERROR',
    'INSTITUTION_DOWN',
    'INSTITUTION_NOT_RESPONDING',
    'PLANNED_MAINTENANCE',
  ],
};

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable based on Plaid error codes.
 */
export function isRetryableError(error: unknown, retryableErrors: string[]): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }

  const plaidError = error as { error_code?: string; status?: number };

  // Check for Plaid error codes
  if (plaidError.error_code !== undefined) {
    return retryableErrors.includes(plaidError.error_code);
  }

  // Check for HTTP status codes (rate limiting, server errors)
  if (plaidError.status !== undefined) {
    return plaidError.status === 429 || (plaidError.status >= 500 && plaidError.status < 600);
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter.
 */
export function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number
): number {
  const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Execute a function with retry logic and exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if we've exhausted attempts or error is not retryable
      if (attempt > opts.maxRetries || !isRetryableError(error, opts.retryableErrors)) {
        throw lastError;
      }

      const delayMs = calculateDelay(
        attempt,
        opts.initialDelayMs,
        opts.maxDelayMs,
        opts.backoffMultiplier
      );

      if (options.onRetry !== undefined) {
        options.onRetry(attempt, lastError, delayMs);
      }

      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError ?? new Error('Retry failed');
}

/**
 * Create a retry wrapper for Plaid API calls.
 * Pre-configured with Plaid-specific error handling.
 */
export function createPlaidRetry(options: RetryOptions = {}): <T>(fn: () => Promise<T>) => Promise<T> {
  return <T>(fn: () => Promise<T>) => withRetry(fn, options);
}

/**
 * Rate limiter for Plaid API calls.
 * Ensures we don't exceed Plaid's rate limits.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second

  constructor(maxTokens: number = 10, refillRate: number = 5) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Wait for a token to become available
    const waitTime = ((1 - this.tokens) / this.refillRate) * 1000;
    await sleep(waitTime);
    this.refill();
    this.tokens -= 1;
  }

  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

let defaultRateLimiter: RateLimiter | null = null;

/**
 * Get the default rate limiter for Plaid API calls.
 */
export function getPlaidRateLimiter(): RateLimiter {
  if (defaultRateLimiter === null) {
    defaultRateLimiter = new RateLimiter();
  }
  return defaultRateLimiter;
}

/**
 * Reset the default rate limiter (for testing).
 */
export function resetPlaidRateLimiter(): void {
  defaultRateLimiter = null;
}

/**
 * Execute a function with rate limiting and retry logic.
 */
export async function withRateLimitAndRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const rateLimiter = getPlaidRateLimiter();
  await rateLimiter.acquire();
  return withRetry(fn, options);
}
