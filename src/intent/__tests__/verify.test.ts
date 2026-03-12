import { describe, it, expect } from 'vitest';
import {
  TransactionInstruction,
  PublicKey,
  Keypair,
} from '@solana/web3.js';
import { verifyIntent } from '../index.js';
import type { Intent } from '../types.js';
import { buildTxBase64, PROGRAMS, borshPubkey, borshU64, borshI64, borshString } from '../../verify/__tests__/helpers.js';

const ALICE = Keypair.generate();
const BOB = Keypair.generate();
const MINT_USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const DISC_CREATE_TRANSFER = [142, 232, 86, 212, 85, 158, 131, 190];

function buildHandshakeTransferTx(
  sender: Keypair,
  recipient: Keypair,
  amount: bigint,
  memo: string = '',
): string {
  const data = Buffer.concat([
    Buffer.from(DISC_CREATE_TRANSFER),
    borshPubkey(recipient.publicKey),
    borshU64(1n),
    borshU64(amount),
    borshString(memo),
    borshI64(0n),
    borshI64(0n),
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAMS.handshake,
    keys: [
      { pubkey: sender.publicKey, isSigner: true, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: MINT_USDC, isSigner: false, isWritable: false },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
    ],
    data,
  });

  return buildTxBase64([ix], sender.publicKey);
}

describe('verifyIntent (cross-chain API)', () => {
  it('verifies a matching transfer intent on solana', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);

    const intent: Intent = {
      chain: 'solana',
      signer: ALICE.publicKey.toBase58(),
      action: 'transfer',
      from: ALICE.publicKey.toBase58(),
      to: BOB.publicKey.toBase58(),
      amount: '100',
      tokenSymbol: 'USDC',
    };

    const result = await verifyIntent(txBase64, intent);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe('full');
    expect(result.discrepancies).toHaveLength(0);
  });

  it('detects sender mismatch', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);
    const wrong = Keypair.generate();

    const intent: Intent = {
      chain: 'solana',
      signer: wrong.publicKey.toBase58(),
      action: 'transfer',
      from: wrong.publicKey.toBase58(),
      to: BOB.publicKey.toBase58(),
      amount: '100',
    };

    const result = await verifyIntent(txBase64, intent);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('from'))).toBe(true);
  });

  it('detects amount mismatch', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);

    const intent: Intent = {
      chain: 'solana',
      signer: ALICE.publicKey.toBase58(),
      action: 'transfer',
      from: ALICE.publicKey.toBase58(),
      to: BOB.publicKey.toBase58(),
      amount: '200',
    };

    const result = await verifyIntent(txBase64, intent);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('amount'))).toBe(true);
  });

  it('chain field is required', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);

    const intent = {
      signer: ALICE.publicKey.toBase58(),
      action: 'transfer',
      from: ALICE.publicKey.toBase58(),
      to: BOB.publicKey.toBase58(),
      amount: '100',
    } as Intent;

    const result = await verifyIntent(txBase64, intent);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('chain'))).toBe(true);
  });

  it('strict mode fails when extra non-ancillary instructions exist', async () => {
    const unknownProgram = Keypair.generate().publicKey;
    const unknownIx = new TransactionInstruction({
      programId: unknownProgram,
      keys: [{ pubkey: ALICE.publicKey, isSigner: false, isWritable: false }],
      data: Buffer.alloc(8),
    });

    const handshakeData = Buffer.concat([
      Buffer.from(DISC_CREATE_TRANSFER),
      borshPubkey(BOB.publicKey),
      borshU64(1n),
      borshU64(100_000_000n),
      borshString(''),
      borshI64(0n),
      borshI64(0n),
    ]);
    const handshakeIx = new TransactionInstruction({
      programId: PROGRAMS.handshake,
      keys: [
        { pubkey: ALICE.publicKey, isSigner: true, isWritable: true },
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
        { pubkey: MINT_USDC, isSigner: false, isWritable: false },
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      ],
      data: handshakeData,
    });

    const txBase64 = buildTxBase64([unknownIx, handshakeIx], ALICE.publicKey);

    const intent: Intent = {
      chain: 'solana',
      signer: ALICE.publicKey.toBase58(),
      strict: true,
      action: 'transfer',
      from: ALICE.publicKey.toBase58(),
      to: BOB.publicKey.toBase58(),
      amount: '100',
    };

    const result = await verifyIntent(txBase64, intent);
    expect(result.matched).toBe(false);
  });

  it('matches when programName resolves to correct program', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);

    const intent: Intent = {
      chain: 'solana',
      signer: ALICE.publicKey.toBase58(),
      action: 'transfer',
      from: ALICE.publicKey.toBase58(),
      to: BOB.publicKey.toBase58(),
      amount: '100',
      programName: 'handshake',
    };

    const result = await verifyIntent(txBase64, intent);
    expect(result.matched).toBe(true);
  });

  it('fails when programName resolves to wrong program', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);

    const intent: Intent = {
      chain: 'solana',
      signer: ALICE.publicKey.toBase58(),
      action: 'transfer',
      from: ALICE.publicKey.toBase58(),
      to: BOB.publicKey.toBase58(),
      amount: '100',
      programName: 'silkysig',
    };

    const result = await verifyIntent(txBase64, intent);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('Expected program'))).toBe(true);
  });

  it('fails via cross-check when programName and program mismatch', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);

    const intent: Intent = {
      chain: 'solana',
      signer: ALICE.publicKey.toBase58(),
      action: 'transfer',
      from: ALICE.publicKey.toBase58(),
      to: BOB.publicKey.toBase58(),
      amount: '100',
      programName: 'handshake',
      program: 'SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS',
    };

    const result = await verifyIntent(txBase64, intent);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('cross-check'))).toBe(true);
  });

  it('non-strict mode ignores extra instructions', async () => {
    const unknownProgram = Keypair.generate().publicKey;
    const unknownIx = new TransactionInstruction({
      programId: unknownProgram,
      keys: [{ pubkey: ALICE.publicKey, isSigner: false, isWritable: false }],
      data: Buffer.alloc(8),
    });

    const handshakeData = Buffer.concat([
      Buffer.from(DISC_CREATE_TRANSFER),
      borshPubkey(BOB.publicKey),
      borshU64(1n),
      borshU64(100_000_000n),
      borshString(''),
      borshI64(0n),
      borshI64(0n),
    ]);
    const handshakeIx = new TransactionInstruction({
      programId: PROGRAMS.handshake,
      keys: [
        { pubkey: ALICE.publicKey, isSigner: true, isWritable: true },
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
        { pubkey: MINT_USDC, isSigner: false, isWritable: false },
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      ],
      data: handshakeData,
    });

    const txBase64 = buildTxBase64([unknownIx, handshakeIx], ALICE.publicKey);

    const intent: Intent = {
      chain: 'solana',
      signer: ALICE.publicKey.toBase58(),
      action: 'transfer',
      from: ALICE.publicKey.toBase58(),
      to: BOB.publicKey.toBase58(),
      amount: '100',
    };

    const result = await verifyIntent(txBase64, intent);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('unknown program'))).toBe(true);
  });
});
