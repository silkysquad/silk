import { describe, it, expect } from 'vitest';
import { decodeComputeBudget } from '../../decoders/compute-budget.js';
import { decodeAta } from '../../decoders/ata.js';
import { decodeMemo } from '../../decoders/memo.js';

describe('decodeComputeBudget', () => {
  it('decodes set_compute_unit_limit (index 2)', () => {
    const data = Buffer.alloc(5);
    data[0] = 2;
    data.writeUInt32LE(200_000, 1);
    const result = decodeComputeBudget(data);
    expect(result.type).toBe('set_compute_unit_limit');
    expect(result.params['units']).toBe(200_000);
  });

  it('decodes set_compute_unit_price (index 3)', () => {
    const data = Buffer.alloc(9);
    data[0] = 3;
    data.writeBigUInt64LE(50_000n, 1);
    const result = decodeComputeBudget(data);
    expect(result.type).toBe('set_compute_unit_price');
    expect(result.params['microLamports']).toBe('50000');
  });

  it('handles empty data', () => {
    const result = decodeComputeBudget(Buffer.alloc(0));
    expect(result.type).toBe('unknown');
  });
});

describe('decodeAta', () => {
  it('decodes create (index 0)', () => {
    const data = Buffer.from([0]);
    const accounts = ['Funder', 'NewATA', 'WalletAddr', 'MintAddr'];
    const result = decodeAta(data, accounts);
    expect(result.type).toBe('create');
    expect(result.params['wallet']).toBe('WalletAddr');
    expect(result.params['mint']).toBe('MintAddr');
  });

  it('decodes create_idempotent (index 1)', () => {
    const data = Buffer.from([1]);
    const accounts = ['Funder', 'NewATA', 'WalletAddr', 'MintAddr'];
    const result = decodeAta(data, accounts);
    expect(result.type).toBe('create_idempotent');
  });

  it('treats empty data as create', () => {
    const result = decodeAta(Buffer.alloc(0), ['F', 'A', 'W', 'M']);
    expect(result.type).toBe('create');
  });
});

describe('decodeMemo', () => {
  it('decodes a UTF-8 memo', () => {
    const text = 'Payment for invoice #42';
    const result = decodeMemo(Buffer.from(text, 'utf-8'));
    expect(result.type).toBe('memo');
    expect(result.params['text']).toBe(text);
  });

  it('handles empty memo', () => {
    const result = decodeMemo(Buffer.alloc(0));
    expect(result.type).toBe('memo');
    expect(result.params['text']).toBe('');
  });
});
