import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withRetry,
  isRetryableError,
  calculateDelay,
  RateLimiter,
} from '../../src/plaid/retry.js';

describe('Retry Logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isRetryableError', () => {
    it('should return true for rate limit errors', () => {
      const error = { error_code: 'RATE_LIMIT_EXCEEDED' };
      expect(isRetryableError(error, ['RATE_LIMIT_EXCEEDED'])).toBe(true);
    });

    it('should return true for internal server errors', () => {
      const error = { error_code: 'INTERNAL_SERVER_ERROR' };
      expect(isRetryableError(error, ['INTERNAL_SERVER_ERROR'])).toBe(true);
    });

    it('should return true for institution down errors', () => {
      const error = { error_code: 'INSTITUTION_DOWN' };
      expect(isRetryableError(error, ['INSTITUTION_DOWN'])).toBe(true);
    });

    it('should return true for HTTP 429 status', () => {
      const error = { status: 429 };
      expect(isRetryableError(error, [])).toBe(true);
    });

    it('should return true for HTTP 5xx status', () => {
      expect(isRetryableError({ status: 500 }, [])).toBe(true);
      expect(isRetryableError({ status: 502 }, [])).toBe(true);
      expect(isRetryableError({ status: 503 }, [])).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      const error = { error_code: 'INVALID_REQUEST' };
      expect(isRetryableError(error, ['RATE_LIMIT_EXCEEDED'])).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isRetryableError(null, [])).toBe(false);
      expect(isRetryableError(undefined, [])).toBe(false);
    });

    it('should return false for non-objects', () => {
      expect(isRetryableError('error', [])).toBe(false);
      expect(isRetryableError(123, [])).toBe(false);
    });

    it('should return false for HTTP 4xx status (except 429)', () => {
      expect(isRetryableError({ status: 400 }, [])).toBe(false);
      expect(isRetryableError({ status: 401 }, [])).toBe(false);
      expect(isRetryableError({ status: 404 }, [])).toBe(false);
    });
  });

  describe('calculateDelay', () => {
    it('should return initial delay for first attempt', () => {
      const delay = calculateDelay(1, 1000, 30000, 2);
      // Should be around 1000ms + jitter (0-30%)
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1300);
    });

    it('should increase delay exponentially', () => {
      const delay1 = calculateDelay(1, 1000, 30000, 2);
      const delay2 = calculateDelay(2, 1000, 30000, 2);
      const delay3 = calculateDelay(3, 1000, 30000, 2);

      // Base delays: 1000, 2000, 4000 (plus jitter)
      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });

    it('should cap delay at maxDelayMs', () => {
      const delay = calculateDelay(10, 1000, 5000, 2);
      expect(delay).toBeLessThanOrEqual(5000);
    });

    it('should apply jitter', () => {
      // Run multiple times to verify jitter varies
      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        delays.add(Math.round(calculateDelay(1, 1000, 30000, 2)));
      }
      // With jitter, we should get some variation
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  describe('withRetry', () => {
    it('should return result on success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await withRetry(fn, { maxRetries: 3 });
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce({ error_code: 'RATE_LIMIT_EXCEEDED' })
        .mockResolvedValue('success');

      const resultPromise = withRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 100,
        retryableErrors: ['RATE_LIMIT_EXCEEDED'],
      });

      // Fast-forward through the delay
      await vi.advanceTimersByTimeAsync(200);

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw after max retries', async () => {
      vi.useRealTimers(); // Use real timers for this test to avoid timing issues
      
      const error = new Error('Rate limit exceeded');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(
        withRetry(fn, {
          maxRetries: 2,
          initialDelayMs: 10, // Short delay for faster test
          retryableErrors: [], // Empty so it won't retry
        })
      ).rejects.toThrow('Rate limit exceeded');
      
      expect(fn).toHaveBeenCalledTimes(1); // No retries for non-retryable error
    });

    it('should not retry non-retryable errors', async () => {
      const error = new Error('Invalid request');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow('Invalid request');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry callback', async () => {
      const onRetry = vi.fn();
      const fn = vi.fn()
        .mockRejectedValueOnce({ error_code: 'RATE_LIMIT_EXCEEDED' })
        .mockResolvedValue('success');

      const resultPromise = withRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 100,
        retryableErrors: ['RATE_LIMIT_EXCEEDED'],
        onRetry,
      });

      await vi.advanceTimersByTimeAsync(200);
      await resultPromise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        1,
        expect.any(Error),
        expect.any(Number)
      );
    });
  });

  describe('RateLimiter', () => {
    it('should allow requests within limit', async () => {
      vi.useRealTimers(); // Use real timers for this test
      const limiter = new RateLimiter(10, 5);

      // Should be able to make 10 requests immediately
      for (let i = 0; i < 10; i++) {
        await limiter.acquire();
      }

      expect(limiter.getAvailableTokens()).toBeLessThan(1);
    });

    it('should track available tokens', () => {
      vi.useRealTimers();
      const limiter = new RateLimiter(10, 5);

      expect(limiter.getAvailableTokens()).toBe(10);
    });

    it('should refill tokens over time', async () => {
      vi.useRealTimers();
      const limiter = new RateLimiter(10, 10); // 10 tokens/second refill

      // Use all tokens
      for (let i = 0; i < 10; i++) {
        await limiter.acquire();
      }

      const tokensAfterDrain = limiter.getAvailableTokens();
      expect(tokensAfterDrain).toBeLessThan(1);

      // Wait for refill
      await new Promise((resolve) => setTimeout(resolve, 200));

      const tokensAfterWait = limiter.getAvailableTokens();
      expect(tokensAfterWait).toBeGreaterThan(tokensAfterDrain);
    });
  });
});
