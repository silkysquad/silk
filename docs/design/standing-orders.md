# Standing Orders

**Date:** 2026-03-13
**Module:** `@silkysquad/silk` — `src/orders/`
**Status:** Design

---

## Overview

A standing order is an intent that persists on disk until it's filled, cancelled, or expired. On each heartbeat, the agent loads its orders, optionally pre-filters by a local price check, then submits executable ones to the server. The server either returns an unsigned transaction (fillable) or a "conditions not met" response. If a transaction comes back, the agent verifies it against the original intent using the existing verification pipeline, signs, and submits.

The server is stateless about orders — it doesn't store them, track them, or execute them autonomously. The agent's local filesystem is the source of truth. This preserves the non-custodial model: the server builds transactions, the agent decides when to ask and whether to sign.

The initial implementation covers swap limit orders (the primary use case), but the system is generic over any `Intent` type. A standing transfer that waits for sufficient balance, a recurring DCA, or a future intent type all use the same `Order` wrapper and heartbeat loop.

---

## Concepts

### Order = Intent + ExecutionPolicy + Lifecycle

The existing `Intent` type (from `src/intent/types.ts`) describes *what* a transaction should do, including price. A swap intent's amount constraints already express the acceptable price range — `amountOut: { gte: "5.882" }` *is* the limit price. There is no separate "trigger condition" because the price is an inherent part of the swap specification.

The `Order` wrapper adds only what's genuinely outside the intent: execution policy (expiry, cooldown, retry limits, recurrence) and lifecycle state (status, history).

### Slippage

Slippage is specified as a percentage (default 0.1%, max 10%) and lives on the `Order`. It is applied when constructing the intent from human-friendly inputs — `--price 85 --slippage 0.5` calculates `amountOut.gte` as `sellAmount / price * (1 - slippage/100)`. Slippage is also passed to the server so it can build the swap transaction within that tolerance. After construction, the intent's constraints are the source of truth for verification.

### Server statelessness

The server never stores standing orders. On each heartbeat, the agent posts an intent to `POST /api/orders/evaluate`. The server checks whether current market conditions can satisfy the intent, and either returns an unsigned transaction or a "conditions not met" response. This is an atomic check-and-build — no separate price query followed by a tx build request.

---

## Types

```typescript
// src/orders/types.ts

interface Order {
  id: string;                          // uuid
  intent: Intent;                      // from src/intent/types.ts
  policy: ExecutionPolicy;
  status: OrderStatus;
  slippage: number;                    // percent, default 0.1, max 10
  wallet?: string;                     // wallet label (defaults to default wallet)
  createdAt: string;                   // ISO timestamp
  updatedAt: string;                   // ISO timestamp
  history: OrderEvent[];               // audit trail
}

type OrderStatus = 'pending' | 'executing' | 'filled' | 'cancelled' | 'expired' | 'failed';

interface ExecutionPolicy {
  expiresAt?: string;                  // ISO timestamp — auto-cancel after this
  cooldown?: number;                   // seconds between attempts, default 60
  maxAttempts?: number;                // undefined = unlimited
  recurrence?: {
    interval: number;                  // seconds between fills (DCA)
    remaining?: number;                // undefined = forever
  };
}

interface OrderEvent {
  timestamp: string;
  type: 'created' | 'attempted' | 'filled' | 'cancelled' | 'expired' | 'failed';
  reason?: string;                     // machine-readable: PRICE_OUT_OF_RANGE, etc.
  detail?: string;                     // human/LLM-readable context
  txid?: string;                       // present on fill
}

interface EvaluationResult {
  orderId: string;
  status: OrderStatus;                 // status after evaluation
  event: OrderEvent;                   // what happened this pass
}

interface PriceFeed {
  getPrice(base: string, quote: string): Promise<number | null>;
}
```

---

## Storage

Single file at `~/.config/silkyway/orders.json`.

```json
{
  "orders": [
    { "id": "abc-123", "intent": {}, "policy": {}, "status": "pending", "slippage": 0.1, ... },
    { "id": "def-456", "intent": {}, "policy": {}, "status": "filled", "slippage": 0.1, ... }
  ]
}
```

Filled, cancelled, and expired orders remain in the file as a historical record. A future `silky orders prune` command could archive old entries if the file grows large.

Functions follow the existing config/contacts pattern: `loadOrders()`, `saveOrders()`, `addOrder()`, `updateOrder()`, `getOrder()`.

---

## Server Endpoint

### POST /api/orders/evaluate

Accepts any intent, checks whether current conditions can satisfy it, and either returns an unsigned transaction or a "conditions not met" response.

**Request:**
```json
{
  "intent": {
    "chain": "solana",
    "action": "swap",
    "from": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp",
    "tokenIn": { "tokenSymbol": "USDC" },
    "tokenOut": { "tokenSymbol": "SOL" },
    "amountIn": "500",
    "amountOut": { "gte": "5.882" }
  },
  "slippage": 0.1,
  "wallet": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp"
}
```

**Fillable response:**
```json
{
  "ok": true,
  "data": {
    "transaction": "AQAAAAAAAAAAAAAA...base64...AAAAAAA=",
    "quote": {
      "price": "84.90",
      "amountIn": "500",
      "amountOut": "5.889"
    }
  }
}
```

**Conditions not met response:**
```json
{
  "ok": true,
  "data": {
    "executable": false,
    "reason": "PRICE_OUT_OF_RANGE",
    "detail": "SOL/USDC at 120.50, need ≤ 85.00"
  }
}
```

Both responses are `ok: true`. The "conditions not met" outcome is normal, not an error. Errors (`ok: false`) are reserved for actual failures: bad auth, malformed intent, server issues.

The `reason` code is machine-readable so the agent can act on it programmatically. Known reason codes:

| Reason | Description |
|--------|-------------|
| `PRICE_OUT_OF_RANGE` | Market price does not satisfy the intent's amount constraints |
| `INSUFFICIENT_LIQUIDITY` | Not enough liquidity to fill the order at the required price |
| `BALANCE_INSUFFICIENT` | Wallet doesn't have enough tokens to execute |
| `UNSUPPORTED_PAIR` | Token pair not supported for swaps |

---

## Heartbeat Loop

The SDK exposes the evaluation logic as a function. It does not own the heartbeat interval — the agent calls it on whatever schedule it wants.

```typescript
async function evaluateOrders(opts?: {
  priceFeed?: PriceFeed;
  dryRun?: boolean;
}): Promise<EvaluationResult[]>
```

### Evaluation flow per order

```
for each order where status === 'pending':
  │
  ├── expired? → status = 'expired', skip
  ├── cooldown not elapsed since last attempt? → skip
  ├── maxAttempts reached? → status = 'failed', skip
  │
  ├── price feed configured?
  │     └── quick check: is price remotely close? → no → skip, log attempt
  │
  ├── POST /api/orders/evaluate with order.intent + slippage
  │     ├── executable: false → log attempt with reason, stay 'pending'
  │     └── transaction returned:
  │           ├── status → 'executing'
  │           ├── verifyIntent(tx, order.intent)
  │           │     ├── verified: sign → submit → status = 'filled', log txid
  │           │     └── not verified: status → 'pending', log discrepancies
  │           └── tx submission fails: status → 'pending', log error
  │
  └── if recurrence and just filled:
        clone order with decremented remaining, status = 'pending'
```

**Key state transitions:**

- Verification failure returns to `pending`, not `failed`. A bad transaction from the server is the server's problem — the order itself is still valid.
- `executing` is a transient state covering the window between receiving a transaction and on-chain confirmation. It prevents double-submission on overlapping heartbeats.
- Recurrence creates a new order (cloned from the original with decremented `remaining`) so the filled order's history is preserved.

### Price feed pre-check

The `PriceFeed` interface is deliberately minimal:

```typescript
interface PriceFeed {
  getPrice(base: string, quote: string): Promise<number | null>;
}
```

The SDK exports the interface but does not bundle an implementation. The agent provides one if it wants local filtering (e.g., a Jupiter or Pyth adapter). This is purely an optimization to avoid unnecessary API calls — if SOL is at $120 and the limit is $85, skip the server round trip.

---

## CLI Commands

```bash
# Create — agent path (raw JSON intent)
silky orders create '{"chain":"solana","action":"swap",...}'

# Create — human path (sugared limit order)
silky orders create swap --sell 500 USDC --buy SOL --price 85
silky orders create swap --sell 500 USDC --buy SOL --price 85 --slippage 0.5 --expires 7d --cooldown 120

# Manage
silky orders list                    # table: id, action, status, created, last attempt
silky orders list --status pending   # filter by status
silky orders get <order-id>          # full detail + history
silky orders cancel <order-id>       # set status → cancelled

# Execute
silky orders evaluate                # run one pass over all pending orders
silky orders evaluate --dry-run      # show what would happen, don't execute
```

The `create` command detects which path based on whether the first argument parses as JSON.

### Sugar parsing for `create swap`

`--sell <amount> <symbol>` and `--buy <symbol>` with `--price <number>` constructs:

- `amountIn`: the sell amount as a decimal string
- `tokenIn`: `{ tokenSymbol: sellSymbol }`
- `tokenOut`: `{ tokenSymbol: buySymbol }`
- `amountOut`: `{ gte: String(sellAmount / price * (1 - slippage / 100)) }`
- `chain`: defaults to current cluster's chain (`solana`)
- `from`: defaults to active wallet address

Example: `--sell 500 USDC --buy SOL --price 85 --slippage 0.1` produces `amountOut: { gte: "5.881764" }`.

### Default policy values

| Field | Default |
|-------|---------|
| `slippage` | 0.1% |
| `cooldown` | 60 seconds |
| `maxAttempts` | none (unlimited) |
| `expiresAt` | none (never expires) |

---

## Module Structure

```
src/orders/
├── types.ts           # Order, ExecutionPolicy, OrderEvent, EvaluationResult, PriceFeed
├── store.ts           # loadOrders, saveOrders, addOrder, updateOrder, getOrder
├── evaluate.ts        # evaluateOrders — the heartbeat loop logic
├── sugar.ts           # CLI sugar parser: --sell/--buy/--price → Intent
└── index.ts           # public API re-exports

src/commands/orders.ts  # CLI command registration (create, list, get, cancel, evaluate)
```

`types.ts` imports `Intent` from `src/intent/types.ts` — the only coupling to the intent framework. `evaluate.ts` imports `verifyIntent` from `src/intent/` and the HTTP client from `src/client.ts`.

---

## Data Flow

### Creating a limit order (human path)

```
silky orders create swap --sell 500 USDC --buy SOL --price 85 --slippage 0.5 --expires 7d
  │
  ├── sugar.ts: parse flags → Intent
  │     { chain: 'solana', action: 'swap', from: walletAddr,
  │       tokenIn: { tokenSymbol: 'USDC' }, tokenOut: { tokenSymbol: 'SOL' },
  │       amountIn: '500', amountOut: { gte: '5.867' } }
  │
  ├── construct Order { id: uuid, intent, policy: { expiresAt: now+7d }, slippage: 0.5, status: 'pending' }
  ├── addOrder(order) → writes to ~/.config/silkyway/orders.json
  └── output { ok: true, data: { orderId: '...', status: 'pending' } }
```

### Heartbeat evaluation

```
Agent calls evaluateOrders({ priceFeed: jupiterFeed })
  │
  ├── loadOrders() → filter pending, not expired, cooldown elapsed
  │
  ├── order "buy SOL at 85":
  │     ├── priceFeed.getPrice('SOL', 'USDC') → 84.50 (close enough)
  │     ├── POST /api/orders/evaluate { intent, slippage: 0.5, wallet }
  │     │     → { ok: true, data: { transaction: 'base64...', quote: { price: '84.50', ... } } }
  │     ├── status → 'executing'
  │     ├── verifyIntent(tx, order.intent) → { matched: true, confidence: 'full' }
  │     ├── sign transaction locally
  │     ├── POST /api/tx/submit { signedTx }
  │     ├── status → 'filled', log txid
  │     └── saveOrders()
  │
  └── return [{ orderId: '...', status: 'filled', event: { type: 'filled', txid: '5UfD...' } }]
```

---

## Extension Points

**New intent types.** Any future `Intent` action type works with standing orders automatically — the `Order` wrapper doesn't interpret the intent, it just stores it and passes it to the server for evaluation.

**New condition types.** If a future use case needs conditions beyond what the intent expresses (e.g., "execute only if gas is below X"), the `ExecutionPolicy` can be extended without changing the `Order` or `Intent` types.

**Price feed implementations.** The `PriceFeed` interface is open for any source: Jupiter, Pyth, Chainlink, a custom oracle. The SDK stays dependency-free.

**Server-side order tracking.** If the server eventually wants to know about standing orders (for analytics, notifications, or proactive filling), the agent could optionally sync its orders via a registration endpoint. The local file remains the source of truth.
