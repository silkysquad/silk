import { describe, it, expect } from 'vitest';
import { applyGlobalFlags, applyTokenTransferFlags } from '../flags.js';
import type { InstructionAnalysis } from '../index.js';

function makeIx(overrides: Partial<InstructionAnalysis>): InstructionAnalysis {
  return {
    index: 0,
    programId: '11111111111111111111111111111111',
    programName: 'System Program',
    type: null,
    known: true,
    params: {},
    flags: [],
    ...overrides,
  };
}

describe('applyGlobalFlags', () => {
  it('flags UNKNOWN_PROGRAM for unregistered programs', () => {
    const ix = makeIx({
      programId: 'UnknownProgram1111111111111111111111111111',
      programName: null,
      known: false,
    });

    const flags = applyGlobalFlags([ix], 'FeePayer', new Set());

    expect(flags).toHaveLength(1);
    expect(flags[0].code).toBe('UNKNOWN_PROGRAM');
    expect(flags[0].severity).toBe('error');
    expect(flags[0].instructionIndex).toBe(0);
  });

  it('flags UNEXPECTED_SOL_DRAIN for transfer to unrecognized address', () => {
    const ix = makeIx({
      type: 'transfer',
      params: { from: 'FeePayer', to: 'DrainAddress11111111111111111111111111111' },
    });

    const flags = applyGlobalFlags([ix], 'FeePayer', new Set(['FeePayer']));

    const drain = flags.find((f) => f.code === 'UNEXPECTED_SOL_DRAIN');
    expect(drain).toBeDefined();
    expect(drain!.severity).toBe('error');
  });

  it('does NOT flag SOL transfer to fee payer', () => {
    const ix = makeIx({
      type: 'transfer',
      params: { from: 'Someone', to: 'FeePayer' },
    });

    const flags = applyGlobalFlags([ix], 'FeePayer', new Set(['Someone', 'FeePayer']));
    const drain = flags.find((f) => f.code === 'UNEXPECTED_SOL_DRAIN');
    expect(drain).toBeUndefined();
  });

  it('does NOT flag SOL transfer to a known program', () => {
    const ix = makeIx({
      type: 'transfer',
      params: { from: 'FeePayer', to: 'SysvarRent111111111111111111111111111111111' },
    });

    const flags = applyGlobalFlags([ix], 'FeePayer', new Set(['FeePayer']));
    const drain = flags.find((f) => f.code === 'UNEXPECTED_SOL_DRAIN');
    expect(drain).toBeUndefined();
  });

  it('flags LARGE_COMPUTE_BUDGET for priority fee', () => {
    const ix = makeIx({
      programId: 'ComputeBudget111111111111111111111111111111',
      programName: 'Compute Budget',
      type: 'set_compute_unit_price',
      params: { microLamports: '50000' },
    });

    const flags = applyGlobalFlags([ix], 'FeePayer', new Set());

    const info = flags.find((f) => f.code === 'LARGE_COMPUTE_BUDGET');
    expect(info).toBeDefined();
    expect(info!.severity).toBe('info');
  });

  it('does not flag known programs', () => {
    const ix = makeIx({ known: true, type: 'transfer', params: {} });
    const flags = applyGlobalFlags([ix], 'FeePayer', new Set());
    const unknown = flags.find((f) => f.code === 'UNKNOWN_PROGRAM');
    expect(unknown).toBeUndefined();
  });
});

describe('applyTokenTransferFlags', () => {
  it('flags UNEXPECTED_TOKEN_TRANSFER for destination not in intent', () => {
    const ix = makeIx({
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      type: 'transfer_checked',
      params: { destination: 'SurpriseAddr' },
    });

    const intentAddresses = new Set(['ExpectedAddr']);
    const flags = applyTokenTransferFlags([ix], intentAddresses);

    expect(flags).toHaveLength(1);
    expect(flags[0].code).toBe('UNEXPECTED_TOKEN_TRANSFER');
    expect(flags[0].severity).toBe('warning');
  });

  it('does NOT flag when destination is in intent addresses', () => {
    const ix = makeIx({
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      type: 'transfer_checked',
      params: { destination: 'ExpectedAddr' },
    });

    const flags = applyTokenTransferFlags([ix], new Set(['ExpectedAddr']));
    expect(flags).toHaveLength(0);
  });

  it('does NOT flag when intent addresses is empty', () => {
    const ix = makeIx({
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      type: 'transfer',
      params: { destination: 'SomeAddr' },
    });

    const flags = applyTokenTransferFlags([ix], new Set());
    expect(flags).toHaveLength(0);
  });
});
