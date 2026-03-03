import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { decodeHandshake } from '../../decoders/handshake.js';

const ALICE = Keypair.generate();
const BOB = Keypair.generate();
const POOL = Keypair.generate();
const MINT = Keypair.generate();
const TRANSFER_PDA = Keypair.generate();

const stubSymbol = () => 'USDC';
const stubDecimals = () => 6;

// Discriminators from handshake.ts source
const DISC = {
  create_transfer: [142, 232, 86, 212, 85, 158, 131, 190],
  claim_transfer:  [202, 178, 58, 190, 230, 234, 229, 17],
  cancel_transfer: [50, 32, 70, 130, 142, 41, 111, 175],
};

function borshPubkey(key: Keypair): Buffer {
  return Buffer.from(key.publicKey.toBytes());
}

function borshU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

function borshI64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(value);
  return buf;
}

function borshString(str: string): Buffer {
  const strBuf = Buffer.from(str, 'utf-8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(strBuf.length);
  return Buffer.concat([lenBuf, strBuf]);
}

describe('decodeHandshake', () => {
  it('decodes create_transfer with full args', () => {
    const data = Buffer.concat([
      Buffer.from(DISC.create_transfer),
      borshPubkey(BOB),           // recipient
      borshU64(1n),               // nonce
      borshU64(100_000_000n),     // amount: 100 USDC
      borshString('test memo'),   // memo
      borshI64(0n),               // claimableAfter (0 = null)
      borshI64(0n),               // claimableUntil (0 = null)
    ]);

    // Accounts: sender, pool, mint, pool_token, sender_token, transfer, token_program, system, ata
    const accounts = [
      ALICE.publicKey.toBase58(),
      POOL.publicKey.toBase58(),
      MINT.publicKey.toBase58(),
      'PoolTokenAcct', 'SenderTokenAcct', 'TransferPda',
      'TokenProgram', 'SystemProgram', 'AtaProgram',
    ];

    const result = decodeHandshake(data, accounts, stubSymbol, stubDecimals);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('create_transfer');
    expect(result!.params['sender']).toBe(ALICE.publicKey.toBase58());
    expect(result!.params['recipient']).toBe(BOB.publicKey.toBase58());
    expect(result!.params['amount']).toBe('100000000');
    expect(result!.params['amountHuman']).toBe('100 USDC');
    expect(result!.params['memo']).toBe('test memo');
  });

  it('decodes claim_transfer', () => {
    const data = Buffer.from(DISC.claim_transfer);
    const accounts = [
      BOB.publicKey.toBase58(),       // recipient
      POOL.publicKey.toBase58(),      // pool
      MINT.publicKey.toBase58(),      // mint
      'PoolToken', 'RecipToken',
      TRANSFER_PDA.publicKey.toBase58(), // transfer PDA
      ALICE.publicKey.toBase58(),     // sender
      'TokenProgram',
    ];

    const result = decodeHandshake(data, accounts, stubSymbol, stubDecimals);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('claim_transfer');
    expect(result!.params['claimer']).toBe(BOB.publicKey.toBase58());
    expect(result!.params['transferPda']).toBe(TRANSFER_PDA.publicKey.toBase58());
    expect(result!.params['sender']).toBe(ALICE.publicKey.toBase58());
  });

  it('decodes cancel_transfer', () => {
    const data = Buffer.from(DISC.cancel_transfer);
    const accounts = [
      ALICE.publicKey.toBase58(),     // sender
      POOL.publicKey.toBase58(),
      MINT.publicKey.toBase58(),
      'PoolToken', 'SenderToken',
      TRANSFER_PDA.publicKey.toBase58(), // transfer PDA
      'TokenProgram',
    ];

    const result = decodeHandshake(data, accounts, stubSymbol, stubDecimals);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('cancel_transfer');
    expect(result!.params['sender']).toBe(ALICE.publicKey.toBase58());
    expect(result!.params['transferPda']).toBe(TRANSFER_PDA.publicKey.toBase58());
  });

  it('returns null for unrecognized discriminator', () => {
    const data = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(decodeHandshake(data, [], stubSymbol, stubDecimals)).toBeNull();
  });

  it('returns null for data shorter than 8 bytes', () => {
    expect(decodeHandshake(Buffer.alloc(4), [], stubSymbol, stubDecimals)).toBeNull();
  });
});
