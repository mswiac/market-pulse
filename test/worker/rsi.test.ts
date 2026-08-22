import { describe, expect, it } from 'vitest';
import { calculateRSI, calculateRSISeries } from '../../src/worker/lib/rsi';

// Reference values below were computed independently in Python (Wilder's RSI,
// seeded with the simple mean of the first `period` changes, then smoothed),
// not derived from this implementation's own output — see plan.md Phase 3.
const CLOSES_15 = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
];
const CLOSES_20 = [...CLOSES_15, 46.51, 46.03, 46.83, 47.69, 46.49];

describe('calculateRSI', () => {
  it('matches an independently-computed reference value at exactly 15 closes (seed-only path)', () => {
    expect(calculateRSI(CLOSES_15)).toBeCloseTo(70.46413502109705, 9);
  });

  it('matches an independently-computed reference value after extended smoothing (20 closes)', () => {
    expect(calculateRSI(CLOSES_20)).toBeCloseTo(60.85292037842048, 9);
  });

  it('returns null when fewer than period + 1 closes are provided', () => {
    expect(calculateRSI(CLOSES_15.slice(0, 14))).toBeNull();
  });

  it('returns 100 when average loss is zero (strictly increasing closes)', () => {
    const strictlyIncreasing = Array.from({ length: 16 }, (_, i) => i + 1);
    expect(calculateRSI(strictlyIncreasing)).toBe(100);
  });

  it('returns 0 when average gain is zero (strictly decreasing closes)', () => {
    const strictlyDecreasing = Array.from({ length: 16 }, (_, i) => 16 - i);
    expect(calculateRSI(strictlyDecreasing)).toBe(0);
  });
});

describe('calculateRSISeries', () => {
  it('returns an array the same length as the input closes', () => {
    expect(calculateRSISeries(CLOSES_20)).toHaveLength(CLOSES_20.length);
  });

  it('fills null for every index before period + 1 closes are available', () => {
    const series = calculateRSISeries(CLOSES_20);
    for (let i = 0; i < 14; i++) {
      expect(series[i]).toBeNull();
    }
  });

  it('matches calculateRSI at the seed-only index (14, exactly period + 1 closes)', () => {
    const series = calculateRSISeries(CLOSES_15);
    expect(series[14]).toBeCloseTo(calculateRSI(CLOSES_15)!, 9);
  });

  it('matches calculateRSI at the last index after extended smoothing (20 closes)', () => {
    const series = calculateRSISeries(CLOSES_20);
    expect(series[series.length - 1]).toBeCloseTo(calculateRSI(CLOSES_20)!, 9);
  });

  it('matches calculateRSI called on a truncated prefix, for an intermediate index', () => {
    // series[17] (18 closes) must equal calling calculateRSI on those same first 18 closes —
    // proves the running averages carried forward are equivalent to a fresh calculation up to that day.
    const prefix = CLOSES_20.slice(0, 18);
    const series = calculateRSISeries(CLOSES_20);
    expect(series[17]).toBeCloseTo(calculateRSI(prefix)!, 9);
  });

  it('returns an all-null array when fewer than period + 1 closes are provided', () => {
    const series = calculateRSISeries(CLOSES_15.slice(0, 14));
    expect(series).toEqual(new Array(14).fill(null));
  });
});
