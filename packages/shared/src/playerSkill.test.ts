import { describe, expect, it } from 'vitest';
import {
  adjustWinRate,
  MAX_PLAYER_POOL_DELTA,
  playerPoolDelta,
  PLAYER_POOL_SHRINKAGE,
} from './playerSkill.js';

const many = (value: number, n: number): number[] => Array.from({ length: n }, () => value);

describe('playerPoolDelta', () => {
  it('is exactly zero with no observations, so the correction is inert until data exists', () => {
    const r = playerPoolDelta({ baselines: [], poolMean: 0.5 });
    expect(r.delta).toBe(0);
    expect(r.observations).toBe(0);
  });

  it('is positive when a champion is picked by stronger-than-average players', () => {
    const r = playerPoolDelta({ baselines: many(0.55, 600), poolMean: 0.5 });
    expect(r.delta).toBeGreaterThan(0);
  });

  it('is negative when a champion is picked by weaker-than-average players', () => {
    const r = playerPoolDelta({ baselines: many(0.47, 600), poolMean: 0.5 });
    expect(r.delta).toBeLessThan(0);
  });

  it('shrinks toward zero with few observations', () => {
    const few = playerPoolDelta({ baselines: many(0.55, 10), poolMean: 0.5 });
    const lots = playerPoolDelta({ baselines: many(0.55, 2000), poolMean: 0.5 });
    expect(Math.abs(few.delta)).toBeLessThan(Math.abs(lots.delta));
    // at exactly the shrinkage constant, half the measured gap survives
    const half = playerPoolDelta({
      baselines: many(0.53, PLAYER_POOL_SHRINKAGE),
      poolMean: 0.5,
    });
    expect(half.delta).toBeCloseTo(0.03 / 2, 6);
  });

  it('never exceeds the cap, however extreme the observations', () => {
    const r = playerPoolDelta({ baselines: many(0.95, 5000), poolMean: 0.5 });
    expect(r.delta).toBeCloseTo(MAX_PLAYER_POOL_DELTA, 10);
    const l = playerPoolDelta({ baselines: many(0.05, 5000), poolMean: 0.5 });
    expect(l.delta).toBeCloseTo(-MAX_PLAYER_POOL_DELTA, 10);
  });

  it('under-corrects rather than over-corrects (the (1-f) attenuation)', () => {
    // A champion whose players are 2pp above average, measured cleanly. The
    // true correction is (w - s)/(1 - f) >= (w - s); we apply only (w - s), so
    // the delta must never exceed the measured gap.
    const measuredGap = 0.02;
    const r = playerPoolDelta({ baselines: many(0.5 + measuredGap, 10_000), poolMean: 0.5 });
    expect(r.delta).toBeLessThanOrEqual(measuredGap + 1e-12);
  });
});

describe('adjustWinRate', () => {
  it('gives back what strong players contributed and credits weak ones', () => {
    expect(adjustWinRate(0.52, 0.02)).toBeCloseTo(0.5, 10);
    expect(adjustWinRate(0.48, -0.02)).toBeCloseTo(0.5, 10);
  });

  it('stays a valid proportion', () => {
    expect(adjustWinRate(0.01, 0.5)).toBe(0);
    expect(adjustWinRate(0.99, -0.5)).toBe(1);
  });

  it('leaves the rate untouched when there is no measured gap', () => {
    expect(adjustWinRate(0.4821, 0)).toBeCloseTo(0.4821, 10);
  });
});
