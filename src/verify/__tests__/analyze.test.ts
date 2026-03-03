import { describe, it, expect } from 'vitest';
import {
  SystemProgram,
  TransactionInstruction,
  PublicKey,
  Keypair,
} from '@solana/web3.js';
import { analyzeTransaction } from '../index.js';
import { buildTxBase64, PROGRAMS, borshPubkey, borshU64, borshI64, borshString } from './helpers.js';

const ALICE = Keypair.generate();
const BOB = Keypair.generate();

describe('analyzeTransaction', () => {
  it('analyzes a SOL transfer transaction', async () => {
    const ix = SystemProgram.transfer({
      fromPubkey: ALICE.publicKey,
      toPubkey: BOB.publicKey,
      lamports: 1_000_000_000,
    });
    const txBase64 = buildTxBase64([ix], ALICE.publicKey);

    const result = await analyzeTransaction(txBase64);

    expect(result.feePayer).toBe(ALICE.publicKey.toBase58());
    expect(result.instructions).toHaveLength(1);
    expect(result.instructions[0].type).toBe('transfer');
    expect(result.instructions[0].programName).toBe('System Program');
    expect(result.instructions[0].known).toBe(true);
    expect(result.instructions[0].params['sol']).toBe('1');
    expect(result.summary).toContain('transfers');
    expect(result.summary).toContain('SOL');
  });

  it('flags unknown programs as errors', async () => {
    const unknownProgram = Keypair.generate().publicKey;
    const ix = new TransactionInstruction({
      programId: unknownProgram,
      keys: [{ pubkey: ALICE.publicKey, isSigner: true, isWritable: true }],
      data: Buffer.alloc(8),
    });
    const txBase64 = buildTxBase64([ix], ALICE.publicKey);

    const result = await analyzeTransaction(txBase64);

    expect(result.instructions[0].known).toBe(false);
    const unknownFlag = result.flags.find((f) => f.code === 'UNKNOWN_PROGRAM');
    expect(unknownFlag).toBeDefined();
    expect(unknownFlag!.severity).toBe('error');
    expect(result.summary).toContain('ERROR');
  });

  it('handles multi-instruction transactions', async () => {
    const computeIx = new TransactionInstruction({
      programId: PROGRAMS.computeBudget,
      keys: [],
      data: Buffer.from([3, ...Buffer.alloc(8)]), // set_compute_unit_price = 0
    });
    const transferIx = SystemProgram.transfer({
      fromPubkey: ALICE.publicKey,
      toPubkey: BOB.publicKey,
      lamports: 500_000,
    });
    const txBase64 = buildTxBase64([computeIx, transferIx], ALICE.publicKey);

    const result = await analyzeTransaction(txBase64);

    expect(result.instructions).toHaveLength(2);
    expect(result.instructions[0].type).toBe('set_compute_unit_price');
    expect(result.instructions[1].type).toBe('transfer');
  });

  it('decodes a Handshake create_transfer instruction', async () => {
    const DISC_CREATE_TRANSFER = [142, 232, 86, 212, 85, 158, 131, 190];
    const MINT_USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    const pool = Keypair.generate();

    const data = Buffer.concat([
      Buffer.from(DISC_CREATE_TRANSFER),
      borshPubkey(BOB.publicKey),
      borshU64(1n),              // nonce
      borshU64(100_000_000n),    // 100 USDC
      borshString('test'),       // memo
      borshI64(0n),              // claimableAfter
      borshI64(0n),              // claimableUntil
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAMS.handshake,
      keys: [
        { pubkey: ALICE.publicKey, isSigner: true, isWritable: true },   // sender
        { pubkey: pool.publicKey, isSigner: false, isWritable: true },    // pool
        { pubkey: MINT_USDC, isSigner: false, isWritable: false },       // mint
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, // pool_token
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, // sender_token
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, // transfer PDA
      ],
      data,
    });
    const txBase64 = buildTxBase64([ix], ALICE.publicKey);

    const result = await analyzeTransaction(txBase64);

    expect(result.instructions[0].type).toBe('create_transfer');
    expect(result.instructions[0].params['amountHuman']).toBe('100 USDC');
    expect(result.instructions[0].params['memo']).toBe('test');
    expect(result.summary).toContain('Handshake transfer');
    expect(result.summary).toContain('100 USDC');
  });

  it('merges custom config overrides', async () => {
    const customProgram = Keypair.generate().publicKey;
    const ix = new TransactionInstruction({
      programId: customProgram,
      keys: [],
      data: Buffer.alloc(0),
    });
    const txBase64 = buildTxBase64([ix], ALICE.publicKey);

    // Without override: UNKNOWN_PROGRAM error
    const before = await analyzeTransaction(txBase64);
    expect(before.flags.some((f) => f.code === 'UNKNOWN_PROGRAM')).toBe(true);

    // With override: no UNKNOWN_PROGRAM error
    const after = await analyzeTransaction(txBase64, {
      config: {
        programs: {
          [customProgram.toBase58()]: { name: 'Custom', decoder: 'memo' },
        },
      },
    });
    expect(after.flags.some((f) => f.code === 'UNKNOWN_PROGRAM')).toBe(false);
    expect(after.instructions[0].programName).toBe('Custom');
  });
});
