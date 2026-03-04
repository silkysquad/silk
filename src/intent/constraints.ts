import type { Constraint } from './types.js';
import { compareDecimals, parseDecimal, withinRelativeTolerance } from '../amount-utils.js';

const DEFAULT_TOLERANCE = 0.0001; // 0.01%

/**
 * Evaluate whether an actual value satisfies a constraint.
 *
 * - Plain value: exact match within tolerance (for numbers).
 * - Object with gte/lte/gt/lt: each specified bound is checked.
 */
export function evaluateConstraint(
  constraint: Constraint<number | string>,
  actual: number | string,
  tolerance: number = DEFAULT_TOLERANCE,
): boolean {
  const actualDecimal = parseDecimal(actual);
  const toleranceDecimal = parseDecimal(tolerance);
  if (!actualDecimal || !toleranceDecimal) {
    return false;
  }

  if (typeof constraint === 'number' || typeof constraint === 'string') {
    const expectedDecimal = parseDecimal(constraint);
    if (!expectedDecimal) return false;
    return withinRelativeTolerance(expectedDecimal, actualDecimal, toleranceDecimal);
  }

  if (constraint.gte !== undefined) {
    const minInclusive = parseDecimal(constraint.gte);
    if (!minInclusive || compareDecimals(actualDecimal, minInclusive) < 0) return false;
  }
  if (constraint.lte !== undefined) {
    const maxInclusive = parseDecimal(constraint.lte);
    if (!maxInclusive || compareDecimals(actualDecimal, maxInclusive) > 0) return false;
  }
  if (constraint.gt !== undefined) {
    const minExclusive = parseDecimal(constraint.gt);
    if (!minExclusive || compareDecimals(actualDecimal, minExclusive) <= 0) return false;
  }
  if (constraint.lt !== undefined) {
    const maxExclusive = parseDecimal(constraint.lt);
    if (!maxExclusive || compareDecimals(actualDecimal, maxExclusive) >= 0) return false;
  }

  return true;
}
