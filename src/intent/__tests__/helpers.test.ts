import { describe, it, expect } from 'vitest';
import { isSingleIntent, isCompoundIntent, getActions } from '../helpers.js';
import type { Intent } from '../types.js';

describe('isSingleIntent', () => {
  it('returns true for single intent', () => {
    const intent: Intent = { chain: 'solana', action: 'transfer', from: 'A', to: 'B', amount: '100' };
    expect(isSingleIntent(intent)).toBe(true);
  });

  it('returns false for compound intent', () => {
    const intent: Intent = { chain: 'solana', actions: [{ action: 'transfer', from: 'A', to: 'B', amount: '100' }] };
    expect(isSingleIntent(intent)).toBe(false);
  });
});

describe('isCompoundIntent', () => {
  it('returns true for compound intent', () => {
    const intent: Intent = { chain: 'solana', actions: [{ action: 'transfer', from: 'A', to: 'B', amount: '100' }] };
    expect(isCompoundIntent(intent)).toBe(true);
  });

  it('returns false for single intent', () => {
    const intent: Intent = { chain: 'solana', action: 'transfer', from: 'A', to: 'B', amount: '100' };
    expect(isCompoundIntent(intent)).toBe(false);
  });
});

describe('getActions', () => {
  it('returns single action in array for single intent', () => {
    const intent: Intent = { chain: 'solana', action: 'transfer', from: 'A', to: 'B', amount: '100' };
    const actions = getActions(intent);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('transfer');
  });

  it('returns all actions for compound intent', () => {
    const intent: Intent = {
      chain: 'solana',
      actions: [
        { action: 'withdraw', from: 'A', amount: '100' },
        { action: 'transfer', from: 'A', to: 'B', amount: '100' },
      ],
    };
    const actions = getActions(intent);
    expect(actions).toHaveLength(2);
    expect(actions[0].action).toBe('withdraw');
    expect(actions[1].action).toBe('transfer');
  });
});
