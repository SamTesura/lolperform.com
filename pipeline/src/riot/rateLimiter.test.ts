import { describe, expect, it } from 'vitest';
import { parseRateLimitHeader } from './rateLimiter.js';

describe('parseRateLimitHeader', () => {
  it('parses the classic dev-key header', () => {
    expect(parseRateLimitHeader('20:1,100:120')).toEqual([
      { limit: 20, intervalMs: 1000 },
      { limit: 100, intervalMs: 120_000 },
    ]);
  });

  it('parses a production-style header', () => {
    expect(parseRateLimitHeader('500:10,30000:600')).toEqual([
      { limit: 500, intervalMs: 10_000 },
      { limit: 30_000, intervalMs: 600_000 },
    ]);
  });

  it('handles whitespace and a single window', () => {
    expect(parseRateLimitHeader(' 20:1 ')).toEqual([{ limit: 20, intervalMs: 1000 }]);
  });

  it('rejects malformed values wholesale', () => {
    expect(parseRateLimitHeader('')).toEqual([]);
    expect(parseRateLimitHeader('garbage')).toEqual([]);
    expect(parseRateLimitHeader('20:1,not:a:window')).toEqual([]);
    expect(parseRateLimitHeader('0:1')).toEqual([]);
    expect(parseRateLimitHeader('20:0')).toEqual([]);
    expect(parseRateLimitHeader('-5:1')).toEqual([]);
  });
});
