import { describe, expect, it } from 'vitest';
import { wilsonLowerBound, confidenceLevel, toPercent } from './stats.js';

describe('wilsonLowerBound', () => {
  it('returns 0 for zero games', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it('penalises tiny samples vs large samples at the same win rate', () => {
    const small = wilsonLowerBound(6, 10); // 60% over 10
    const large = wilsonLowerBound(2650, 5000); // 53% over 5000
    expect(large).toBeGreaterThan(small);
  });

  it('approaches the raw rate as the sample grows', () => {
    const lb = wilsonLowerBound(55_000, 100_000); // 55% over 100k
    expect(lb).toBeGreaterThan(0.54);
    expect(lb).toBeLessThan(0.55);
  });

  it('stays within [0, 1]', () => {
    expect(wilsonLowerBound(1, 1)).toBeGreaterThanOrEqual(0);
    expect(wilsonLowerBound(1, 1)).toBeLessThanOrEqual(1);
  });
});

describe('confidenceLevel', () => {
  it('buckets by sample size', () => {
    expect(confidenceLevel(10)).toBe('insufficient');
    expect(confidenceLevel(50)).toBe('low');
    expect(confidenceLevel(500)).toBe('medium');
    expect(confidenceLevel(5000)).toBe('high');
  });
});

describe('toPercent', () => {
  it('formats a proportion with fixed decimals', () => {
    expect(toPercent(0.5234)).toBe(52.34);
    expect(toPercent(0.5, 0)).toBe(50);
  });
});
