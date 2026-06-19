import { describe, expect, it } from 'vitest';
import { assignFullTier, assignTier, baseTier, MIN_TIER_GAMES } from './tier.js';

describe('assignFullTier', () => {
  it('maps win rate to the fine S+ … D- scale', () => {
    expect(assignFullTier(0.54, 500)).toBe('S+');
    expect(assignFullTier(0.53, 500)).toBe('S');
    expect(assignFullTier(0.52, 500)).toBe('S-');
    expect(assignFullTier(0.507, 500)).toBe('A');
    expect(assignFullTier(0.5, 500)).toBe('A-');
    expect(assignFullTier(0.492, 500)).toBe('B');
    expect(assignFullTier(0.43, 500)).toBe('D-');
  });

  it('caps low-sample champions at D- regardless of win rate', () => {
    expect(assignFullTier(0.7, MIN_TIER_GAMES - 1)).toBe('D-');
    expect(assignFullTier(0.7, MIN_TIER_GAMES)).toBe('S+');
  });
});

describe('assignTier (base letter)', () => {
  it('is the first character of the full grade', () => {
    expect(assignTier(0.54, 500)).toBe('S');
    expect(assignTier(0.507, 500)).toBe('A');
    expect(assignTier(0.492, 500)).toBe('B');
    expect(assignTier(0.475, 500)).toBe('C');
    expect(assignTier(0.43, 500)).toBe('D');
    expect(baseTier('S+')).toBe('S');
  });
});
