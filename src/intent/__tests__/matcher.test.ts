import { describe, it, expect } from 'vitest';
import { matchIntent } from '../matcher.js';
import type { ActionIntent } from '../types.js';
import type { InstructionAnalysis, RiskFlag } from '../../verify/index.js';

function makeIx(overrides: Partial<InstructionAnalysis>): InstructionAnalysis {
  return {
    index: 0,
    programId: 'test-program',
    programName: 'Test',
    type: null,
    known: true,
    params: {},
    flags: [],
    ...overrides,
  };
}

describe('matchIntent', () => {
  it('full confidence when known action and all fields match', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: '100',
      tokenSymbol: 'USDC',
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        params: { from: 'Alice', to: 'Bob', amount: '100000000', amountHuman: '100 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'solana', false);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe('full');
    expect(result.discrepancies).toHaveLength(0);
  });

  it('detects sender mismatch', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: '100',
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        params: { from: 'Charlie', to: 'Bob', amount: '100000000', amountHuman: '100 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'solana', false);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('from'))).toBe(true);
  });

  it('detects amount mismatch', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: '200',
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        params: { from: 'Alice', to: 'Bob', amount: '100000000', amountHuman: '100 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'solana', false);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('amount'))).toBe(true);
  });

  it('evaluates gte constraint on amount', () => {
    const actions: ActionIntent[] = [{
      action: 'swap',
      from: 'Alice',
      tokenIn: { tokenSymbol: 'ETH' },
      tokenOut: { tokenSymbol: 'USDC' },
      amountOut: { gte: '1000' },
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'swap',
        params: { from: 'Alice', amountOut: '1500000000', amountOutHuman: '1500 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'ethereum', false);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe('full');
  });

  it('gte constraint fails when below minimum', () => {
    const actions: ActionIntent[] = [{
      action: 'swap',
      from: 'Alice',
      tokenIn: { tokenSymbol: 'ETH' },
      tokenOut: { tokenSymbol: 'USDC' },
      amountOut: { gte: '1000' },
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'swap',
        params: { from: 'Alice', amountOut: '500000000', amountOutHuman: '500 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'ethereum', false);
    expect(result.matched).toBe(false);
  });

  it('returns unverified for unknown action', () => {
    const actions: ActionIntent[] = [{
      action: 'flashLoan',
      from: 'Alice',
      amount: '10000',
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'flashLoan',
        known: true,
        params: { from: 'Alice', amount: '10000' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'ethereum', false);
    expect(result.matched).toBe(false);
    expect(result.confidence).toBe('unverified');
  });

  it('fails when action not found in instructions', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: '100',
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({ type: 'swap', params: {} }),
    ];

    const result = matchIntent(actions, instructions, [], 'solana', false);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('transfer'))).toBe(true);
  });

  it('error-severity flags cause matched=false', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: '100',
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        params: { from: 'Alice', to: 'Bob', amountHuman: '100 USDC' },
      }),
    ];

    const flags: RiskFlag[] = [{
      severity: 'error',
      code: 'UNKNOWN_PROGRAM',
      message: 'Unknown program detected',
    }];

    const result = matchIntent(actions, instructions, flags, 'solana', false);
    expect(result.matched).toBe(false);
  });

  it('compound intent: matches all actions', () => {
    const actions: ActionIntent[] = [
      { action: 'withdraw', from: 'Alice', amount: '100' },
      { action: 'transfer', from: 'Alice', to: 'Bob', amount: '100' },
    ];

    const instructions: InstructionAnalysis[] = [
      makeIx({ type: 'withdraw', params: { from: 'Alice', amountHuman: '100 USDC' } }),
      makeIx({ index: 1, type: 'transfer', params: { from: 'Alice', to: 'Bob', amountHuman: '100 USDC' } }),
    ];

    const result = matchIntent(actions, instructions, [], 'ethereum', false);
    expect(result.matched).toBe(true);
  });

  it('compound intent: fails if any action missing', () => {
    const actions: ActionIntent[] = [
      { action: 'withdraw', from: 'Alice', amount: '100' },
      { action: 'transfer', from: 'Alice', to: 'Bob', amount: '100' },
    ];

    const instructions: InstructionAnalysis[] = [
      makeIx({ type: 'withdraw', params: { from: 'Alice', amountHuman: '100 USDC' } }),
    ];

    const result = matchIntent(actions, instructions, [], 'ethereum', false);
    expect(result.matched).toBe(false);
  });

  it('matches when expectedProgram equals instruction programId', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: '100',
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        programId: 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ',
        params: { from: 'Alice', to: 'Bob', amountHuman: '100 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'solana', false, 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ');
    expect(result.matched).toBe(true);
    expect(result.discrepancies).toHaveLength(0);
  });

  it('fails when expectedProgram mismatches instruction programId', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: '100',
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        programId: 'SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS',
        params: { from: 'Alice', to: 'Bob', amountHuman: '100 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'solana', false, 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ');
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('Expected program'))).toBe(true);
  });

  it('skips program check when expectedProgram omitted', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: '100',
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        programId: 'any-program',
        params: { from: 'Alice', to: 'Bob', amountHuman: '100 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'solana', false);
    expect(result.matched).toBe(true);
  });

  it('EVM addresses compared case-insensitively', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: '0xAbCdEf',
      to: '0x123456',
      amount: '100',
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        params: { from: '0xabcdef', to: '0x123456', amountHuman: '100 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'ethereum', false);
    expect(result.matched).toBe(true);
  });
});
