import { describe, expect, it } from 'vitest';
import { assignTier, MIN_TIER_GAMES } from './tier.js';

describe('assignTier', () => {
  it('maps win rate to bands once games clear the minimum', () => {
    expect(assignTier(0.6, 100)).toBe('S');
    expect(assignTier(0.52, 100)).toBe('A');
    expect(assignTier(0.508, 100)).toBe('B');
    expect(assignTier(0.495, 100)).toBe('C');
    expect(assignTier(0.47, 100)).toBe('D');
  });

  it('caps low-sample champions at D regardless of win rate', () => {
    expect(assignTier(0.7, MIN_TIER_GAMES - 1)).toBe('D');
    expect(assignTier(0.7, MIN_TIER_GAMES)).toBe('S');
  });
});
