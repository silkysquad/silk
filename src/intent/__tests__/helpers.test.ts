import { describe, it, expect } from 'vitest';
import { isSingleIntent, isCompoundIntent, getActions, getProgramRef, getExecutionRef } from '../helpers.js';
import type { Intent } from '../types.js';

describe('isSingleIntent', () => {
  it('returns true for single intent', () => {
    const intent: Intent = { chain: 'solana', signer: 'A', action: 'transfer', from: 'A', to: 'B', amount: '100' };
    expect(isSingleIntent(intent)).toBe(true);
  });

  it('returns false for compound intent', () => {
    const intent: Intent = { chain: 'solana', signer: 'A', actions: [{ action: 'transfer', from: 'A', to: 'B', amount: '100' }] };
    expect(isSingleIntent(intent)).toBe(false);
  });
});

describe('isCompoundIntent', () => {
  it('returns true for compound intent', () => {
    const intent: Intent = { chain: 'solana', signer: 'A', actions: [{ action: 'transfer', from: 'A', to: 'B', amount: '100' }] };
    expect(isCompoundIntent(intent)).toBe(true);
  });

  it('returns false for single intent', () => {
    const intent: Intent = { chain: 'solana', signer: 'A', action: 'transfer', from: 'A', to: 'B', amount: '100' };
    expect(isCompoundIntent(intent)).toBe(false);
  });
});

describe('getActions', () => {
  it('returns single action in array for single intent', () => {
    const intent: Intent = { chain: 'solana', signer: 'A', action: 'transfer', from: 'A', to: 'B', amount: '100' };
    const actions = getActions(intent);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('transfer');
  });

  it('returns all actions for compound intent', () => {
    const intent: Intent = {
      chain: 'solana',
      signer: 'A',
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

  it('strips non-action fields from single intent', () => {
    const intent: Intent = {
      chain: 'solana',
      signer: 'A',
      feePayer: 'Relayer',
      action: 'transfer',
      from: 'A',
      to: 'B',
      amount: '100',
      program: 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ',
      programName: 'handshake',
    };
    const actions = getActions(intent);
    expect(actions).toHaveLength(1);
    expect(actions[0]).not.toHaveProperty('chain');
    expect(actions[0]).not.toHaveProperty('strict');
    expect(actions[0]).not.toHaveProperty('program');
    expect(actions[0]).not.toHaveProperty('programName');
    expect(actions[0]).not.toHaveProperty('signer');
    expect(actions[0]).not.toHaveProperty('feePayer');
    expect(actions[0].action).toBe('transfer');
  });
});

describe('getProgramRef', () => {
  it('extracts program fields from single intent', () => {
    const intent: Intent = {
      chain: 'solana',
      signer: 'A',
      action: 'transfer',
      from: 'A',
      to: 'B',
      amount: '100',
      program: 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ',
      programName: 'handshake',
    };
    const ref = getProgramRef(intent);
    expect(ref.program).toBe('HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ');
    expect(ref.programName).toBe('handshake');
  });

  it('extracts program fields from compound intent', () => {
    const intent: Intent = {
      chain: 'solana',
      signer: 'A',
      actions: [{ action: 'transfer', from: 'A', to: 'B', amount: '100' }],
      program: 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ',
      programName: 'handshake',
    };
    const ref = getProgramRef(intent);
    expect(ref.program).toBe('HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ');
    expect(ref.programName).toBe('handshake');
  });

  it('returns undefined fields when no program info', () => {
    const intent: Intent = {
      chain: 'solana',
      signer: 'A',
      action: 'transfer',
      from: 'A',
      to: 'B',
      amount: '100',
    };
    const ref = getProgramRef(intent);
    expect(ref.program).toBeUndefined();
    expect(ref.programName).toBeUndefined();
  });
});

describe('getExecutionRef', () => {
  it('extracts signer from intent', () => {
    const intent: Intent = {
      chain: 'solana',
      signer: 'AgXxSigner',
      action: 'transfer',
      from: 'AgXxSigner',
      to: 'Bob',
      amount: '100',
    };
    const ref = getExecutionRef(intent);
    expect(ref.signer).toBe('AgXxSigner');
    expect(ref.feePayer).toBeUndefined();
  });

  it('extracts signer and feePayer when both present', () => {
    const intent: Intent = {
      chain: 'solana',
      signer: 'AgXxSigner',
      feePayer: 'RelayerPubkey',
      action: 'transfer',
      from: 'AgXxSigner',
      to: 'Bob',
      amount: '100',
    };
    const ref = getExecutionRef(intent);
    expect(ref.signer).toBe('AgXxSigner');
    expect(ref.feePayer).toBe('RelayerPubkey');
  });

  it('works with compound intents', () => {
    const intent: Intent = {
      chain: 'solana',
      signer: 'AgXxSigner',
      feePayer: 'RelayerPubkey',
      actions: [
        { action: 'transfer', from: 'AgXxSigner', to: 'Bob', amount: '100' },
      ],
    };
    const ref = getExecutionRef(intent);
    expect(ref.signer).toBe('AgXxSigner');
    expect(ref.feePayer).toBe('RelayerPubkey');
  });
});
