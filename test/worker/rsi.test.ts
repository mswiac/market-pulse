import { describe, expect, it } from 'vitest';
import { calculateRSI } from '../../src/worker/lib/rsi';

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
});
