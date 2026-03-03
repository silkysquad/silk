import { describe, it, expect } from 'vitest';
import { decodeSplToken } from '../../decoders/spl-token.js';

const stubSymbol = (mint: string) => mint === 'USDCMint' ? 'USDC' : 'UNKNOWN';

describe('decodeSplToken', () => {
  it('decodes a transfer instruction (index 3)', () => {
    const data = Buffer.alloc(9);
    data[0] = 3; // Transfer
    data.writeBigUInt64LE(100_000_000n, 1); // 100 USDC raw (but no decimals in basic transfer)

    const accounts = ['SourceATA', 'DestATA', 'AuthorityAddr'];
    const result = decodeSplToken(data, accounts, stubSymbol);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('transfer');
    expect(result!.params['source']).toBe('SourceATA');
    expect(result!.params['destination']).toBe('DestATA');
    expect(result!.params['authority']).toBe('AuthorityAddr');
    expect(result!.params['amount']).toBe('100000000');
  });

  it('decodes a transfer_checked instruction (index 12)', () => {
    const data = Buffer.alloc(10);
    data[0] = 12; // TransferChecked
    data.writeBigUInt64LE(100_000_000n, 1); // 100 USDC (6 decimals)
    data[9] = 6; // decimals

    const accounts = ['SourceATA', 'USDCMint', 'DestATA', 'AuthorityAddr'];
    const result = decodeSplToken(data, accounts, stubSymbol);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('transfer_checked');
    expect(result!.params['mint']).toBe('USDCMint');
    expect(result!.params['amount']).toBe('100000000');
    expect(result!.params['amountHuman']).toBe('100 USDC');
    expect(result!.params['decimals']).toBe(6);
  });

  it('decodes close_account instruction (index 9)', () => {
    const data = Buffer.from([9]);
    const accounts = ['AccountAddr', 'DestAddr', 'AuthAddr'];
    const result = decodeSplToken(data, accounts, stubSymbol);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('close_account');
    expect(result!.params['account']).toBe('AccountAddr');
  });

  it('returns null for empty data', () => {
    expect(decodeSplToken(Buffer.alloc(0), [], stubSymbol)).toBeNull();
  });
});
