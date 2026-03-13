# Silk SDK Usage Guide

This document describes how to use the implemented intent verification and transaction analysis features.

---

## Transaction Analysis (`analyzeTransaction`)

Analyze any Solana transaction to understand what it does:

```typescript
import { analyzeTransaction } from '@silkysquad/silk';

// Analyze a base64-encoded transaction
const analysis = await analyzeTransaction(txBase64, {
  connection, // optional - for token metadata enrichment
});

console.log(analysis.summary);
// "Transfer 100 USDC from AgXx...w1 to BobA...c2"

analysis.instructions.forEach((ix) => {
  console.log(`${ix.programName}: ${ix.type}`, ix.params);
});
```

---

## Intent Verification (`verifyIntent`)

Verify that a transaction matches an agent's original intent before signing:

```typescript
import { verifyIntent, parseChain } from '@silkysquad/silk';

// Define an intent
const intent = {
  chain: 'solana',
  signer: 'AgXx...w1',  // Required: the transaction signer
  action: 'transfer',
  from: 'AgXx...w1',
  to: 'BobA...c2',
  amount: '100',
  tokenSymbol: 'USDC',
};

// Verify the transaction matches the intent
const result = await verifyIntent(txBase64, intent);

if (result.matched && result.confidence === 'full') {
  console.log('Transaction verified! Safe to sign.');
} else {
  console.log('Verification failed:');
  result.discrepancies.forEach(d => console.log(`  - ${d}`));
}
```

---

## Intent Types

### Transfer

```typescript
const intent = {
  chain: 'solana',
  signer: 'AgXx...w1',
  action: 'transfer',
  from: 'AgXx...w1',
  to: 'BobA...c2',
  amount: '100',
  tokenSymbol: 'USDC',  // or use token: 'EPjFWdd5...'
};
```

### Swap (Solana - Jupiter)

```typescript
const intent = {
  chain: 'solana',
  signer: 'AgXx...w1',
  action: 'swap',
  from: 'AgXx...w1',
  tokenIn: { tokenSymbol: 'SOL' },
  tokenOut: { tokenSymbol: 'USDC' },
  amountIn: '1',
  amountOut: { gte: '100' },  // constraint: at least 100 USDC
  slippage: 100,  // basis points (1% = 100)
};
```

### Amount Constraints

```typescript
// Exact amount (with 0.01% tolerance)
amount: '100'

// At least
amount: { gte: '1000' }

// At most
amount: { lte: '500' }

// Range
amount: { gte: '100', lte: '200' }

// Strictly positive
amount: { gt: '0' }
```

### Strict Mode

When `strict: true`, any instruction not matching an intent action causes verification to fail:

```typescript
const intent = {
  chain: 'solana',
  strict: true,  // reject transactions with unexpected instructions
  signer: 'AgXx...w1',
  action: 'transfer',
  from: 'AgXx...w1',
  to: 'BobA...c2',
  amount: '100',
  tokenSymbol: 'USDC',
};
```

### Compound Intents (Multiple Actions)

```typescript
const intent = {
  chain: 'solana',
  signer: 'AgXx...w1',
  actions: [
    { action: 'transfer', from: 'AgXx...w1', to: 'BobA...c2', amount: '50', tokenSymbol: 'USDC' },
    { action: 'transfer', from: 'AgXx...w1', to: 'Carol...d3', amount: '25', tokenSymbol: 'USDC' },
  ],
};
```

### Custom (Unknown) Actions

Actions not in the known list (`transfer`, `swap`, `stake`, `lend`, `borrow`, `approve`, `withdraw`) get shallow verification:

```typescript
const intent = {
  chain: 'solana',
  signer: 'AgXx...w1',
  action: 'custom_instruction',  // unknown action
  from: 'AgXx...w1',
  // ... other fields
};

// Result will have:
// result.matched === false
// result.confidence === 'unverified'
```

---

## Program Specification

You can optionally specify the expected program address or name:

```typescript
const intent = {
  chain: 'solana',
  signer: 'AgXx...w1',
  action: 'transfer',
  from: 'AgXx...w1',
  to: 'BobA...c2',
  amount: '100',
  tokenSymbol: 'USDC',
  program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',  // SPL Token program
  // or programName: 'spl-token',
};
```

---

## Confidence Levels

| Confidence | Meaning |
|---|---|
| `full` | All intent fields were verified |
| `partial` | Some fields could not be verified (reserved) |
| `unverified` | Unknown action or unsupported chain — structural match only |

---

## Risk Flags

The analysis includes risk flags with severity levels:

```typescript
analysis.flags.forEach((flag) => {
  console.log(`[${flag.severity}] ${flag.code}: ${flag.message}`);
});
```

---

## Discrepancies

When verification fails, `result.discrepancies` contains human-readable reasons:

```typescript
const result = await verifyIntent(txBase64, intent);
// Example discrepancies:
// - "Field 'to' mismatch: expected BobA...c2, got Carol...d3"
// - "Field 'amount' mismatch: expected '100', got '50.5'"
// - "Expected a 'transfer' instruction but none was found"
```

---

## Design Deviations

The implementation deviates from the original design in the following ways:

1. **ExecutionRef Required**: The `signer` field is required in all intents (added `ExecutionRef` type). This was needed to verify the transaction signer matches the intent.

2. **ProgramRef Added**: Added `program` and `programName` fields to allow specifying expected program addresses or names for verification.

3. **Solana-Only Support**: Currently only Solana chain is fully implemented. Other EVM chains return `confidence: 'unverified'`.

4. **Action Mapping**: Added internal mapping from generic action names (`transfer`) to Solana-specific instruction types (`create_transfer`).

5. **Default Tolerance**: Exact amount matches use a 0.01% tolerance by default to accommodate rounding.

---

## Running Tests

```bash
cd silk
npm test
```
