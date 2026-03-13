# Standing Orders Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement persistent standing orders (limit orders, DCA, etc.) that an agent evaluates on each heartbeat, submitting fillable intents to the server and verifying transactions before signing.

**Architecture:** An `Order` wraps an existing `Intent` with execution policy and lifecycle state. Orders are stored in `~/.config/silkyway/orders.json`. The `evaluateOrders()` function runs one pass over pending orders, calling `POST /api/orders/evaluate` and verifying returned transactions via the existing intent verification pipeline. CLI commands expose create (JSON + sugared swap), list, get, cancel, and evaluate.

**Tech Stack:** TypeScript (ESM, strict, `.js` imports), vitest for tests, Commander for CLI, existing SDK patterns (`loadConfig`/`saveConfig`, `createHttpClient`, `wrapCommand`, `outputSuccess`).

---

### Task 1: Order types

**Files:**
- Create: `src/orders/types.ts`
- Test: `src/orders/__tests__/types.test.ts`

**Step 1: Write the failing test**

```typescript
// src/orders/__tests__/types.test.ts
import { describe, it, expect } from 'vitest';
import type { Order, ExecutionPolicy, OrderEvent, OrderStatus, EvaluationResult, PriceFeed } from '../types.js';

describe('Order types', () => {
  it('Order satisfies the interface shape', () => {
    const order: Order = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      intent: {
        chain: 'solana',
        signer: 'BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp',
        action: 'swap',
        from: 'BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp',
        tokenIn: { tokenSymbol: 'USDC' },
        tokenOut: { tokenSymbol: 'SOL' },
        amountIn: '500',
        amountOut: { gte: '5.882' },
      },
      policy: { cooldown: 60 },
      status: 'pending',
      slippage: 0.1,
      createdAt: '2026-03-13T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
      history: [],
    };
    expect(order.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(order.status).toBe('pending');
    expect(order.slippage).toBe(0.1);
  });

  it('ExecutionPolicy with all fields', () => {
    const policy: ExecutionPolicy = {
      expiresAt: '2026-03-20T00:00:00.000Z',
      cooldown: 120,
      maxAttempts: 50,
      recurrence: { interval: 86400, remaining: 10 },
    };
    expect(policy.recurrence?.remaining).toBe(10);
  });

  it('OrderEvent with txid for fill', () => {
    const event: OrderEvent = {
      timestamp: '2026-03-13T12:00:00.000Z',
      type: 'filled',
      detail: 'Filled at SOL/USDC 84.90',
      txid: '5UfDuXsrhFnxGZmyJxNR8z7Ee5JDFrgWHKPdTEJvoTpB',
    };
    expect(event.type).toBe('filled');
    expect(event.txid).toBeDefined();
  });

  it('OrderStatus covers all valid values', () => {
    const statuses: OrderStatus[] = ['pending', 'executing', 'filled', 'cancelled', 'expired', 'failed'];
    expect(statuses).toHaveLength(6);
  });

  it('PriceFeed interface shape', () => {
    const feed: PriceFeed = {
      getPrice: async (_base: string, _quote: string) => 85.0,
    };
    expect(feed.getPrice).toBeDefined();
  });

  it('EvaluationResult interface shape', () => {
    const result: EvaluationResult = {
      orderId: 'abc-123',
      status: 'filled',
      event: { timestamp: '2026-03-13T12:00:00.000Z', type: 'filled', txid: '5UfD...' },
    };
    expect(result.status).toBe('filled');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/orders/__tests__/types.test.ts`
Expected: FAIL — cannot find module `../types.js`

**Step 3: Write the implementation**

```typescript
// src/orders/types.ts
import type { Intent } from '../intent/types.js';

export type OrderStatus = 'pending' | 'executing' | 'filled' | 'cancelled' | 'expired' | 'failed';

export interface ExecutionPolicy {
  expiresAt?: string;
  cooldown?: number;
  maxAttempts?: number;
  recurrence?: {
    interval: number;
    remaining?: number;
  };
}

export interface OrderEvent {
  timestamp: string;
  type: 'created' | 'attempted' | 'filled' | 'cancelled' | 'expired' | 'failed';
  reason?: string;
  detail?: string;
  txid?: string;
}

export interface Order {
  id: string;
  intent: Intent;
  policy: ExecutionPolicy;
  status: OrderStatus;
  slippage: number;
  wallet?: string;
  createdAt: string;
  updatedAt: string;
  history: OrderEvent[];
}

export interface EvaluationResult {
  orderId: string;
  status: OrderStatus;
  event: OrderEvent;
}

export interface PriceFeed {
  getPrice(base: string, quote: string): Promise<number | null>;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/orders/__tests__/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orders/types.ts src/orders/__tests__/types.test.ts
git commit -m "feat(orders): add Order, ExecutionPolicy, and related types"
```

---

### Task 2: Order store (persistence)

**Files:**
- Create: `src/orders/store.ts`
- Test: `src/orders/__tests__/store.test.ts`

**Context:** Follow the exact same pattern as `src/contacts.ts` — `loadContacts()`/`saveContacts()` using `CONFIG_DIR` from `src/config.ts`, JSON file in `~/.config/silkyway/`. The store file is `orders.json`.

**Step 1: Write the failing tests**

```typescript
// src/orders/__tests__/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadOrders, saveOrders, addOrder, updateOrder, getOrder } from '../store.js';
import type { Order } from '../types.js';

// Use a temp dir so tests don't touch real config
const TEST_DIR = path.join(os.tmpdir(), `silky-orders-test-${Date.now()}`);
const TEST_FILE = path.join(TEST_DIR, 'orders.json');

// We need to mock CONFIG_DIR. Since store.ts imports from config.ts,
// we'll use vitest's module mocking.
import { vi } from 'vitest';

vi.mock('../../config.js', () => ({
  CONFIG_DIR: TEST_DIR,
}));

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'test-order-1',
    intent: {
      chain: 'solana',
      signer: 'BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp',
      action: 'swap',
      from: 'BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp',
      tokenIn: { tokenSymbol: 'USDC' },
      tokenOut: { tokenSymbol: 'SOL' },
      amountIn: '500',
      amountOut: { gte: '5.882' },
    },
    policy: { cooldown: 60 },
    status: 'pending',
    slippage: 0.1,
    createdAt: '2026-03-13T00:00:00.000Z',
    updatedAt: '2026-03-13T00:00:00.000Z',
    history: [],
    ...overrides,
  };
}

describe('Order store', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
    if (fs.existsSync(TEST_DIR)) fs.rmdirSync(TEST_DIR, { recursive: true } as any);
  });

  it('loadOrders returns empty array when file does not exist', () => {
    const store = loadOrders();
    expect(store.orders).toEqual([]);
  });

  it('saveOrders and loadOrders round-trip', () => {
    const order = makeOrder();
    saveOrders({ orders: [order] });
    const loaded = loadOrders();
    expect(loaded.orders).toHaveLength(1);
    expect(loaded.orders[0].id).toBe('test-order-1');
  });

  it('addOrder appends to store', () => {
    const order1 = makeOrder({ id: 'order-1' });
    const order2 = makeOrder({ id: 'order-2' });
    addOrder(order1);
    addOrder(order2);
    const loaded = loadOrders();
    expect(loaded.orders).toHaveLength(2);
  });

  it('getOrder returns order by id', () => {
    addOrder(makeOrder({ id: 'find-me' }));
    const found = getOrder('find-me');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('find-me');
  });

  it('getOrder returns null for non-existent id', () => {
    expect(getOrder('nope')).toBeNull();
  });

  it('updateOrder modifies an existing order', () => {
    addOrder(makeOrder({ id: 'update-me', status: 'pending' }));
    updateOrder('update-me', { status: 'filled' });
    const updated = getOrder('update-me');
    expect(updated!.status).toBe('filled');
  });

  it('updateOrder throws for non-existent id', () => {
    expect(() => updateOrder('nope', { status: 'filled' })).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/orders/__tests__/store.test.ts`
Expected: FAIL — cannot find module `../store.js`

**Step 3: Write the implementation**

```typescript
// src/orders/store.ts
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from '../config.js';
import { SdkError } from '../errors.js';
import type { Order } from './types.js';

const ORDERS_FILE = path.join(CONFIG_DIR, 'orders.json');

export interface OrdersStore {
  orders: Order[];
}

export function loadOrders(): OrdersStore {
  try {
    const raw = fs.readFileSync(ORDERS_FILE, 'utf-8');
    return JSON.parse(raw) as OrdersStore;
  } catch {
    return { orders: [] };
  }
}

export function saveOrders(store: OrdersStore): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export function addOrder(order: Order): void {
  const store = loadOrders();
  store.orders.push(order);
  saveOrders(store);
}

export function getOrder(id: string): Order | null {
  const store = loadOrders();
  return store.orders.find((o) => o.id === id) || null;
}

export function updateOrder(id: string, updates: Partial<Order>): void {
  const store = loadOrders();
  const index = store.orders.findIndex((o) => o.id === id);
  if (index === -1) {
    throw new SdkError('ORDER_NOT_FOUND', `Order "${id}" not found`);
  }
  store.orders[index] = { ...store.orders[index], ...updates, updatedAt: new Date().toISOString() };
  saveOrders(store);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/orders/__tests__/store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orders/store.ts src/orders/__tests__/store.test.ts
git commit -m "feat(orders): add order store with load/save/add/get/update"
```

---

### Task 3: Sugar parser (--sell/--buy/--price → Intent)

**Files:**
- Create: `src/orders/sugar.ts`
- Test: `src/orders/__tests__/sugar.test.ts`

**Context:** The sugar parser converts human-friendly CLI flags into a `SingleIntent` with a `swap` action. The key calculation: `--sell 500 USDC --buy SOL --price 85 --slippage 0.1` → `amountOut.gte = String(500 / 85 * (1 - 0.1/100))`. The `from` and `chain` fields come from the caller (active wallet + current cluster).

**Step 1: Write the failing tests**

```typescript
// src/orders/__tests__/sugar.test.ts
import { describe, it, expect } from 'vitest';
import { parseSwapSugar } from '../sugar.js';

describe('parseSwapSugar', () => {
  const WALLET = 'BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp';

  it('basic limit order: sell USDC buy SOL', () => {
    const intent = parseSwapSugar({
      sellAmount: '500',
      sellSymbol: 'USDC',
      buySymbol: 'SOL',
      price: '85',
      slippage: 0.1,
      from: WALLET,
      chain: 'solana',
    });

    expect(intent.action).toBe('swap');
    expect(intent.chain).toBe('solana');
    expect(intent.signer).toBe(WALLET);
    expect(intent.from).toBe(WALLET);
    expect(intent.tokenIn).toEqual({ tokenSymbol: 'USDC' });
    expect(intent.tokenOut).toEqual({ tokenSymbol: 'SOL' });
    expect(intent.amountIn).toBe('500');

    // 500 / 85 = 5.882352..., minus 0.1% slippage
    // 5.882352... * (1 - 0.001) = 5.876470...
    const amountOut = intent.amountOut as { gte: string };
    expect(amountOut.gte).toBeDefined();
    const minOut = parseFloat(amountOut.gte);
    expect(minOut).toBeGreaterThan(5.87);
    expect(minOut).toBeLessThan(5.89);
  });

  it('respects custom slippage', () => {
    const intent = parseSwapSugar({
      sellAmount: '1000',
      sellSymbol: 'USDC',
      buySymbol: 'SOL',
      price: '100',
      slippage: 1,
      from: WALLET,
      chain: 'solana',
    });

    // 1000 / 100 = 10, minus 1% = 9.9
    const amountOut = intent.amountOut as { gte: string };
    const minOut = parseFloat(amountOut.gte);
    expect(minOut).toBeCloseTo(9.9, 4);
  });

  it('throws on slippage > 10', () => {
    expect(() => parseSwapSugar({
      sellAmount: '500',
      sellSymbol: 'USDC',
      buySymbol: 'SOL',
      price: '85',
      slippage: 11,
      from: WALLET,
      chain: 'solana',
    })).toThrow('INVALID_SLIPPAGE');
  });

  it('throws on slippage < 0', () => {
    expect(() => parseSwapSugar({
      sellAmount: '500',
      sellSymbol: 'USDC',
      buySymbol: 'SOL',
      price: '85',
      slippage: -1,
      from: WALLET,
      chain: 'solana',
    })).toThrow('INVALID_SLIPPAGE');
  });

  it('throws on zero or negative price', () => {
    expect(() => parseSwapSugar({
      sellAmount: '500',
      sellSymbol: 'USDC',
      buySymbol: 'SOL',
      price: '0',
      from: WALLET,
      chain: 'solana',
    })).toThrow('INVALID_PRICE');
  });

  it('throws on zero or negative amount', () => {
    expect(() => parseSwapSugar({
      sellAmount: '0',
      sellSymbol: 'USDC',
      buySymbol: 'SOL',
      price: '85',
      from: WALLET,
      chain: 'solana',
    })).toThrow('INVALID_AMOUNT');
  });

  it('defaults slippage to 0.1 if not provided', () => {
    const intent = parseSwapSugar({
      sellAmount: '500',
      sellSymbol: 'USDC',
      buySymbol: 'SOL',
      price: '85',
      from: WALLET,
      chain: 'solana',
    });

    // 500/85 * (1 - 0.001) = 5.876470...
    const amountOut = intent.amountOut as { gte: string };
    const minOut = parseFloat(amountOut.gte);
    // Compare against 0% slippage: 500/85 = 5.882352...
    expect(minOut).toBeLessThan(5.8824);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/orders/__tests__/sugar.test.ts`
Expected: FAIL — cannot find module `../sugar.js`

**Step 3: Write the implementation**

```typescript
// src/orders/sugar.ts
import type { SingleIntent } from '../intent/types.js';
import { SdkError } from '../errors.js';

const DEFAULT_SLIPPAGE = 0.1;
const MAX_SLIPPAGE = 10;

export interface SwapSugarInput {
  sellAmount: string;
  sellSymbol: string;
  buySymbol: string;
  price: string;
  slippage?: number;
  from: string;
  chain: string;
}

export function parseSwapSugar(input: SwapSugarInput): SingleIntent & { action: 'swap' } {
  const slippage = input.slippage ?? DEFAULT_SLIPPAGE;

  if (slippage < 0 || slippage > MAX_SLIPPAGE) {
    throw new SdkError('INVALID_SLIPPAGE', `Slippage must be between 0 and ${MAX_SLIPPAGE}%. Got: ${slippage}`);
  }

  const sellAmount = parseFloat(input.sellAmount);
  if (!Number.isFinite(sellAmount) || sellAmount <= 0) {
    throw new SdkError('INVALID_AMOUNT', `Sell amount must be positive. Got: ${input.sellAmount}`);
  }

  const price = parseFloat(input.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new SdkError('INVALID_PRICE', `Price must be positive. Got: ${input.price}`);
  }

  const rawOut = sellAmount / price;
  const minOut = rawOut * (1 - slippage / 100);

  // Use enough decimal places to avoid precision loss
  const minOutStr = minOut.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');

  return {
    chain: input.chain,
    signer: input.from,
    action: 'swap',
    from: input.from,
    tokenIn: { tokenSymbol: input.sellSymbol },
    tokenOut: { tokenSymbol: input.buySymbol },
    amountIn: input.sellAmount,
    amountOut: { gte: minOutStr },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/orders/__tests__/sugar.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orders/sugar.ts src/orders/__tests__/sugar.test.ts
git commit -m "feat(orders): add swap sugar parser for human-friendly limit order creation"
```

---

### Task 4: Evaluate function (heartbeat loop)

**Files:**
- Create: `src/orders/evaluate.ts`
- Test: `src/orders/__tests__/evaluate.test.ts`

**Context:** This is the core of the standing orders system. `evaluateOrders()` loads all orders, filters to pending ones that are eligible (not expired, cooldown elapsed, maxAttempts not reached), calls the server for each, verifies returned transactions, and signs+submits. For testability, inject the HTTP client, signer, and clock as dependencies rather than importing them directly.

**Step 1: Write the failing tests**

```typescript
// src/orders/__tests__/evaluate.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Order, EvaluationResult } from '../types.js';
import { evaluateOrders } from '../evaluate.js';

const TEST_DIR = path.join(os.tmpdir(), `silky-eval-test-${Date.now()}`);

vi.mock('../../config.js', () => ({
  CONFIG_DIR: TEST_DIR,
  loadConfig: () => ({
    wallets: [{ label: 'main', address: 'BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp', privateKey: 'fake' }],
    defaultWallet: 'main',
    preferences: {},
    cluster: 'devnet',
    apiKey: 'sw_test',
  }),
  getWallet: () => ({ label: 'main', address: 'BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp', privateKey: 'fake' }),
  getApiUrl: () => 'https://devnet-api.silkyway.ai',
  getApiKey: () => 'sw_test',
}));

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'test-order-1',
    intent: {
      chain: 'solana',
      signer: 'BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp',
      action: 'swap',
      from: 'BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp',
      tokenIn: { tokenSymbol: 'USDC' },
      tokenOut: { tokenSymbol: 'SOL' },
      amountIn: '500',
      amountOut: { gte: '5.882' },
    },
    policy: { cooldown: 60 },
    status: 'pending',
    slippage: 0.1,
    createdAt: '2026-03-13T00:00:00.000Z',
    updatedAt: '2026-03-13T00:00:00.000Z',
    history: [],
    ...overrides,
  };
}

function writeOrders(orders: Order[]) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, 'orders.json'), JSON.stringify({ orders }, null, 2));
}

describe('evaluateOrders', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('skips expired orders and marks them expired', async () => {
    writeOrders([makeOrder({
      id: 'expired-1',
      policy: { expiresAt: '2020-01-01T00:00:00.000Z' },
    })]);

    const results = await evaluateOrders({ dryRun: true });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('expired');
  });

  it('skips orders in cooldown', async () => {
    const recentAttempt = new Date().toISOString();
    writeOrders([makeOrder({
      id: 'cooldown-1',
      policy: { cooldown: 9999 },
      history: [{ timestamp: recentAttempt, type: 'attempted' }],
    })]);

    const results = await evaluateOrders({ dryRun: true });
    expect(results).toHaveLength(0);
  });

  it('marks failed when maxAttempts reached', async () => {
    writeOrders([makeOrder({
      id: 'maxed-out',
      policy: { maxAttempts: 2 },
      history: [
        { timestamp: '2026-03-12T00:00:00.000Z', type: 'attempted' },
        { timestamp: '2026-03-12T01:00:00.000Z', type: 'attempted' },
      ],
    })]);

    const results = await evaluateOrders({ dryRun: true });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('failed');
  });

  it('skips non-pending orders', async () => {
    writeOrders([
      makeOrder({ id: 'filled-1', status: 'filled' }),
      makeOrder({ id: 'cancelled-1', status: 'cancelled' }),
    ]);

    const results = await evaluateOrders({ dryRun: true });
    expect(results).toHaveLength(0);
  });

  it('returns empty results when no orders exist', async () => {
    writeOrders([]);
    const results = await evaluateOrders({ dryRun: true });
    expect(results).toHaveLength(0);
  });

  it('uses price feed to skip when price is not close', async () => {
    writeOrders([makeOrder({ id: 'price-skip' })]);

    const priceFeed = {
      getPrice: vi.fn().mockResolvedValue(120.0), // Way above $85 limit
    };

    const results = await evaluateOrders({ dryRun: true, priceFeed });
    expect(priceFeed.getPrice).toHaveBeenCalled();
    // Should still attempt evaluation in dry run but log the skip
    expect(results).toHaveLength(1);
    expect(results[0].event.type).toBe('attempted');
    expect(results[0].event.reason).toBe('PRICE_PRE_CHECK_SKIP');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/orders/__tests__/evaluate.test.ts`
Expected: FAIL — cannot find module `../evaluate.js`

**Step 3: Write the implementation**

```typescript
// src/orders/evaluate.ts
import { loadOrders, saveOrders } from './store.js';
import type { Order, OrderEvent, EvaluationResult, PriceFeed } from './types.js';
import type { SwapIntent } from '../intent/types.js';

export interface EvaluateOptions {
  dryRun?: boolean;
  priceFeed?: PriceFeed;
  /** Override for testing — async function that calls the server. If not provided, uses the real HTTP client. */
  serverEvaluate?: (order: Order) => Promise<ServerEvaluateResponse>;
  /** Override for testing — function that signs and submits a transaction. */
  signAndSubmit?: (txBase64: string, order: Order) => Promise<string>;
  /** Override for testing — function that verifies an intent against a transaction. */
  verifyTransaction?: (txBase64: string, order: Order) => Promise<{ matched: boolean; discrepancies: string[] }>;
  /** Override for time source — defaults to Date.now(). */
  now?: () => number;
}

export interface ServerEvaluateResponse {
  executable: boolean;
  transaction?: string;
  quote?: { price: string; amountIn: string; amountOut: string };
  reason?: string;
  detail?: string;
}

function nowMs(opts: EvaluateOptions): number {
  return opts.now ? opts.now() : Date.now();
}

function isExpired(order: Order, now: number): boolean {
  if (!order.policy.expiresAt) return false;
  return new Date(order.policy.expiresAt).getTime() <= now;
}

function isInCooldown(order: Order, now: number): boolean {
  const cooldown = order.policy.cooldown ?? 60;
  const lastAttempt = [...order.history].reverse().find((e) => e.type === 'attempted' || e.type === 'filled' || e.type === 'failed');
  if (!lastAttempt) return false;
  const elapsed = (now - new Date(lastAttempt.timestamp).getTime()) / 1000;
  return elapsed < cooldown;
}

function attemptCount(order: Order): number {
  return order.history.filter((e) => e.type === 'attempted').length;
}

function makeEvent(type: OrderEvent['type'], extra: Partial<OrderEvent> = {}): OrderEvent {
  return { timestamp: new Date().toISOString(), type, ...extra };
}

/** Extract price target from a swap intent for pre-check comparison. */
function getSwapPriceTarget(order: Order): { base: string; quote: string; maxPrice: number } | null {
  const intent = order.intent as any;
  if (intent.action !== 'swap') return null;

  const tokenIn = intent.tokenIn?.tokenSymbol;
  const tokenOut = intent.tokenOut?.tokenSymbol;
  if (!tokenIn || !tokenOut) return null;

  const amountIn = parseFloat(intent.amountIn);
  const amountOutGte = intent.amountOut?.gte ? parseFloat(intent.amountOut.gte) : null;
  if (!amountIn || !amountOutGte || amountOutGte <= 0) return null;

  // maxPrice = amountIn / amountOutGte (e.g., 500 USDC / 5.882 SOL = ~85 USDC/SOL)
  return { base: tokenOut, quote: tokenIn, maxPrice: amountIn / amountOutGte };
}

export async function evaluateOrders(opts: EvaluateOptions = {}): Promise<EvaluationResult[]> {
  const store = loadOrders();
  const results: EvaluationResult[] = [];
  const now = nowMs(opts);
  let modified = false;

  for (const order of store.orders) {
    if (order.status !== 'pending') continue;

    // Check expiry
    if (isExpired(order, now)) {
      order.status = 'expired';
      order.updatedAt = new Date(now).toISOString();
      const event = makeEvent('expired', { detail: `Expired at ${order.policy.expiresAt}` });
      order.history.push(event);
      results.push({ orderId: order.id, status: 'expired', event });
      modified = true;
      continue;
    }

    // Check cooldown
    if (isInCooldown(order, now)) continue;

    // Check maxAttempts
    if (order.policy.maxAttempts !== undefined && attemptCount(order) >= order.policy.maxAttempts) {
      order.status = 'failed';
      order.updatedAt = new Date(now).toISOString();
      const event = makeEvent('failed', { reason: 'MAX_ATTEMPTS', detail: `Reached ${order.policy.maxAttempts} attempts` });
      order.history.push(event);
      results.push({ orderId: order.id, status: 'failed', event });
      modified = true;
      continue;
    }

    // Optional price pre-check
    if (opts.priceFeed) {
      const target = getSwapPriceTarget(order);
      if (target) {
        const currentPrice = await opts.priceFeed.getPrice(target.base, target.quote);
        if (currentPrice !== null && currentPrice > target.maxPrice * 1.05) {
          // Price is more than 5% away — skip server call
          const event = makeEvent('attempted', { reason: 'PRICE_PRE_CHECK_SKIP', detail: `Current ${target.quote}/${target.base}: ${currentPrice}, need ≤ ${target.maxPrice.toFixed(2)}` });
          order.history.push(event);
          order.updatedAt = new Date(now).toISOString();
          results.push({ orderId: order.id, status: 'pending', event });
          modified = true;
          continue;
        }
      }
    }

    // Dry run stops here
    if (opts.dryRun) {
      const event = makeEvent('attempted', { reason: 'DRY_RUN', detail: 'Would evaluate against server' });
      results.push({ orderId: order.id, status: 'pending', event });
      continue;
    }

    // Call server
    if (!opts.serverEvaluate) continue; // No server function provided — skip
    try {
      const response = await opts.serverEvaluate(order);

      if (!response.executable || !response.transaction) {
        const event = makeEvent('attempted', { reason: response.reason, detail: response.detail });
        order.history.push(event);
        order.updatedAt = new Date(now).toISOString();
        results.push({ orderId: order.id, status: 'pending', event });
        modified = true;
        continue;
      }

      // Transaction returned — set executing
      order.status = 'executing';
      order.updatedAt = new Date(now).toISOString();
      modified = true;

      // Verify
      if (opts.verifyTransaction) {
        const verification = await opts.verifyTransaction(response.transaction, order);
        if (!verification.matched) {
          order.status = 'pending';
          const event = makeEvent('attempted', { reason: 'VERIFICATION_FAILED', detail: verification.discrepancies.join('; ') });
          order.history.push(event);
          order.updatedAt = new Date(now).toISOString();
          results.push({ orderId: order.id, status: 'pending', event });
          continue;
        }
      }

      // Sign and submit
      if (opts.signAndSubmit) {
        const txid = await opts.signAndSubmit(response.transaction, order);
        order.status = 'filled';
        order.updatedAt = new Date(now).toISOString();
        const event = makeEvent('filled', { txid, detail: response.quote ? `Price: ${response.quote.price}` : undefined });
        order.history.push(event);
        results.push({ orderId: order.id, status: 'filled', event });

        // Handle recurrence
        if (order.policy.recurrence) {
          const remaining = order.policy.recurrence.remaining;
          if (remaining === undefined || remaining > 1) {
            const clone: Order = {
              ...JSON.parse(JSON.stringify(order)),
              id: `${order.id}-r${Date.now()}`,
              status: 'pending' as const,
              history: [makeEvent('created', { detail: `Recurring from ${order.id}` })],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            if (remaining !== undefined) {
              clone.policy.recurrence = { ...order.policy.recurrence, remaining: remaining - 1 };
            }
            store.orders.push(clone);
          }
        }
      }
    } catch (err) {
      order.status = 'pending';
      const message = err instanceof Error ? err.message : String(err);
      const event = makeEvent('attempted', { reason: 'SERVER_ERROR', detail: message });
      order.history.push(event);
      order.updatedAt = new Date(now).toISOString();
      results.push({ orderId: order.id, status: 'pending', event });
      modified = true;
    }
  }

  if (modified) {
    saveOrders(store);
  }

  return results;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/orders/__tests__/evaluate.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orders/evaluate.ts src/orders/__tests__/evaluate.test.ts
git commit -m "feat(orders): add evaluateOrders heartbeat loop with dry-run and price pre-check"
```

---

### Task 5: Orders module public API

**Files:**
- Create: `src/orders/index.ts`
- Modify: `src/index.ts` (add orders re-exports)

**Step 1: Write the index file**

```typescript
// src/orders/index.ts
export type { Order, OrderStatus, ExecutionPolicy, OrderEvent, EvaluationResult, PriceFeed } from './types.js';
export type { OrdersStore } from './store.js';
export { loadOrders, saveOrders, addOrder, getOrder, updateOrder } from './store.js';
export { evaluateOrders } from './evaluate.js';
export type { EvaluateOptions, ServerEvaluateResponse } from './evaluate.js';
export { parseSwapSugar } from './sugar.js';
export type { SwapSugarInput } from './sugar.js';
```

**Step 2: Add exports to `src/index.ts`**

Append after the existing intent framework exports at the bottom of `src/index.ts`:

```typescript
// Standing orders
export {
  loadOrders, saveOrders, addOrder, getOrder, updateOrder,
  evaluateOrders,
  parseSwapSugar,
} from './orders/index.js';
export type {
  Order, OrderStatus, ExecutionPolicy, OrderEvent, EvaluationResult, PriceFeed,
  OrdersStore, EvaluateOptions, ServerEvaluateResponse, SwapSugarInput,
} from './orders/index.js';
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No TypeScript compilation errors.

**Step 4: Commit**

```bash
git add src/orders/index.ts src/index.ts
git commit -m "feat(orders): add public API exports for orders module"
```

---

### Task 6: CLI commands — create, list, get, cancel

**Files:**
- Create: `src/commands/orders.ts`
- Modify: `src/cli.ts` (register the `orders` command group)

**Step 1: Write the CLI command implementations**

```typescript
// src/commands/orders.ts
import { randomUUID } from 'node:crypto';
import { loadConfig, getWallet, getApiUrl, getApiKey } from '../config.js';
import { addOrder, getOrder, updateOrder, loadOrders } from '../orders/store.js';
import { parseSwapSugar } from '../orders/sugar.js';
import { evaluateOrders } from '../orders/evaluate.js';
import { createHttpClient } from '../client.js';
import { verifyIntent as verifyIntentV2 } from '../intent/index.js';
import { outputSuccess } from '../output.js';
import { SdkError } from '../errors.js';
import { Keypair, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import type { Order, OrderEvent, ServerEvaluateResponse } from '../orders/types.js';
import type { Intent } from '../intent/types.js';

const DEFAULT_SLIPPAGE = 0.1;
const MAX_SLIPPAGE = 10;

export async function ordersCreate(intentOrAction: string, opts: {
  sell?: string;
  buy?: string;
  price?: string;
  slippage?: string;
  expires?: string;
  cooldown?: string;
  maxAttempts?: string;
  wallet?: string;
}) {
  const config = loadConfig();
  const wallet = getWallet(config, opts.wallet);
  const slippage = opts.slippage ? parseFloat(opts.slippage) : DEFAULT_SLIPPAGE;

  if (slippage < 0 || slippage > MAX_SLIPPAGE) {
    throw new SdkError('INVALID_SLIPPAGE', `Slippage must be between 0 and ${MAX_SLIPPAGE}%. Got: ${slippage}`);
  }

  let intent: Intent;

  // Try JSON parse first (agent path)
  try {
    intent = JSON.parse(intentOrAction) as Intent;
  } catch {
    // Sugar path: intentOrAction is the action name (e.g., "swap")
    if (intentOrAction !== 'swap') {
      throw new SdkError('UNSUPPORTED_ACTION', `Sugar syntax only supports "swap". Got: "${intentOrAction}". Use JSON for other actions.`);
    }

    if (!opts.sell || !opts.buy || !opts.price) {
      throw new SdkError('MISSING_FIELD', 'swap sugar requires --sell "<amount> <symbol>", --buy "<symbol>", and --price "<number>"');
    }

    const sellParts = opts.sell.split(/\s+/);
    if (sellParts.length !== 2) {
      throw new SdkError('INVALID_SELL', '--sell must be "<amount> <symbol>" (e.g., --sell "500 USDC")');
    }

    const chain = `solana${config.cluster === 'devnet' ? ':devnet' : ''}`;

    intent = parseSwapSugar({
      sellAmount: sellParts[0],
      sellSymbol: sellParts[1],
      buySymbol: opts.buy,
      price: opts.price,
      slippage,
      from: wallet.address,
      chain,
    });
  }

  const now = new Date().toISOString();
  const order: Order = {
    id: randomUUID(),
    intent,
    policy: {
      cooldown: opts.cooldown ? parseInt(opts.cooldown, 10) : 60,
      maxAttempts: opts.maxAttempts ? parseInt(opts.maxAttempts, 10) : undefined,
      expiresAt: opts.expires ? parseExpiry(opts.expires) : undefined,
    },
    status: 'pending',
    slippage,
    wallet: opts.wallet,
    createdAt: now,
    updatedAt: now,
    history: [{ timestamp: now, type: 'created' }],
  };

  addOrder(order);
  outputSuccess({ action: 'order_created', orderId: order.id, status: order.status });
}

export async function ordersList(opts: { status?: string }) {
  const store = loadOrders();
  let orders = store.orders;

  if (opts.status) {
    orders = orders.filter((o) => o.status === opts.status);
  }

  const summary = orders.map((o) => ({
    id: o.id,
    action: (o.intent as any).action || 'unknown',
    status: o.status,
    slippage: o.slippage,
    createdAt: o.createdAt,
    lastEvent: o.history.length > 0 ? o.history[o.history.length - 1].type : null,
  }));

  outputSuccess({ orders: summary });
}

export async function ordersGet(orderId: string) {
  const order = getOrder(orderId);
  if (!order) {
    throw new SdkError('ORDER_NOT_FOUND', `Order "${orderId}" not found`);
  }
  outputSuccess({ order });
}

export async function ordersCancel(orderId: string) {
  const order = getOrder(orderId);
  if (!order) {
    throw new SdkError('ORDER_NOT_FOUND', `Order "${orderId}" not found`);
  }
  if (order.status !== 'pending') {
    throw new SdkError('ORDER_NOT_PENDING', `Order "${orderId}" is ${order.status}, not pending`);
  }
  updateOrder(orderId, {
    status: 'cancelled',
    history: [...order.history, { timestamp: new Date().toISOString(), type: 'cancelled' }],
  });
  outputSuccess({ action: 'order_cancelled', orderId });
}

export async function ordersEvaluate(opts: { dryRun?: boolean; wallet?: string }) {
  const config = loadConfig();
  const wallet = getWallet(config, opts.wallet);
  const apiUrl = getApiUrl(config);
  const apiKey = getApiKey(config);

  const client = createHttpClient({ baseUrl: apiUrl, apiKey });

  const results = await evaluateOrders({
    dryRun: opts.dryRun,
    serverEvaluate: async (order: Order): Promise<ServerEvaluateResponse> => {
      const res = await client.post('/api/orders/evaluate', {
        intent: order.intent,
        slippage: order.slippage,
        wallet: wallet.address,
      });
      const data = res.data.data;
      if (data.transaction) {
        return { executable: true, transaction: data.transaction, quote: data.quote };
      }
      return { executable: false, reason: data.reason, detail: data.detail };
    },
    verifyTransaction: async (txBase64: string, order: Order) => {
      const result = await verifyIntentV2(txBase64, order.intent);
      return { matched: result.matched, discrepancies: result.discrepancies };
    },
    signAndSubmit: async (txBase64: string, _order: Order) => {
      const tx = Transaction.from(Buffer.from(txBase64, 'base64'));
      const keypair = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
      tx.sign(keypair);
      const submitRes = await client.post('/api/tx/submit', {
        signedTx: tx.serialize().toString('base64'),
      });
      return submitRes.data.data.txid;
    },
  });

  outputSuccess({ action: 'orders_evaluated', results });
}

function parseExpiry(value: string): string {
  // Support relative durations: 1h, 7d, 30m
  const match = value.match(/^(\d+)(m|h|d)$/);
  if (match) {
    const num = parseInt(match[1], 10);
    const unit = match[2];
    const ms = unit === 'm' ? num * 60000 : unit === 'h' ? num * 3600000 : num * 86400000;
    return new Date(Date.now() + ms).toISOString();
  }
  // Otherwise treat as ISO date
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new SdkError('INVALID_EXPIRY', `Cannot parse expiry: "${value}". Use relative (7d, 24h, 30m) or ISO date.`);
  }
  return date.toISOString();
}
```

**Step 2: Register commands in `src/cli.ts`**

Add import at the top of `src/cli.ts` alongside the other command imports:

```typescript
import { ordersCreate, ordersList, ordersGet, ordersCancel, ordersEvaluate } from './commands/orders.js';
```

Add command group before `program.parse()`:

```typescript
// orders commands
const orders = program.command('orders').description('Manage standing orders');
orders
  .command('create')
  .argument('<intent-or-action>', 'JSON intent string or action name (e.g., "swap")')
  .option('--sell <amount-symbol>', 'Sell amount and symbol (e.g., "500 USDC")')
  .option('--buy <symbol>', 'Buy token symbol (e.g., "SOL")')
  .option('--price <number>', 'Target price')
  .option('--slippage <percent>', 'Max slippage percent (default: 0.1, max: 10)')
  .option('--expires <duration>', 'Expiry (e.g., "7d", "24h", "30m", or ISO date)')
  .option('--cooldown <seconds>', 'Seconds between attempts (default: 60)')
  .option('--max-attempts <number>', 'Max evaluation attempts')
  .option('--wallet <label>', 'Wallet to use')
  .description('Create a standing order from JSON intent or swap sugar')
  .action(wrapCommand(ordersCreate));
orders
  .command('list')
  .option('--status <status>', 'Filter by status')
  .description('List all standing orders')
  .action(wrapCommand(ordersList));
orders
  .command('get')
  .argument('<orderId>', 'Order ID')
  .description('Get order details')
  .action(wrapCommand(ordersGet));
orders
  .command('cancel')
  .argument('<orderId>', 'Order ID')
  .description('Cancel a pending order')
  .action(wrapCommand(ordersCancel));
orders
  .command('evaluate')
  .option('--dry-run', 'Show what would happen without executing')
  .option('--wallet <label>', 'Wallet to use')
  .description('Evaluate all pending orders (run on heartbeat)')
  .action(wrapCommand(ordersEvaluate));
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No compilation errors.

**Step 4: Verify CLI help shows orders**

Run: `node dist/cli.js orders --help`
Expected: Shows create, list, get, cancel, evaluate subcommands.

**Step 5: Commit**

```bash
git add src/commands/orders.ts src/cli.ts
git commit -m "feat(orders): add CLI commands — create, list, get, cancel, evaluate"
```

---

### Task 7: Integration test — full order lifecycle

**Files:**
- Create: `src/orders/__tests__/lifecycle.test.ts`

**Context:** Test the full flow: create an order, check it's pending, evaluate it (with mocked server returning "conditions not met"), verify it stays pending, evaluate again (server returns a tx), verify it fills.

**Step 1: Write the test**

```typescript
// src/orders/__tests__/lifecycle.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { addOrder, getOrder, updateOrder, loadOrders } from '../store.js';
import { evaluateOrders } from '../evaluate.js';
import type { Order } from '../types.js';

const TEST_DIR = path.join(os.tmpdir(), `silky-lifecycle-test-${Date.now()}`);

vi.mock('../../config.js', () => ({
  CONFIG_DIR: TEST_DIR,
  loadConfig: () => ({
    wallets: [{ label: 'main', address: 'BrKz4GQN', privateKey: 'fake' }],
    defaultWallet: 'main',
    preferences: {},
    cluster: 'devnet',
    apiKey: 'sw_test',
  }),
  getWallet: () => ({ label: 'main', address: 'BrKz4GQN', privateKey: 'fake' }),
  getApiUrl: () => 'https://devnet-api.silkyway.ai',
  getApiKey: () => 'sw_test',
}));

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'lifecycle-1',
    intent: {
      chain: 'solana',
      signer: 'BrKz4GQN',
      action: 'swap',
      from: 'BrKz4GQN',
      tokenIn: { tokenSymbol: 'USDC' },
      tokenOut: { tokenSymbol: 'SOL' },
      amountIn: '500',
      amountOut: { gte: '5.882' },
    },
    policy: { cooldown: 0 },
    status: 'pending',
    slippage: 0.1,
    createdAt: '2026-03-13T00:00:00.000Z',
    updatedAt: '2026-03-13T00:00:00.000Z',
    history: [{ timestamp: '2026-03-13T00:00:00.000Z', type: 'created' }],
    ...overrides,
  };
}

describe('Order lifecycle', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('create → attempt (not fillable) → attempt (fillable) → filled', async () => {
    // 1. Create order
    const order = makeOrder();
    addOrder(order);
    expect(getOrder('lifecycle-1')!.status).toBe('pending');

    // 2. First evaluation — server says not fillable
    let callCount = 0;
    const serverEvaluate = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { executable: false, reason: 'PRICE_OUT_OF_RANGE', detail: 'SOL at 120' };
      }
      return { executable: true, transaction: 'fakeTxBase64', quote: { price: '84.90', amountIn: '500', amountOut: '5.889' } };
    });

    const verifyTransaction = vi.fn().mockResolvedValue({ matched: true, discrepancies: [] });
    const signAndSubmit = vi.fn().mockResolvedValue('txid123');

    const results1 = await evaluateOrders({ serverEvaluate, verifyTransaction, signAndSubmit });
    expect(results1).toHaveLength(1);
    expect(results1[0].status).toBe('pending');
    expect(results1[0].event.reason).toBe('PRICE_OUT_OF_RANGE');

    // Order is still pending with one attempt logged
    const afterFirst = getOrder('lifecycle-1')!;
    expect(afterFirst.status).toBe('pending');
    expect(afterFirst.history.filter((e) => e.type === 'attempted')).toHaveLength(1);

    // 3. Second evaluation — server returns tx, verification passes, fills
    const results2 = await evaluateOrders({ serverEvaluate, verifyTransaction, signAndSubmit });
    expect(results2).toHaveLength(1);
    expect(results2[0].status).toBe('filled');
    expect(results2[0].event.txid).toBe('txid123');

    // Order is now filled
    const afterSecond = getOrder('lifecycle-1')!;
    expect(afterSecond.status).toBe('filled');
  });

  it('verification failure keeps order pending', async () => {
    addOrder(makeOrder());

    const results = await evaluateOrders({
      serverEvaluate: vi.fn().mockResolvedValue({ executable: true, transaction: 'fakeTx' }),
      verifyTransaction: vi.fn().mockResolvedValue({ matched: false, discrepancies: ['Recipient mismatch'] }),
      signAndSubmit: vi.fn(),
    });

    expect(results[0].status).toBe('pending');
    expect(results[0].event.reason).toBe('VERIFICATION_FAILED');
    expect(getOrder('lifecycle-1')!.status).toBe('pending');
  });

  it('cancel sets status to cancelled', () => {
    addOrder(makeOrder());
    updateOrder('lifecycle-1', {
      status: 'cancelled',
      history: [...makeOrder().history, { timestamp: new Date().toISOString(), type: 'cancelled' as const }],
    });
    expect(getOrder('lifecycle-1')!.status).toBe('cancelled');
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/orders/__tests__/lifecycle.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/orders/__tests__/lifecycle.test.ts
git commit -m "test(orders): add integration test for full order lifecycle"
```

---

### Task 8: Final verification

**Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass, including existing verify and intent tests.

**Step 2: Build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 3: Verify CLI**

Run: `node dist/cli.js orders --help`
Expected: Shows all subcommands with descriptions.

Run: `node dist/cli.js orders list`
Expected: `{"ok":true,"data":{"orders":[]}}`

**Step 4: Commit any fixes**

If anything broke, fix and commit with an appropriate message.
