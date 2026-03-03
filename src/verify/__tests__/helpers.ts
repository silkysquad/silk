import {
  Transaction,
  SystemProgram,
  PublicKey,
  TransactionInstruction,
  Keypair,
} from '@solana/web3.js';

// Deterministic keypairs for predictable test addresses
export const ALICE = Keypair.generate();
export const BOB = Keypair.generate();
export const OPERATOR = Keypair.generate();

// Known program IDs from the registry
export const PROGRAMS = {
  system: SystemProgram.programId,
  splToken: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  ata: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bC5'),
  computeBudget: new PublicKey('ComputeBudget111111111111111111111111111111'),
  memo: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
  handshake: new PublicKey('HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ'),
  silkysig: new PublicKey('SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS'),
  jupiter: new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'),
} as const;

// Known token mints from the registry
export const MINTS = {
  usdc: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  sol: new PublicKey('So11111111111111111111111111111111111111112'),
} as const;

/**
 * Build a legacy Solana transaction with the given instructions,
 * serialize it to base64. Uses ALICE as fee payer by default.
 * Does NOT sign — matches what the backend returns.
 */
export function buildTxBase64(
  instructions: TransactionInstruction[],
  feePayer: PublicKey = ALICE.publicKey,
): string {
  const tx = new Transaction();
  tx.feePayer = feePayer;
  // A real blockhash is needed for serialization but irrelevant for decoding
  tx.recentBlockhash = '11111111111111111111111111111111';
  tx.add(...instructions);
  // serialize without signing — requireAllSignatures=false
  const buf = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return buf.toString('base64');
}

/**
 * Build an Anchor-style instruction with an 8-byte discriminator prefix.
 */
export function anchorIx(
  programId: PublicKey,
  discriminator: number[],
  data: Buffer,
  keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[],
): TransactionInstruction {
  const disc = Buffer.from(discriminator);
  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.concat([disc, data]),
  });
}

/**
 * Encode a Borsh pubkey (32 bytes raw).
 */
export function borshPubkey(key: PublicKey): Buffer {
  return Buffer.from(key.toBytes());
}

/**
 * Encode a Borsh u64 (8 bytes LE).
 */
export function borshU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

/**
 * Encode a Borsh i64 (8 bytes LE).
 */
export function borshI64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(value);
  return buf;
}

/**
 * Encode a Borsh string (4-byte length prefix + UTF-8 bytes).
 */
export function borshString(str: string): Buffer {
  const strBuf = Buffer.from(str, 'utf-8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(strBuf.length);
  return Buffer.concat([lenBuf, strBuf]);
}
