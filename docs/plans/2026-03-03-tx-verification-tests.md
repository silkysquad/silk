# Transaction Verification Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add comprehensive test coverage for the existing `src/verify/` transaction verification module, which currently has zero tests and no test framework.

**Architecture:** Install Vitest as the test runner (fast, ESM-native, zero-config for TypeScript). Build test transactions by hand using `@solana/web3.js` primitives — no mocking of deserialization. Each decoder, the flag engine, the token cache, and both entry points (`analyzeTransaction`, `verifyIntent`) get their own test file. Tests construct real Solana transactions (unsigned, serialized to base64) and feed them through the pipeline.

**Tech Stack:** Vitest, `@solana/web3.js` (already a dependency), `@solana/spl-token` (dev dependency for building SPL instructions in tests)

---

### Task 1: Install Vitest and configure test infrastructure

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`

**Step 1: Install Vitest**

Run: `npm install --save-dev vitest`

**Step 2: Add test script to package.json**

Replace the `"test"` script in `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 3: Verify Vitest runs**

Run: `npx vitest run`
Expected: "No test files found" (no error — proves the runner works)

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest test runner"
```

---

### Task 2: Create test helpers for building Solana transactions

**Files:**
- Create: `src/verify/__tests__/helpers.ts`

**Step 1: Write the helper module**

This module provides functions to build real unsigned Solana transactions serialized to base64. Every subsequent test file imports from here. No mocks — these are real transactions that `@solana/web3.js` can deserialize.

```typescript
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
```

**Step 2: Verify the helpers compile**

Run: `npx tsc --noEmit src/verify/__tests__/helpers.ts`
Expected: No errors. (If this fails due to tsconfig `rootDir`, run `npx vitest run` instead — Vitest handles TS natively.)

**Step 3: Commit**

```bash
git add src/verify/__tests__/helpers.ts
git commit -m "test: add transaction builder helpers for verify tests"
```

---

### Task 3: Test the System Program decoder

**Files:**
- Create: `src/verify/__tests__/decoders/system.test.ts`
- Reference: `src/verify/decoders/system.ts`

**Step 1: Write the failing tests**

```typescript
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
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/verify/__tests__/decoders/system.test.ts`
Expected: All 4 tests PASS (code already exists, we're adding test coverage)

**Step 3: Commit**

```bash
git add src/verify/__tests__/decoders/system.test.ts
git commit -m "test: add System Program decoder tests"
```

---

### Task 4: Test the SPL Token decoder

**Files:**
- Create: `src/verify/__tests__/decoders/spl-token.test.ts`
- Reference: `src/verify/decoders/spl-token.ts`

**Step 1: Write the tests**

```typescript
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
```

**Step 2: Run tests**

Run: `npx vitest run src/verify/__tests__/decoders/spl-token.test.ts`
Expected: All 4 tests PASS

**Step 3: Commit**

```bash
git add src/verify/__tests__/decoders/spl-token.test.ts
git commit -m "test: add SPL Token decoder tests"
```

---

### Task 5: Test the Compute Budget, ATA, and Memo decoders

**Files:**
- Create: `src/verify/__tests__/decoders/small-decoders.test.ts`
- Reference: `src/verify/decoders/compute-budget.ts`, `src/verify/decoders/ata.ts`, `src/verify/decoders/memo.ts`

**Step 1: Write the tests**

```typescript
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
```

**Step 2: Run tests**

Run: `npx vitest run src/verify/__tests__/decoders/small-decoders.test.ts`
Expected: All 8 tests PASS

**Step 3: Commit**

```bash
git add src/verify/__tests__/decoders/small-decoders.test.ts
git commit -m "test: add Compute Budget, ATA, and Memo decoder tests"
```

---

### Task 6: Test the Handshake decoder

**Files:**
- Create: `src/verify/__tests__/decoders/handshake.test.ts`
- Reference: `src/verify/decoders/handshake.ts`

The Handshake decoder uses Anchor-style discriminators and Borsh encoding. Tests construct raw instruction data by hand using the precomputed discriminators from the source.

**Step 1: Write the tests**

```typescript
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
```

**Step 2: Run tests**

Run: `npx vitest run src/verify/__tests__/decoders/handshake.test.ts`
Expected: All 5 tests PASS

**Step 3: Commit**

```bash
git add src/verify/__tests__/decoders/handshake.test.ts
git commit -m "test: add Handshake decoder tests"
```

---

### Task 7: Test the Silkysig decoder

**Files:**
- Create: `src/verify/__tests__/decoders/silkysig.test.ts`
- Reference: `src/verify/decoders/silkysig.ts`

**Step 1: Write the tests**

```typescript
import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { decodeSilkysig } from '../../decoders/silkysig.js';

const ALICE = Keypair.generate();
const BOB = Keypair.generate();
const SILK_ACCOUNT = Keypair.generate();
const MINT = Keypair.generate();

const stubSymbol = () => 'USDC';
const stubDecimals = () => 6;

// Discriminators from silkysig.ts source
const DISC = {
  create_account:        [99, 20, 130, 119, 196, 235, 131, 149],
  deposit:               [242, 35, 198, 137, 82, 225, 242, 182],
  transfer_from_account: [9, 168, 230, 150, 118, 31, 189, 73],
  add_operator:          [149, 142, 187, 68, 33, 250, 87, 105],
  toggle_pause:          [238, 237, 206, 27, 255, 95, 123, 229],
};

function borshU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

function borshPubkey(key: Keypair): Buffer {
  return Buffer.from(key.publicKey.toBytes());
}

describe('decodeSilkysig', () => {
  it('decodes create_account', () => {
    const data = Buffer.from(DISC.create_account);
    const accounts = [
      ALICE.publicKey.toBase58(),
      MINT.publicKey.toBase58(),
      SILK_ACCOUNT.publicKey.toBase58(),
    ];

    const result = decodeSilkysig(data, accounts, stubSymbol, stubDecimals);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('create_account');
    expect(result!.params['owner']).toBe(ALICE.publicKey.toBase58());
    expect(result!.params['mint']).toBe(MINT.publicKey.toBase58());
    expect(result!.params['silkAccount']).toBe(SILK_ACCOUNT.publicKey.toBase58());
  });

  it('decodes deposit with amount', () => {
    const data = Buffer.concat([
      Buffer.from(DISC.deposit),
      borshU64(50_000_000n), // 50 USDC
    ]);
    const accounts = [
      ALICE.publicKey.toBase58(),        // depositor
      SILK_ACCOUNT.publicKey.toBase58(), // silk_account
      MINT.publicKey.toBase58(),         // mint
      'AccountToken', 'DepositorToken', 'TokenProgram',
    ];

    const result = decodeSilkysig(data, accounts, stubSymbol, stubDecimals);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('deposit');
    expect(result!.params['depositor']).toBe(ALICE.publicKey.toBase58());
    expect(result!.params['amount']).toBe('50000000');
    expect(result!.params['amountHuman']).toBe('50 USDC');
  });

  it('decodes transfer_from_account', () => {
    const data = Buffer.concat([
      Buffer.from(DISC.transfer_from_account),
      borshU64(25_000_000n), // 25 USDC
    ]);
    const accounts = [
      ALICE.publicKey.toBase58(),        // signer
      SILK_ACCOUNT.publicKey.toBase58(), // silk_account
      MINT.publicKey.toBase58(),         // mint
      'AccountToken',
      BOB.publicKey.toBase58(),          // recipient
      'RecipientToken', 'TokenProgram',
    ];

    const result = decodeSilkysig(data, accounts, stubSymbol, stubDecimals);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('transfer_from_account');
    expect(result!.params['signer']).toBe(ALICE.publicKey.toBase58());
    expect(result!.params['recipient']).toBe(BOB.publicKey.toBase58());
    expect(result!.params['amount']).toBe('25000000');
    expect(result!.params['amountHuman']).toBe('25 USDC');
  });

  it('decodes toggle_pause', () => {
    const data = Buffer.from(DISC.toggle_pause);
    const accounts = [
      ALICE.publicKey.toBase58(),
      SILK_ACCOUNT.publicKey.toBase58(),
    ];

    const result = decodeSilkysig(data, accounts, stubSymbol, stubDecimals);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('toggle_pause');
    expect(result!.params['owner']).toBe(ALICE.publicKey.toBase58());
  });

  it('returns null for unrecognized discriminator', () => {
    expect(decodeSilkysig(Buffer.alloc(8), [], stubSymbol, stubDecimals)).toBeNull();
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/verify/__tests__/decoders/silkysig.test.ts`
Expected: All 5 tests PASS

**Step 3: Commit**

```bash
git add src/verify/__tests__/decoders/silkysig.test.ts
git commit -m "test: add Silkysig decoder tests"
```

---

### Task 8: Test the Jupiter decoder

**Files:**
- Create: `src/verify/__tests__/decoders/jupiter.test.ts`
- Reference: `src/verify/decoders/jupiter.ts`

**Step 1: Write the tests**

```typescript
import { describe, it, expect } from 'vitest';
import { decodeJupiter } from '../../decoders/jupiter.js';

// Known Jupiter discriminator hex strings from source
const DISC_ROUTE = 'e517cb977ae3ad2a';
const DISC_SHARED = '9279c41c15427612';

describe('decodeJupiter', () => {
  it('identifies a route instruction', () => {
    const data = Buffer.from(DISC_ROUTE + '00'.repeat(32), 'hex');
    const accounts = ['TokenProg', 'Authority', 'SourceATA', 'DestATA'];

    const result = decodeJupiter(data, accounts);

    expect(result.type).toBe('route');
    expect(result.params['sourceTokenAccount']).toBe('SourceATA');
    expect(result.params['destinationTokenAccount']).toBe('DestATA');
  });

  it('identifies a shared_accounts_route instruction', () => {
    const data = Buffer.from(DISC_SHARED + '00'.repeat(32), 'hex');
    const accounts = ['TokenProg', 'Authority', 'Source', 'Dest'];

    const result = decodeJupiter(data, accounts);
    expect(result.type).toBe('shared_accounts_route');
  });

  it('returns unknown for unrecognized discriminator', () => {
    const data = Buffer.from('0000000000000000', 'hex');
    const result = decodeJupiter(data, []);
    expect(result.type).toBe('unknown_jupiter_instruction');
  });

  it('returns unknown for data shorter than 8 bytes', () => {
    const result = decodeJupiter(Buffer.alloc(4), []);
    expect(result.type).toBe('unknown_jupiter_instruction');
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/verify/__tests__/decoders/jupiter.test.ts`
Expected: All 4 tests PASS

**Step 3: Commit**

```bash
git add src/verify/__tests__/decoders/jupiter.test.ts
git commit -m "test: add Jupiter decoder tests"
```

---

### Task 9: Test the flag engine

**Files:**
- Create: `src/verify/__tests__/flags.test.ts`
- Reference: `src/verify/flags.ts`

**Step 1: Write the tests**

```typescript
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
```

**Step 2: Run tests**

Run: `npx vitest run src/verify/__tests__/flags.test.ts`
Expected: All 8 tests PASS

**Step 3: Commit**

```bash
git add src/verify/__tests__/flags.test.ts
git commit -m "test: add flag engine tests"
```

---

### Task 10: Test the token cache (RPC layer)

**Files:**
- Create: `src/verify/__tests__/rpc.test.ts`
- Reference: `src/verify/rpc.ts`

**Step 1: Write the tests**

Tests cover the synchronous path (registry lookup, fallback symbol). RPC prefetch is not tested here — it requires a real or mocked `Connection` which adds complexity for little value in unit tests.

```typescript
import { describe, it, expect } from 'vitest';
import { createTokenCache } from '../rpc.js';

const REGISTRY_TOKENS = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6 },
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9 },
};

describe('createTokenCache', () => {
  it('returns registry symbol for known mint', () => {
    const cache = createTokenCache(REGISTRY_TOKENS);
    expect(cache.getSymbol('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe('USDC');
  });

  it('returns registry decimals for known mint', () => {
    const cache = createTokenCache(REGISTRY_TOKENS);
    expect(cache.getDecimals('So11111111111111111111111111111111111111112')).toBe(9);
  });

  it('returns shortened address for unknown mint symbol', () => {
    const cache = createTokenCache(REGISTRY_TOKENS);
    const unknown = 'AbCdEfGhIjKlMnOpQrStUvWxYz123456789ABCDEFGH';
    const symbol = cache.getSymbol(unknown);
    expect(symbol).toBe('AbCd..EFGH');
  });

  it('returns default 6 decimals for unknown mint', () => {
    const cache = createTokenCache(REGISTRY_TOKENS);
    expect(cache.getDecimals('UnknownMint1111111111111111111111111111111')).toBe(6);
  });

  it('prefetch is a no-op without connection', async () => {
    const cache = createTokenCache(REGISTRY_TOKENS);
    // Should not throw
    await cache.prefetch(['SomeRandomMint11111111111111111111111111111']);
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/verify/__tests__/rpc.test.ts`
Expected: All 5 tests PASS

**Step 3: Commit**

```bash
git add src/verify/__tests__/rpc.test.ts
git commit -m "test: add token cache tests"
```

---

### Task 11: Test the registry loader

**Files:**
- Create: `src/verify/__tests__/registry.test.ts`
- Reference: `src/verify/registry.ts`

**Step 1: Write the tests**

```typescript
import { describe, it, expect } from 'vitest';
import { REGISTRY } from '../registry.js';

describe('REGISTRY', () => {
  it('has all expected programs', () => {
    const keys = Object.keys(REGISTRY.programs);
    expect(keys).toContain('11111111111111111111111111111111');
    expect(keys).toContain('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    expect(keys).toContain('HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ');
    expect(keys).toContain('SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS');
    expect(keys).toContain('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
  });

  it('has USDC in token registry with 6 decimals', () => {
    const usdc = REGISTRY.tokens['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'];
    expect(usdc).toBeDefined();
    expect(usdc.symbol).toBe('USDC');
    expect(usdc.decimals).toBe(6);
  });

  it('each program has name and decoder fields', () => {
    for (const [id, entry] of Object.entries(REGISTRY.programs)) {
      expect(entry.name, `program ${id} missing name`).toBeTruthy();
      expect(entry.decoder, `program ${id} missing decoder`).toBeTruthy();
    }
  });

  it('each token has symbol and decimals fields', () => {
    for (const [mint, entry] of Object.entries(REGISTRY.tokens)) {
      expect(entry.symbol, `token ${mint} missing symbol`).toBeTruthy();
      expect(typeof entry.decimals, `token ${mint} decimals should be number`).toBe('number');
    }
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/verify/__tests__/registry.test.ts`
Expected: All 4 tests PASS

**Step 3: Commit**

```bash
git add src/verify/__tests__/registry.test.ts
git commit -m "test: add registry tests"
```

---

### Task 12: Test analyzeTransaction end-to-end

**Files:**
- Create: `src/verify/__tests__/analyze.test.ts`
- Reference: `src/verify/index.ts`, `src/verify/__tests__/helpers.ts`

These tests build real Solana transactions, serialize them, and run them through the full pipeline.

**Step 1: Write the tests**

```typescript
import { describe, it, expect } from 'vitest';
import {
  SystemProgram,
  TransactionInstruction,
  PublicKey,
  Keypair,
} from '@solana/web3.js';
import { analyzeTransaction } from '../index.js';
import { buildTxBase64, PROGRAMS, anchorIx, borshPubkey, borshU64, borshI64, borshString } from './helpers.js';

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

    const ix = anchorIx(
      PROGRAMS.handshake,
      [], // discriminator already in data
      data,
      [
        { pubkey: ALICE.publicKey, isSigner: true, isWritable: true },   // sender
        { pubkey: pool.publicKey, isSigner: false, isWritable: true },    // pool
        { pubkey: MINT_USDC, isSigner: false, isWritable: false },       // mint
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, // pool_token
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, // sender_token
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, // transfer PDA
      ],
    );

    // anchorIx prepends an empty discriminator — override with raw data
    const rawIx = new TransactionInstruction({
      programId: PROGRAMS.handshake,
      keys: ix.keys,
      data,
    });
    const txBase64 = buildTxBase64([rawIx], ALICE.publicKey);

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
```

**Step 2: Run tests**

Run: `npx vitest run src/verify/__tests__/analyze.test.ts`
Expected: All 5 tests PASS

**Step 3: Commit**

```bash
git add src/verify/__tests__/analyze.test.ts
git commit -m "test: add analyzeTransaction end-to-end tests"
```

---

### Task 13: Test verifyIntent end-to-end

**Files:**
- Create: `src/verify/__tests__/verify-intent.test.ts`
- Reference: `src/verify/index.ts`, `src/verify/__tests__/helpers.ts`

**Step 1: Write the tests**

```typescript
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
  it('verifies a matching create_transfer intent', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);

    const intent: Intent = {
      type: 'create_transfer',
      sender: ALICE.publicKey.toBase58(),
      recipient: BOB.publicKey.toBase58(),
      amount: 100,
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
      amount: 100,
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
      amount: 100,
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
      amount: 200, // Expected 200, got 100
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
      amount: 100,
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
      amount: 100,
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
      amount: 100,
    };

    const result = await verifyIntent(txBase64, intent);

    // Even though the create_transfer matches, the unknown program makes verified=false
    expect(result.verified).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('unknown program'))).toBe(true);
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/verify/__tests__/verify-intent.test.ts`
Expected: All 8 tests PASS

**Step 3: Commit**

```bash
git add src/verify/__tests__/verify-intent.test.ts
git commit -m "test: add verifyIntent end-to-end tests"
```

---

### Task 14: Run full test suite and commit the verify module

**Step 1: Run the complete test suite**

Run: `npx vitest run`
Expected: All tests pass (approximately 47 tests across 10 files)

**Step 2: Verify the build still works**

Run: `npm run build`
Expected: Clean compilation with no errors

**Step 3: Stage and commit the verify module source**

The `src/verify/` directory has been untracked. Now that it has tests, commit it.

```bash
git add src/verify/ src/index.ts
git commit -m "feat: add transaction verification module with full test coverage

Trustless client-side transaction verification for AI agents:
- Deserialization of legacy and versioned Solana transactions
- Decoders for System, SPL Token, ATA, Compute Budget, Memo,
  Handshake, Silkysig, and Jupiter programs
- Risk flag engine (UNKNOWN_PROGRAM, UNEXPECTED_SOL_DRAIN, etc.)
- analyzeTransaction() for general-purpose transaction audit
- verifyIntent() for intent-matching verification
- Token cache with RPC enrichment for unknown mints"
```

**Step 4: Run tests one final time to confirm clean state**

Run: `npx vitest run`
Expected: All tests PASS, no warnings
