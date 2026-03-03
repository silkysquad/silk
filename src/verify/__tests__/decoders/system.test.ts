import { describe, it, expect } from 'vitest';
import { decodeSystem } from '../../decoders/system.js';

describe('decodeSystem', () => {
  it('decodes a transfer instruction', () => {
    // System Program transfer: u32 LE index (2) + u64 LE lamports
    const data = Buffer.alloc(12);
    data.writeUInt32LE(2, 0); // Transfer index
    data.writeBigUInt64LE(1_000_000_000n, 4); // 1 SOL in lamports

    const accounts = ['SenderAddr11111111111111111111111111111111', 'RecipAddr1111111111111111111111111111111111'];
    const result = decodeSystem(data, accounts);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('transfer');
    expect(result!.params['from']).toBe(accounts[0]);
    expect(result!.params['to']).toBe(accounts[1]);
    expect(result!.params['lamports']).toBe('1000000000');
    expect(result!.params['sol']).toBe('1');
  });

  it('decodes a create_account instruction', () => {
    // u32 LE index (0) + u64 LE lamports + u64 LE space + 32-byte owner pubkey
    const data = Buffer.alloc(52);
    data.writeUInt32LE(0, 0); // CreateAccount index
    data.writeBigUInt64LE(2_039_280n, 4); // rent-exempt lamports
    data.writeBigUInt64LE(165n, 12); // space for token account
    // Write the SPL Token program ID as owner
    const splToken = Buffer.from('06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9', 'hex');
    splToken.copy(data, 20);

    const accounts = ['FunderAddr11111111111111111111111111111111', 'NewAcctAddr1111111111111111111111111111111'];
    const result = decodeSystem(data, accounts);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('create_account');
    expect(result!.params['from']).toBe(accounts[0]);
    expect(result!.params['newAccount']).toBe(accounts[1]);
    expect(result!.params['space']).toBe('165');
  });

  it('returns null for data too short', () => {
    const result = decodeSystem(Buffer.alloc(2), []);
    expect(result).toBeNull();
  });

  it('handles unknown system instruction index', () => {
    const data = Buffer.alloc(4);
    data.writeUInt32LE(99, 0);
    const result = decodeSystem(data, []);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('unknown_system_ix_99');
  });
});
