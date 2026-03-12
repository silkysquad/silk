# Cross-Chain Intent Framework

The intent framework is a chain-agnostic system for expressing what an agent wants a transaction to do, then verifying that a given transaction accomplishes it. It lives in `src/intent/` and operates alongside the existing Solana-specific `src/verify/` module.

An intent is the source of truth for a desired action. It can drive two processes:

- **Verification** — does this transaction match my intent?
- **Generation** — build a transaction that satisfies this intent (not yet implemented per-chain, but the same `Intent` type is used as input)

---

## Concepts

### Chain string

Every intent must declare which blockchain and network it targets. The format is:

```
chain            → mainnet assumed
chain:network    → explicit network
```

Examples: `'solana'`, `'solana:devnet'`, `'ethereum'`, `'ethereum:sepolia'`, `'base'`, `'polygon:amoy'`.

Chain names are case-insensitive and normalized to lowercase internally.

### Actions

An action describes what the user wants to do. There are two tiers:

**Known actions** — `transfer`, `swap`, `stake`, `lend`, `borrow`, `approve`, `withdraw`. These get deep field-level verification: every field in the intent is checked against the decoded transaction params.

**Unknown (custom) actions** — any other string. These get shallow verification: the verifier confirms the right program/contract and method type were called, but cannot interpret params. The result is always `confidence: 'unverified'` and `matched: false`.

### Amounts

Amounts are **decimal strings**, not numbers. This avoids floating-point precision errors when working with token amounts. Examples: `"100"`, `"0.5"`, `"1000.000001"`.

Amounts support constraints (see below). All amount comparisons use arbitrary-precision decimal arithmetic internally via `src/amount-utils.ts`.

### Constraints

Any amount field can be an exact value or a constraint object:

```typescript
// Exact match (with 0.01% default tolerance)
amount: "100"

// Conditional matching
amount: { gte: "1000" }           // at least 1000
amount: { lte: "500" }            // at most 500
amount: { gte: "100", lte: "200" } // range
amount: { gt: "0" }               // strictly positive
```

Constraint bounds are also decimal strings.

### Token identification

Use `tokenSymbol` for human-readable symbol resolution, or `token` for a direct contract/mint address. Both can be provided — if so, the token registry cross-checks that they match.

```typescript
{ tokenSymbol: 'USDC' }                           // resolved via registry
{ token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }   // direct address
{ tokenSymbol: 'USDC', token: '0x...' }           // both — cross-checked
```

The registry is chain-and-network-scoped, so `tokenSymbol: 'USDC'` on `chain: 'base'` resolves to a different address than on `chain: 'ethereum'`.

### Matching strictness

By default (`strict: false`), the verifier looks for the intent's actions among the transaction's instructions and ignores anything else — compute budget instructions, ATA creation, memos, etc. are treated as noise.

With `strict: true`, every non-ancillary instruction in the transaction must be accounted for by one of the intent's actions. An instruction is ancillary if its type is one of: `set_compute_unit_price`, `set_compute_unit_limit`, `memo`, `create`, `create_idempotent`.

### Confidence tiers

The verifier reports how thoroughly it could check the intent:

| Confidence | Meaning |
|---|---|
| `full` | Action is known; all intent fields were decoded and matched (or satisfied constraints) |
| `partial` | Action is known; some fields could not be fully verified (reserved for future use) |
| `unverified` | Action is unknown, or chain adapter not yet implemented — structural match only |

`unverified` always results in `matched: false`. The agent can inspect `analysis` to make its own judgment, but the SDK will not claim a match it could not verify.

---

## Types

```typescript
// src/intent/types.ts

type Constraint<T> = T | {
  gte?: T;
  lte?: T;
  gt?: T;
  lt?: T;
};

type TokenRef = {
  tokenSymbol?: string;
  token?: string;
};

type TransferIntent = {
  action: 'transfer';
  from: string;
  to: string;
  amount: Constraint<string>;
  memo?: string;
} & TokenRef;

type SwapIntent = {
  action: 'swap';
  from: string;
  tokenIn: TokenRef;
  tokenOut: TokenRef;
  amountIn?: Constraint<string>;
  amountOut?: Constraint<string>;
  slippage?: number;  // basis points
};

type StakeIntent = {
  action: 'stake';
  from: string;
  amount: Constraint<string>;
  validator?: string;
  protocol?: string;
} & TokenRef;

type LendIntent = {
  action: 'lend';
  from: string;
  amount: Constraint<string>;
  protocol?: string;
} & TokenRef;

type BorrowIntent = {
  action: 'borrow';
  from: string;
  amount: Constraint<string>;
  protocol?: string;
} & TokenRef;

type ApproveIntent = {
  action: 'approve';
  owner: string;
  spender: string;
  amount: Constraint<string>;
} & TokenRef;

type WithdrawIntent = {
  action: 'withdraw';
  from: string;
  amount: Constraint<string>;
  protocol?: string;
} & TokenRef;

// Any other action string — gets shallow verification only
type CustomIntent = {
  action: string;
  [key: string]: unknown;
};

type ActionIntent =
  | TransferIntent | SwapIntent | StakeIntent | LendIntent
  | BorrowIntent | ApproveIntent | WithdrawIntent | CustomIntent;

// Single action intent
type SingleIntent = { chain: string; strict?: boolean } & ActionIntent;

// Compound intent — multiple actions in one transaction
type CompoundIntent = {
  chain: string;
  strict?: boolean;
  actions: ActionIntent[];
};

type Intent = SingleIntent | CompoundIntent;

type Confidence = 'full' | 'partial' | 'unverified';

interface VerifyResult {
  matched: boolean;
  confidence: Confidence;
  discrepancies: string[];
  analysis: TransactionAnalysis;  // full decoded tx from chain adapter
}
```

---

## Compound intents

A compound intent expresses multiple actions that should all appear in a single transaction — for example, a withdraw followed by a transfer. Use the `actions` array instead of a top-level `action`:

```typescript
const intent: Intent = {
  chain: 'ethereum',
  actions: [
    { action: 'withdraw', from: '0xAlice', amount: '100', tokenSymbol: 'USDC', protocol: 'aave' },
    { action: 'transfer', from: '0xAlice', to: '0xBob', amount: '100', tokenSymbol: 'USDC' },
  ],
};
```

Compound matching rules:

- Each action must match at least one decoded instruction. Order does not matter.
- An instruction can only satisfy one action (each is consumed once).
- `confidence` is the lowest confidence across all action matches.
- `matched` is `true` only if every action matched and confidence is not `unverified`.
- In strict mode, every non-ancillary instruction must be claimed by one of the actions.

---

## Examples

### Simple transfer on Solana mainnet

```typescript
const intent: Intent = {
  chain: 'solana',
  action: 'transfer',
  from: 'AgXx...w1',
  to: 'BobA...c2',
  amount: '100',
  tokenSymbol: 'USDC',
};

const result = await verifyIntent(txBase64, intent);
// result.matched === true
// result.confidence === 'full'
```

### Swap with minimum output constraint

```typescript
const intent: Intent = {
  chain: 'ethereum',
  action: 'swap',
  from: '0xAlice...',
  tokenIn: { tokenSymbol: 'ETH' },
  tokenOut: { tokenSymbol: 'USDC' },
  amountIn: '0.5',
  amountOut: { gte: '1000' },  // at least 1000 USDC out
};
```

### Transfer on devnet with exact address

```typescript
const intent: Intent = {
  chain: 'solana:devnet',
  action: 'transfer',
  from: 'AgXx...',
  to: 'BobA...',
  amount: '50',
  token: 'uSDCYMsmqUKxijtDMwPnkJDnSwXkZ3RFWq6cznL5Lt2',  // devnet USDC
};
```

### Strict mode — no unexpected instructions allowed

```typescript
const intent: Intent = {
  chain: 'base',
  strict: true,
  action: 'transfer',
  from: '0xAlice...',
  to: '0xBob...',
  amount: '50',
  tokenSymbol: 'USDC',
};
// Any non-ancillary instruction beyond the transfer → matched: false
```

### Custom (unknown) action

```typescript
const intent: Intent = {
  chain: 'ethereum',
  action: 'flashLoan',
  from: '0xAlice...',
  amount: '10000',
  tokenSymbol: 'USDC',
  protocol: 'aave',
};
// result.confidence === 'unverified'
// result.matched === false
// result.analysis still contains the full decoded transaction
```

---

## Architecture

The framework is composed of four internal modules plus the public API entry point.

### `src/intent/chains.ts` — Chain parsing and address normalization

```typescript
parseChain('solana:devnet')   // → { chain: 'solana', network: 'devnet' }
parseChain('ethereum')        // → { chain: 'ethereum', network: 'mainnet' }

isEvmChain('base')            // → true
isEvmChain('solana')          // → false

normalizeAddress('0xAbCdEf', 'ethereum')                        // → '0xabcdef'
normalizeAddress('EPjFWdd5...', 'solana')                       // → unchanged
```

EVM addresses are lowercased for comparison. Solana addresses are compared as-is (case-sensitive, base58).

EVM-family chains: `ethereum`, `base`, `polygon`, `arbitrum`, `optimism`, `avalanche`, `bsc`, `gnosis`, `zksync`, `scroll`, `linea`, `mantle`.

### `src/intent/constraints.ts` — Constraint evaluation

```typescript
evaluateConstraint('100', '100')            // true — exact match within 0.01% tolerance
evaluateConstraint({ gte: '1000' }, '500')  // false
evaluateConstraint({ gte: '100', lte: '200' }, '150')  // true
```

Under the hood, uses `parseDecimal`, `compareDecimals`, and `withinRelativeTolerance` from `src/amount-utils.ts` for precision decimal arithmetic. All amounts are parsed as `{ int: bigint, scale: number }` tuples — no floating-point involved.

The default tolerance for exact matches is 0.01% (to accommodate rounding in decoded amounts).

### `src/intent/token-registry.ts` — Chain-scoped token registry

The registry is structured as `chain → network → symbol → { address, decimals }`.

```typescript
const reg = createTokenRegistry();

reg.resolveSymbol('solana', 'mainnet', 'USDC')
// → { address: 'EPjFWdd5...', decimals: 6, symbol: 'USDC' }

reg.resolveAddress('ethereum', 'mainnet', '0xa0b86991...')
// → { address: '0xA0b86991...', decimals: 6, symbol: 'USDC' }  (case-insensitive for EVM)

reg.crossCheck('solana', 'mainnet', 'USDC', 'EPjFWdd5...')
// → true

reg.crossCheck('solana', 'mainnet', 'USDC', 'Es9vMF...')
// → false  (that's USDT's address)
```

Custom overrides can be passed to `createTokenRegistry(overrides)`. Overrides are merged per-chain and per-network — custom entries win, bundled entries not overridden are preserved.

**Bundled tokens:**

| Chain | Network | Tokens |
|---|---|---|
| solana | mainnet | USDC, USDT, SOL |
| solana | devnet | USDC, USDT |
| ethereum | mainnet | USDC, USDT, WETH |
| ethereum | sepolia | USDC, USDT |
| polygon | mainnet | USDC, USDT |
| polygon | amoy | USDC, USDT |
| base | mainnet | USDC, USDT |
| base | sepolia | USDC |

### `src/intent/matcher.ts` — Chain-agnostic intent matching

The matcher is the core verification engine. It takes decoded instructions (from a chain adapter) and returns a `MatchResult`:

```typescript
matchIntent(
  actions: ActionIntent[],
  instructions: InstructionAnalysis[],
  globalFlags: RiskFlag[],
  chain: string,
  strict: boolean,
): MatchResult
```

**Matching algorithm:**

1. Any error-severity flag in `globalFlags` is added to discrepancies immediately.
2. For each action, find a matching instruction (by `type` field), skipping already-used indices.
3. If the action is a known action, run field-level comparison (addresses, amounts with constraints, memo).
4. If the action is unknown, mark confidence as `unverified`.
5. Collect the lowest confidence across all action matches.
6. In strict mode, flag any non-ancillary instruction that was not claimed.
7. `matched` is `true` iff discrepancies is empty AND confidence is not `unverified`.

**Field comparison:**
- **Address fields** (`from`, `to`, `owner`, `spender`, `validator`): compared with `normalizeAddress` — EVM lowercased, Solana as-is.
- **Amount fields** (`amount`, `amountIn`, `amountOut`): parsed from `amountHuman` param (e.g., `"100 USDC"` → `"100"`), then evaluated with `evaluateConstraint`.
- **Memo**: exact string match.

### `src/intent/helpers.ts` — Type predicates and utilities

```typescript
isSingleIntent(intent)   // intent is SingleIntent
isCompoundIntent(intent) // intent is CompoundIntent
getActions(intent)       // → ActionIntent[]  (normalizes both forms to array)
```

---

## Data flow through `verifyIntent`

```
verifyIntent(txBytes, intent, opts?)
│
├── validate intent.chain is present
├── parseChain(intent.chain) → { chain, network }
├── getActions(intent)       → ActionIntent[]
│
├── chain === 'solana'
│   └── analyzeTransaction(txBytes, opts)  [from src/verify/]
│       ├── deserialize transaction bytes
│       ├── look up each program in registry
│       ├── run program-specific decoder (handshake, spl-token, jupiter, …)
│       ├── applyGlobalFlags (unknown programs, risk signals)
│       └── → TransactionAnalysis { feePayer, instructions[], flags[], summary }
│
│   remap Solana-specific instruction types to generic names:
│   └── create_transfer → transfer (also: sender→from, recipient→to)
│
├── matchIntent(actions, instructions, flags, chain, strict)
│   └── → MatchResult { matched, confidence, discrepancies }
│
└── → VerifyResult { matched, confidence, discrepancies, analysis }
```

The chain adapter layer (currently only Solana) is responsible for:
1. Deserializing raw transaction bytes
2. Decoding each instruction into structured params
3. Translating protocol-specific instruction names to generic action names

Adding a new chain requires implementing the chain adapter and registering it in `src/intent/index.ts`.

---

## API

### `verifyIntent(txBytes, intent, opts?)`

```typescript
import { verifyIntentV2 as verifyIntent } from '@silkysquad/silk';
import type { Intent, VerifyResult } from '@silkysquad/silk';

const result: VerifyResult = await verifyIntent(txBase64, intent, {
  connection,  // optional Solana Connection for RPC token lookups
});

result.matched        // boolean
result.confidence     // 'full' | 'partial' | 'unverified'
result.discrepancies  // string[] — human-readable mismatch descriptions
result.analysis       // full TransactionAnalysis from the chain adapter
```

### `evaluateConstraint(constraint, actual, tolerance?)`

Useful for testing constraints independently:

```typescript
import { evaluateConstraint } from '@silkysquad/silk';

evaluateConstraint('100', '100.005')       // true (within 0.01% tolerance)
evaluateConstraint({ gte: '1000' }, '500') // false
```

### `createTokenRegistry(overrides?)`

```typescript
import { createTokenRegistry } from '@silkysquad/silk';

const reg = createTokenRegistry({
  solana: {
    mainnet: {
      MYTOKEN: { address: 'MyToK...', decimals: 9 },
    },
  },
});

reg.resolveSymbol('solana', 'mainnet', 'MYTOKEN');
```

### `parseChain(chainStr)`, `normalizeAddress(addr, chain)`, `isEvmChain(chain)`

Lower-level utilities exported for consumers that need to work with chain/address logic directly.

---

## Module structure

```
src/intent/
├── types.ts          — Intent, ActionIntent, Constraint, TokenRef, VerifyResult, Confidence
├── chains.ts         — parseChain, isEvmChain, normalizeAddress
├── constraints.ts    — evaluateConstraint
├── token-registry.ts — createTokenRegistry, TokenInfo
├── helpers.ts        — isSingleIntent, isCompoundIntent, getActions
├── matcher.ts        — matchIntent (chain-agnostic matching engine)
└── index.ts          — public API: verifyIntent, re-exports
```

The `src/verify/` module is unchanged and continues to export the Solana-specific `verifyIntent` (the original, program-instruction-level API). The new framework is exported as `verifyIntentV2` from `src/index.ts` to avoid naming conflicts.

---

## Extending the framework

### Adding a new chain

1. Add the chain name to `EVM_CHAINS` in `chains.ts` if it is EVM-compatible.
2. Add bundled token addresses to `BUNDLED_TOKENS` in `token-registry.ts`.
3. Add a chain adapter branch in `src/intent/index.ts`:

```typescript
} else if (chain === 'base') {
  // Call the EVM chain adapter (not yet implemented)
  analysis = await evmAnalyze(txBytes, opts);
  // Remap any EVM-specific instruction type names to generic names if needed
}
```

### Adding a new known action

1. Add the action type to `types.ts` with its fields.
2. Add the action string to `KNOWN_ACTIONS` in `matcher.ts`.
3. Add any field mappings needed in `compareFields` (address fields and amount fields are handled generically — action-specific param names may need remapping in the chain adapter).
4. Add to the `ActionIntent` union type.

### Custom token registries

Pass an override map to `createTokenRegistry`. This does not affect the global bundled data — each call to `createTokenRegistry` produces an isolated registry instance:

```typescript
const reg = createTokenRegistry({
  ethereum: {
    mainnet: {
      USDC: { address: '0xOverridden...', decimals: 6 },  // overrides bundled USDC
      MYPROTOCOL: { address: '0xMyProt...', decimals: 18 },
    },
  },
});
```

---

## Relationship to `src/verify/`

The `src/verify/` module remains the Solana-specific layer. It decodes Solana transactions instruction-by-instruction and provides `analyzeTransaction` and the original `verifyIntent` (which uses Handshake/Silkysig program-instruction types like `create_transfer`, `claim_transfer`, etc.).

The `src/intent/` module sits on top: it calls `analyzeTransaction` from `src/verify/` as its Solana chain adapter, then translates program-specific instruction types to generic action names before running the chain-agnostic matcher.

The two APIs coexist and can be used independently:

| API | Use when |
|---|---|
| `verifyIntent` (from `src/verify/`) | Silkysig/Handshake program verification with program-specific intent types |
| `verifyIntentV2` (from `src/intent/`) | Generic cross-chain intent verification with any action type |
