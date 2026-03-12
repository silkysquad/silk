# Cross-Chain Intent Framework

**Date:** 2026-03-04
**Module:** `@silkysquad/silk` — `src/verify/`
**Status:** Design

---

## Overview

The intent framework is a chain-agnostic system for expressing what an agent wants a transaction to do, then verifying that a given transaction accomplishes it. It replaces the current Solana-specific `Intent` type with a generic, extensible structure that works across Solana, Ethereum, and EVM L2s (Base, Arbitrum, Polygon, etc.).

An intent serves two purposes. First, it is the input to transaction verification — "does this transaction do what I asked?" Second, it is the input to transaction generation — "build me a transaction that does this." The intent is the shared contract between the agent and the system, and both generation and verification operate on the same type.

---

## Intent Structure

Every intent has a small set of required fields and action-specific params.

**Required fields:**

- `chain` — Identifies the blockchain and optionally the network. Format is `chain` or `chain:network`. Omitting the network suffix means mainnet. Examples: `'solana'`, `'solana:devnet'`, `'ethereum'`, `'ethereum:sepolia'`, `'base'`, `'polygon:amoy'`.
- `action` — What the user wants to do. Known actions (`'transfer'`, `'swap'`, `'stake'`, etc.) get deep verification. Any other string is accepted and gets shallow verification.

**Optional fields:**

- `strict` — Default `false`. When `true`, the transaction must contain only instructions that serve this intent. When `false`, the verifier checks that the intent's action exists in the transaction and ignores other instructions (compute budget, ATA creation, memo, etc.).

**Token identification** uses two optional fields (at least one required when a token is relevant):

- `tokenSymbol` — Human-friendly symbol like `'USDC'`, resolved via the chain-scoped registry to a contract/mint address.
- `token` — The actual contract/mint address, used as-is.

If both are provided, the registry cross-checks them. If only `tokenSymbol` is given, the registry resolves it for the specified chain and network.

---

## Constraints

Intent field values can be plain values (exact match, with tolerance where appropriate for amounts) or constraint objects for conditional matching:

```typescript
type Constraint<T> = T | {
  gte?: T;   // greater than or equal
  lte?: T;   // less than or equal
  gt?: T;    // greater than
  lt?: T;    // less than
};
```

A plain value like `amount: 100` means exact match (with the existing 0.01% tolerance for token amounts). A constraint like `amount: { gte: 1000 }` means "at least 1000." Multiple constraint fields can be combined: `amount: { gte: 100, lte: 200 }`.

This is particularly useful for swaps where exact output amounts are not known in advance: `amountOut: { gte: 1000 }` means "at least 1000 tokens out."

---

## Known Actions

The initial set of known actions with their expected fields:

**`transfer`** — Move tokens from one address to another.
Fields: `from`, `to`, `amount`, `tokenSymbol`/`token`, `memo` (optional).

**`swap`** — Exchange one token for another.
Fields: `from` (sender address), `tokenIn` (symbol or address), `tokenOut` (symbol or address), `amountIn` and/or `amountOut` (either can be a constraint), `slippage` (optional, basis points).

**`stake`** — Stake tokens with a validator or protocol.
Fields: `from`, `amount`, `tokenSymbol`/`token`, `validator` or `protocol` (optional).

**`lend`** — Supply tokens to a lending protocol.
Fields: `from`, `amount`, `tokenSymbol`/`token`, `protocol` (optional).

**`borrow`** — Borrow tokens from a lending protocol.
Fields: `from`, `amount`, `tokenSymbol`/`token`, `protocol` (optional).

**`approve`** — Approve a spender (EVM-specific).
Fields: `owner`, `spender`, `amount`, `tokenSymbol`/`token`.

**`withdraw`** — Withdraw, unstake, or redeem from a protocol.
Fields: `from`, `amount`, `tokenSymbol`/`token`, `protocol` (optional).

For any unknown action string, the intent can include arbitrary params. The verifier matches contract address and method selector only, resulting in `unverified` confidence.

All address fields are normalized per chain rules — lowercased for EVM comparison, case-sensitive for Solana.

---

## Compound Intents

An intent can be a single action or an ordered list of actions. This supports composable transactions like "withdraw from Aave + transfer to Bob" in a single transaction.

A compound intent has an `actions` array instead of a top-level action:

```typescript
{
  chain: 'ethereum',
  actions: [
    { action: 'withdraw', from: '0x...', amount: 100, protocol: 'aave', tokenSymbol: 'USDC' },
    { action: 'transfer', from: '0x...', to: '0x...', amount: 100, tokenSymbol: 'USDC' },
  ]
}
```

Verification rules for compound intents:

- Each action in `actions` must match at least one decoded instruction in the transaction.
- Order does not matter — the transaction may interleave ancillary instructions between matching ones.
- Confidence is the lowest confidence across all matched actions.
- `matched` is `true` only if every action matched.
- In strict mode, every instruction must be accounted for by one of the actions or be ancillary.

There are no dependencies between actions. Each action is matched independently.

---

## Verification Result

The verifier returns a result with two distinct axes — match confidence and discrepancies — with room for future risk scoring.

```typescript
type VerifyResult = {
  matched: boolean;
  confidence: 'full' | 'partial' | 'unverified';
  discrepancies: string[];
  analysis: TransactionAnalysis;
};
```

**Confidence tiers:**

- `full` — The action is known, the decoder fully parsed the instruction, and every field in the intent was checked and matched or satisfied the constraint.
- `partial` — The action is known and the core fields matched, but some fields could not be fully verified. Examples: token resolved by symbol but address could not be cross-checked, amount matched with tolerance, extra unverified instructions present in non-strict mode.
- `unverified` — The action string is unknown. The verifier confirmed the transaction calls the right contract/program and the right method selector, but could not interpret the params. The match is structural only.

**Match determination:**

`matched` is `true` when there are zero discrepancies and confidence is not `unverified`. An `unverified` result always sets `matched` to `false`. The agent can still choose to proceed, but the SDK does not claim it verified the intent.

In strict mode, any instruction in the transaction that is not recognized as serving the intent adds a discrepancy.

---

## Matching Engine Architecture

The matching engine is a two-layer system that separates chain-specific deserialization from chain-agnostic intent matching.

### Layer 1: Chain Adapter

Each chain has an adapter that deserializes raw transaction bytes and produces a chain-agnostic intermediate representation: a list of decoded calls, each with a program/contract address, method identifier, and decoded params.

The `chain` field on the intent selects the adapter. For Solana, this is the existing `analyzeTransaction` pipeline (deserialize, registry lookup, decoder, flags). For EVM chains, the adapter deserializes RLP-encoded transactions, uses ABI decoding for known contracts, and extracts function selectors for unknown ones.

### Layer 2: Intent Matcher

Chain-agnostic. Takes the decoded calls from the adapter and the intent, then:

1. Finds a decoded call whose action type matches `intent.action`.
2. For known actions, compares each intent field against decoded params — exact match for addresses (with chain-appropriate normalization), tolerance or constraint evaluation for amounts.
3. If `strict: true`, checks that all other calls are ancillary (a per-chain allowlist of harmless instruction types like compute budget, ATA creation, nonce advance).
4. Sets the confidence tier based on how deeply it could verify.
5. Collects discrepancies.

Adding a new chain requires writing an adapter. The matching logic is shared.

---

## Registry Structure

The registry is chain-scoped, with shared token metadata at the top level and per-chain, per-network token addresses underneath.

```
shared.tokens
  USDC → { name, symbol, decimals, iconUrl }
  USDT → { name, symbol, decimals, iconUrl }

chains
  SOLANA
    networks
      mainnet
        tokens
          USDC → { address: 'EPjFW...' }
      devnet
        tokens
          USDC → { address: 'uSDCY...' }
  ETHEREUM
    networks
      mainnet
        tokens
          USDC → { address: '0xA0b8...' }
      sepolia
        tokens
          USDC → { address: '0x7F65...' }
  BASE
    networks
      mainnet
        tokens
          USDC → { address: '0x8335...' }
```

**Token resolution:**

1. Parse the intent's `chain` field into chain key and network (default mainnet).
2. If `tokenSymbol` is given, look up the address in `chains[chain].networks[network].tokens[symbol]`.
3. If `token` (address) is given, reverse-lookup in the same network's token map to find metadata.
4. If both are given, cross-check that the symbol resolves to the given address.
5. Decimals come from `shared.tokens[symbol].decimals`.

The registry is compiled into the SDK bundle. Consumers can merge custom entries at call time. Sensitive configuration (RPC URLs, API keys, signer paths) is not part of the SDK registry — that belongs to the consuming application.

---

## API Surface

```typescript
// Analyze any transaction on a given chain
function analyzeTransaction(
  txBytes: string,
  chain: string,
  opts?: AnalyzeOptions,
): Promise<TransactionAnalysis>;

// Verify a transaction matches an intent
function verifyIntent(
  txBytes: string,
  intent: Intent,
  opts?: AnalyzeOptions,
): Promise<VerifyResult>;

// Generate a transaction from an intent (future)
function buildTransaction(
  intent: Intent,
  opts?: BuildOptions,
): Promise<string>;
```

`analyzeTransaction` takes an explicit `chain` parameter since it does not have an intent to read it from. `verifyIntent` reads the chain from the intent. `buildTransaction` is the generation side — listed here to show the intent is the shared contract, but implementation is a separate effort.

---

## TypeScript Types

```typescript
// ─── Constraints ──────────────────────────────────────────────

type Constraint<T> = T | {
  gte?: T;
  lte?: T;
  gt?: T;
  lt?: T;
};

// ─── Token identification ─────────────────────────────────────

type TokenRef = {
  tokenSymbol?: string;
  token?: string;
};

// ─── Known actions ────────────────────────────────────────────

type TransferIntent = {
  action: 'transfer';
  from: string;
  to: string;
  amount: Constraint<number>;
  memo?: string;
} & TokenRef;

type SwapIntent = {
  action: 'swap';
  from: string;
  tokenIn: TokenRef;
  tokenOut: TokenRef;
  amountIn?: Constraint<number>;
  amountOut?: Constraint<number>;
  slippage?: number;
};

type StakeIntent = {
  action: 'stake';
  from: string;
  amount: Constraint<number>;
  validator?: string;
  protocol?: string;
} & TokenRef;

type LendIntent = {
  action: 'lend';
  from: string;
  amount: Constraint<number>;
  protocol?: string;
} & TokenRef;

type BorrowIntent = {
  action: 'borrow';
  from: string;
  amount: Constraint<number>;
  protocol?: string;
} & TokenRef;

type ApproveIntent = {
  action: 'approve';
  owner: string;
  spender: string;
  amount: Constraint<number>;
} & TokenRef;

type WithdrawIntent = {
  action: 'withdraw';
  from: string;
  amount: Constraint<number>;
  protocol?: string;
} & TokenRef;

// ─── Unknown / custom actions ─────────────────────────────────

type CustomIntent = {
  action: string;
  [key: string]: unknown;
};

// ─── Action union ─────────────────────────────────────────────

type ActionIntent =
  | TransferIntent
  | SwapIntent
  | StakeIntent
  | LendIntent
  | BorrowIntent
  | ApproveIntent
  | WithdrawIntent
  | CustomIntent;

// ─── Single and compound intents ──────────────────────────────

type SingleIntent = {
  chain: string;
  strict?: boolean;
} & ActionIntent;

type CompoundIntent = {
  chain: string;
  strict?: boolean;
  actions: ActionIntent[];
};

type Intent = SingleIntent | CompoundIntent;

// ─── Result ───────────────────────────────────────────────────

type VerifyResult = {
  matched: boolean;
  confidence: 'full' | 'partial' | 'unverified';
  discrepancies: string[];
  analysis: TransactionAnalysis;
};
```

---

## Examples

### Simple transfer

```typescript
const intent: Intent = {
  chain: 'solana',
  action: 'transfer',
  from: 'AgXx...w1',
  to: 'BobA...c2',
  amount: 100,
  tokenSymbol: 'USDC',
};
```

### Swap with minimum output

```typescript
const intent: Intent = {
  chain: 'ethereum',
  action: 'swap',
  from: '0xAlice...',
  tokenIn: { tokenSymbol: 'ETH' },
  tokenOut: { tokenSymbol: 'USDC' },
  amountIn: 0.5,
  amountOut: { gte: 1000 },
};
```

### Compound withdraw + transfer

```typescript
const intent: Intent = {
  chain: 'ethereum',
  actions: [
    { action: 'withdraw', from: '0xAlice...', amount: 100, protocol: 'aave', tokenSymbol: 'USDC' },
    { action: 'transfer', from: '0xAlice...', to: '0xBob...', amount: 100, tokenSymbol: 'USDC' },
  ],
};
```

### Strict mode

```typescript
const intent: Intent = {
  chain: 'base',
  strict: true,
  action: 'transfer',
  from: '0xAlice...',
  to: '0xBob...',
  amount: 50,
  tokenSymbol: 'USDC',
};
```

### Custom / unknown action

```typescript
const intent: Intent = {
  chain: 'ethereum',
  action: 'flashLoan',
  from: '0xAlice...',
  amount: 10000,
  tokenSymbol: 'USDC',
  protocol: 'aave',
};
// Verifier matches contract + method selector only → confidence: 'unverified'
```

---

## Migration from Current Intent Type

The current `Intent` type is Solana-specific with instruction-level actions (`create_transfer`, `claim_transfer`, `cancel_transfer`, `transfer_from_account`, `deposit`). The new framework replaces this with generic actions.

| Current | New |
|---|---|
| `create_transfer` | `transfer` (with `chain: 'solana'`) |
| `claim_transfer` | Custom action or new known action if common enough |
| `cancel_transfer` | Custom action or new known action |
| `transfer_from_account` | `transfer` (the Silkysig-specific routing is a chain adapter concern) |
| `deposit` | `lend` or a generic `deposit` action |

The Solana chain adapter maps generic action names to the protocol-specific instruction types internally. The intent author does not need to know the Handshake program's instruction naming conventions.

---

## Future Considerations

**Risk scoring.** The `VerifyResult` currently only has `confidence` (how well did the intent match). A separate `risk` axis could be added later to flag concerns orthogonal to matching — unknown protocols, addresses associated with hacks, unusual patterns. The result structure has room for this without breaking changes.

**Fiat-denominated amounts.** An optional `fiatAmount` field could express goals like "100 USD worth of ETH." This requires oracle integration and is out of scope for the initial implementation. The generation side could use it to determine the token amount, and verification would check the resolved token amount.

**Cross-chain intents.** An intent that spans multiple chains (bridge + swap) is not covered by the current design. Each intent targets a single chain. Cross-chain flows would be expressed as separate intents coordinated by the agent.
