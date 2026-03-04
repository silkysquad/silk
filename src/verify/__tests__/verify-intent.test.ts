import { describe, it, expect } from 'vitest';
import {
  TransactionInstruction,
  PublicKey,
  Keypair,
} from '@solana/web3.js';
import { verifyIntent } from '../index.js';
import type { Intent } from '../index.js';
import { buildTxBase64, PROGRAMS, borshPubkey, borshU64, borshI64, borshString } from './helpers.js';

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
    borshU64(1n),           // nonce
    borshU64(amount),
    borshString(memo),
    borshI64(0n),           // claimableAfter
    borshI64(0n),           // claimableUntil
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

describe('verifyIntent', () => {
  it('fails when create_transfer omits token selector', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);

    const intent: Intent = {
      type: 'create_transfer',
      sender: ALICE.publicKey.toBase58(),
      recipient: BOB.publicKey.toBase58(),
      amount: '100',
    } as Intent;

    const result = await verifyIntent(txBase64, intent);

    expect(result.verified).toBe(false);
    expect(result.discrepancies.some((d) => d.includes("exactly one of 'token' or 'tokenAddress'"))).toBe(true);
  });

  it('verifies a matching create_transfer intent', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);

    const intent: Intent = {
      type: 'create_transfer',
      sender: ALICE.publicKey.toBase58(),
      recipient: BOB.publicKey.toBase58(),
      amount: '100',
      token: 'USDC',
    };

    const result = await verifyIntent(txBase64, intent);

    expect(result.verified).toBe(true);
    expect(result.discrepancies).toHaveLength(0);
    expect(result.analysis.instructions[0].type).toBe('create_transfer');
  });

  it('detects sender mismatch', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);
    const wrongSender = Keypair.generate();

    const intent: Intent = {
      type: 'create_transfer',
      sender: wrongSender.publicKey.toBase58(),
      recipient: BOB.publicKey.toBase58(),
      amount: '100',
      token: 'USDC',
    };

    const result = await verifyIntent(txBase64, intent);

    expect(result.verified).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('Sender mismatch'))).toBe(true);
  });

  it('detects recipient mismatch', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);
    const wrongRecipient = Keypair.generate();

    const intent: Intent = {
      type: 'create_transfer',
      sender: ALICE.publicKey.toBase58(),
      recipient: wrongRecipient.publicKey.toBase58(),
      amount: '100',
      token: 'USDC',
    };

    const result = await verifyIntent(txBase64, intent);

    expect(result.verified).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('Recipient mismatch'))).toBe(true);
  });

  it('detects amount mismatch', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n); // 100 USDC

    const intent: Intent = {
      type: 'create_transfer',
      sender: ALICE.publicKey.toBase58(),
      recipient: BOB.publicKey.toBase58(),
      amount: '200', // Expected 200, got 100
      token: 'USDC',
    };

    const result = await verifyIntent(txBase64, intent);

    expect(result.verified).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('Amount mismatch'))).toBe(true);
  });

  it('tolerates tiny amount differences within 0.01%', async () => {
    // 100.009 USDC = 100_009_000 raw — within 0.01% of 100.0
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_009_000n);

    const intent: Intent = {
      type: 'create_transfer',
      sender: ALICE.publicKey.toBase58(),
      recipient: BOB.publicKey.toBase58(),
      amount: '100',
      token: 'USDC',
    };

    const result = await verifyIntent(txBase64, intent);

    expect(result.verified).toBe(true);
    expect(result.discrepancies).toHaveLength(0);
  });

  it('handles large decimal amounts without floating-point precision loss', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 123_456_789_012_345_678n);

    const intent: Intent = {
      type: 'create_transfer',
      sender: ALICE.publicKey.toBase58(),
      recipient: BOB.publicKey.toBase58(),
      amount: '123456789012.345678',
      token: 'USDC',
    };

    const result = await verifyIntent(txBase64, intent);

    expect(result.verified).toBe(true);
    expect(result.discrepancies).toHaveLength(0);
  });

  it('detects memo mismatch when intent specifies memo', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n, 'wrong memo');

    const intent: Intent = {
      type: 'create_transfer',
      sender: ALICE.publicKey.toBase58(),
      recipient: BOB.publicKey.toBase58(),
      amount: '100',
      token: 'USDC',
      memo: 'expected memo',
    };

    const result = await verifyIntent(txBase64, intent);

    expect(result.verified).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('Memo mismatch'))).toBe(true);
  });

  it('fails when intent type not found in transaction', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);

    const intent: Intent = {
      type: 'claim_transfer',
      claimer: ALICE.publicKey.toBase58(),
      transferPda: Keypair.generate().publicKey.toBase58(),
    };

    const result = await verifyIntent(txBase64, intent);

    expect(result.verified).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('Expected a claim_transfer'))).toBe(true);
  });

  it('fails when transaction contains unknown program (error flag)', async () => {
    const unknownProgram = Keypair.generate().publicKey;
    const unknownIx = new TransactionInstruction({
      programId: unknownProgram,
      keys: [{ pubkey: ALICE.publicKey, isSigner: false, isWritable: false }],
      data: Buffer.alloc(8),
    });

    // Build a tx with both unknown program and a valid handshake transfer
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
      type: 'create_transfer',
      sender: ALICE.publicKey.toBase58(),
      recipient: BOB.publicKey.toBase58(),
      amount: '100',
      token: 'USDC',
    };

    const result = await verifyIntent(txBase64, intent);

    // Even though the create_transfer matches, the unknown program makes verified=false
    expect(result.verified).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('unknown program'))).toBe(true);
  });
});
