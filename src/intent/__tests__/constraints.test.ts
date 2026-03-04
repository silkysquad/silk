import { describe, it, expect } from 'vitest';
import { evaluateConstraint } from '../constraints.js';

describe('evaluateConstraint', () => {
  it('exact number match returns true', () => {
    expect(evaluateConstraint(100, 100)).toBe(true);
  });

  it('exact number mismatch returns false', () => {
    expect(evaluateConstraint(100, 200)).toBe(false);
  });

  it('exact match with default tolerance (0.01%)', () => {
    expect(evaluateConstraint(100, 100.005)).toBe(true);
  });

  it('exact match outside default tolerance', () => {
    expect(evaluateConstraint(100, 101)).toBe(false);
  });

  it('gte constraint passes when actual >= expected', () => {
    expect(evaluateConstraint({ gte: 100 }, 100)).toBe(true);
    expect(evaluateConstraint({ gte: 100 }, 150)).toBe(true);
  });

  it('gte constraint fails when actual < expected', () => {
    expect(evaluateConstraint({ gte: 100 }, 99)).toBe(false);
  });

  it('lte constraint passes when actual <= expected', () => {
    expect(evaluateConstraint({ lte: 100 }, 100)).toBe(true);
    expect(evaluateConstraint({ lte: 100 }, 50)).toBe(true);
  });

  it('lte constraint fails when actual > expected', () => {
    expect(evaluateConstraint({ lte: 100 }, 101)).toBe(false);
  });

  it('gt constraint passes when actual > expected', () => {
    expect(evaluateConstraint({ gt: 100 }, 101)).toBe(true);
  });

  it('gt constraint fails when actual <= expected', () => {
    expect(evaluateConstraint({ gt: 100 }, 100)).toBe(false);
  });

  it('lt constraint passes when actual < expected', () => {
    expect(evaluateConstraint({ lt: 100 }, 99)).toBe(true);
  });

  it('lt constraint fails when actual >= expected', () => {
    expect(evaluateConstraint({ lt: 100 }, 100)).toBe(false);
  });

  it('combined gte+lte (range) passes when within range', () => {
    expect(evaluateConstraint({ gte: 50, lte: 150 }, 100)).toBe(true);
  });

  it('combined gte+lte fails when outside range', () => {
    expect(evaluateConstraint({ gte: 50, lte: 150 }, 200)).toBe(false);
    expect(evaluateConstraint({ gte: 50, lte: 150 }, 10)).toBe(false);
  });

  it('exact match with zero uses exact comparison', () => {
    expect(evaluateConstraint(0, 0)).toBe(true);
    expect(evaluateConstraint(0, 0.001)).toBe(false);
  });

  it('custom tolerance overrides default', () => {
    expect(evaluateConstraint(100, 101, 0.02)).toBe(true);
    expect(evaluateConstraint(100, 101, 0.005)).toBe(false);
  });

  it('supports large decimal string comparisons precisely', () => {
    expect(evaluateConstraint('123456789012.345678', '123456789012.345678')).toBe(true);
    expect(evaluateConstraint('123456789012.345678', '123476789012.345678')).toBe(false);
  });
});
