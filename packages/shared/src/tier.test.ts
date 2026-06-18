import { describe, expect, it } from 'vitest';
import { assignFullTier, assignTier, baseTier, MIN_TIER_GAMES } from './tier.js';

describe('assignFullTier', () => {
  it('maps win rate to the fine S+ … D- scale', () => {
    expect(assignFullTier(0.56, 500)).toBe('S+');
    expect(assignFullTier(0.54, 500)).toBe('S');
    expect(assignFullTier(0.526, 500)).toBe('S-');
    expect(assignFullTier(0.516, 500)).toBe('A');
    expect(assignFullTier(0.5, 500)).toBe('B');
    expect(assignFullTier(0.485, 500)).toBe('C');
    expect(assignFullTier(0.44, 500)).toBe('D-');
  });

  it('caps low-sample champions at D- regardless of win rate', () => {
    expect(assignFullTier(0.7, MIN_TIER_GAMES - 1)).toBe('D-');
    expect(assignFullTier(0.7, MIN_TIER_GAMES)).toBe('S+');
  });
});

describe('assignTier (base letter)', () => {
  it('is the first character of the full grade', () => {
    expect(assignTier(0.56, 500)).toBe('S');
    expect(assignTier(0.516, 500)).toBe('A');
    expect(assignTier(0.5, 500)).toBe('B');
    expect(assignTier(0.485, 500)).toBe('C');
    expect(assignTier(0.44, 500)).toBe('D');
    expect(baseTier('S+')).toBe('S');
  });
});
