# Cross-Chain Intent Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Solana-specific `Intent` type with a chain-agnostic intent framework supporting constraints, compound intents, confidence tiers, and extensible actions.

**Architecture:** New `src/intent/` module alongside the existing `src/verify/`. The intent module defines types, the constraint evaluator, token resolution, and the chain-agnostic matcher. The existing Solana-specific `src/verify/` becomes a "chain adapter" that the intent matcher calls into. The old `Intent` type and `verifyIntent` function remain as deprecated wrappers for backwards compatibility.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), Vitest for testing. No new dependencies.

**Design doc:** `docs/plans/2026-03-04-cross-chain-intent-framework.md`

---

### Task 1: Define core intent types

**Files:**
- Create: `src/intent/types.ts`
- Test: `src/intent/__tests__/types.test.ts`

**Step 1: Write the failing test**

Create `src/intent/__tests__/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type {
  Intent,
  SingleIntent,
  CompoundIntent,
  TransferIntent,
  SwapIntent,
  Constraint,
  VerifyResult,
} from '../types.js';

describe('Intent types', () => {
  it('single transfer intent is assignable', () => {
    const intent: Intent = {
      chain: 'solana',
      action: 'transfer',
      from: 'AgXx...w1',
      to: 'BobA...c2',
      amount: 100,
      tokenSymbol: 'USDC',
    };
    expect(intent.chain).toBe('solana');
  });

  it('compound intent with actions array is assignable', () => {
    const intent: Intent = {
      chain: 'ethereum',
      actions: [
        { action: 'withdraw', from: '0xAlice', amount: 100, tokenSymbol: 'USDC' },
        { action: 'transfer', from: '0xAlice', to: '0xBob', amount: 100, tokenSymbol: 'USDC' },
      ],
    };
    expect('actions' in intent).toBe(true);
  });

  it('constraint amount is assignable', () => {
    const intent: Intent = {
      chain: 'ethereum',
      action: 'swap',
      from: '0xAlice',
      tokenIn: { tokenSymbol: 'ETH' },
      tokenOut: { tokenSymbol: 'USDC' },
      amountIn: 0.5,
      amountOut: { gte: 1000 },
    };
    expect(intent.chain).toBe('ethereum');
  });

  it('custom action intent is assignable', () => {
    const intent: Intent = {
      chain: 'ethereum',
      action: 'flashLoan',
      from: '0xAlice',
      amount: 10000,
      protocol: 'aave',
    };
    expect(intent.action).toBe('flashLoan');
  });

  it('strict mode is optional and defaults conceptually to false', () => {
    const intent: Intent = {
      chain: 'solana',
      strict: true,
      action: 'transfer',
      from: 'AgXx',
      to: 'BobA',
      amount: 50,
      tokenSymbol: 'USDC',
    };
    expect(intent.strict).toBe(true);
  });

  it('chain with network suffix is valid', () => {
    const intent: Intent = {
      chain: 'solana:devnet',
      action: 'transfer',
      from: 'AgXx',
      to: 'BobA',
      amount: 100,
      tokenSymbol: 'USDC',
    };
    expect(intent.chain).toBe('solana:devnet');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/intent/__tests__/types.test.ts`
Expected: FAIL — module `../types.js` does not exist.

**Step 3: Write minimal implementation**

Create `src/intent/types.ts`:

```typescript
// ─── Constraints ──────────────────────────────────────────────

export type Constraint<T> = T | {
  gte?: T;
  lte?: T;
  gt?: T;
  lt?: T;
};

// ─── Token identification ─────────────────────────────────────

export type TokenRef = {
  tokenSymbol?: string;
  token?: string;
};

// ─── Known actions ────────────────────────────────────────────

export type TransferIntent = {
  action: 'transfer';
  from: string;
  to: string;
  amount: Constraint<number>;
  memo?: string;
} & TokenRef;

export type SwapIntent = {
  action: 'swap';
  from: string;
  tokenIn: TokenRef;
  tokenOut: TokenRef;
  amountIn?: Constraint<number>;
  amountOut?: Constraint<number>;
  slippage?: number;
};

export type StakeIntent = {
  action: 'stake';
  from: string;
  amount: Constraint<number>;
  validator?: string;
  protocol?: string;
} & TokenRef;

export type LendIntent = {
  action: 'lend';
  from: string;
  amount: Constraint<number>;
  protocol?: string;
} & TokenRef;

export type BorrowIntent = {
  action: 'borrow';
  from: string;
  amount: Constraint<number>;
  protocol?: string;
} & TokenRef;

export type ApproveIntent = {
  action: 'approve';
  owner: string;
  spender: string;
  amount: Constraint<number>;
} & TokenRef;

export type WithdrawIntent = {
  action: 'withdraw';
  from: string;
  amount: Constraint<number>;
  protocol?: string;
} & TokenRef;

// ─── Unknown / custom actions ─────────────────────────────────

export type CustomIntent = {
  action: string;
  [key: string]: unknown;
};

// ─── Action union ─────────────────────────────────────────────

export type ActionIntent =
  | TransferIntent
  | SwapIntent
  | StakeIntent
  | LendIntent
  | BorrowIntent
  | ApproveIntent
  | WithdrawIntent
  | CustomIntent;

// ─── Single and compound intents ──────────────────────────────

export type SingleIntent = {
  chain: string;
  strict?: boolean;
} & ActionIntent;

export type CompoundIntent = {
  chain: string;
  strict?: boolean;
  actions: ActionIntent[];
};

export type Intent = SingleIntent | CompoundIntent;

// ─── Result ───────────────────────────────────────────────────

export type Confidence = 'full' | 'partial' | 'unverified';

export interface VerifyResult {
  matched: boolean;
  confidence: Confidence;
  discrepancies: string[];
  analysis: TransactionAnalysis;
}

// ─── Re-export analysis types from verify module ──────────────

export type { TransactionAnalysis, InstructionAnalysis, RiskFlag } from '../verify/index.js';
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/intent/__tests__/types.test.ts`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add src/intent/types.ts src/intent/__tests__/types.test.ts
git commit -m "feat(intent): add core cross-chain intent types"
```

---

### Task 2: Implement constraint evaluator

**Files:**
- Create: `src/intent/constraints.ts`
- Test: `src/intent/__tests__/constraints.test.ts`

**Step 1: Write the failing test**

Create `src/intent/__tests__/constraints.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { evaluateConstraint } from '../constraints.js';

describe('evaluateConstraint', () => {
  it('exact number match returns true', () => {
    expect(evaluateConstraint(100, 100)).toBe(true);
  });

  it('exact number mismatch returns false', () => {
    expect(evaluateConstraint(100, 200)).toBe(false);
  });

  it('exact match with default tolerance (0.01%)', () => {
    // 100.005 is within 0.01% of 100
    expect(evaluateConstraint(100, 100.005)).toBe(true);
  });

  it('exact match outside default tolerance', () => {
    // 101 is 1% off from 100 — outside 0.01%
    expect(evaluateConstraint(100, 101)).toBe(false);
  });

  it('gte constraint passes when actual >= expected', () => {
    expect(evaluateConstraint({ gte: 100 }, 100)).toBe(true);
    expect(evaluateConstraint({ gte: 100 }, 150)).toBe(true);
  });

  it('gte constraint fails when actual < expected', () => {
    expect(evaluateConstraint({ gte: 100 }, 99)).toBe(false);
  });

  it('lte constraint passes when actual <= expected', () => {
    expect(evaluateConstraint({ lte: 100 }, 100)).toBe(true);
    expect(evaluateConstraint({ lte: 100 }, 50)).toBe(true);
  });

  it('lte constraint fails when actual > expected', () => {
    expect(evaluateConstraint({ lte: 100 }, 101)).toBe(false);
  });

  it('gt constraint passes when actual > expected', () => {
    expect(evaluateConstraint({ gt: 100 }, 101)).toBe(true);
  });

  it('gt constraint fails when actual <= expected', () => {
    expect(evaluateConstraint({ gt: 100 }, 100)).toBe(false);
  });

  it('lt constraint passes when actual < expected', () => {
    expect(evaluateConstraint({ lt: 100 }, 99)).toBe(true);
  });

  it('lt constraint fails when actual >= expected', () => {
    expect(evaluateConstraint({ lt: 100 }, 100)).toBe(false);
  });

  it('combined gte+lte (range) passes when within range', () => {
    expect(evaluateConstraint({ gte: 50, lte: 150 }, 100)).toBe(true);
  });

  it('combined gte+lte fails when outside range', () => {
    expect(evaluateConstraint({ gte: 50, lte: 150 }, 200)).toBe(false);
    expect(evaluateConstraint({ gte: 50, lte: 150 }, 10)).toBe(false);
  });

  it('exact match with zero uses exact comparison', () => {
    expect(evaluateConstraint(0, 0)).toBe(true);
    expect(evaluateConstraint(0, 0.001)).toBe(false);
  });

  it('custom tolerance overrides default', () => {
    // 101 is 1% off from 100. With 2% tolerance, should pass.
    expect(evaluateConstraint(100, 101, 0.02)).toBe(true);
    // With 0.5% tolerance, should fail.
    expect(evaluateConstraint(100, 101, 0.005)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/intent/__tests__/constraints.test.ts`
Expected: FAIL — module `../constraints.js` does not exist.

**Step 3: Write minimal implementation**

Create `src/intent/constraints.ts`:

```typescript
import type { Constraint } from './types.js';

const DEFAULT_TOLERANCE = 0.0001; // 0.01%

/**
 * Evaluate whether an actual value satisfies a constraint.
 *
 * - Plain value: exact match within tolerance (for numbers).
 * - Object with gte/lte/gt/lt: each specified bound is checked.
 */
export function evaluateConstraint(
  constraint: Constraint<number>,
  actual: number,
  tolerance: number = DEFAULT_TOLERANCE,
): boolean {
  if (typeof constraint === 'number') {
    return numbersMatch(constraint, actual, tolerance);
  }

  if (constraint.gte !== undefined && actual < constraint.gte) return false;
  if (constraint.lte !== undefined && actual > constraint.lte) return false;
  if (constraint.gt !== undefined && actual <= constraint.gt) return false;
  if (constraint.lt !== undefined && actual >= constraint.lt) return false;

  return true;
}

function numbersMatch(expected: number, actual: number, tolerance: number): boolean {
  if (expected === 0) return actual === 0;
  const diff = Math.abs(actual - expected) / Math.abs(expected);
  return diff <= tolerance;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/intent/__tests__/constraints.test.ts`
Expected: PASS (16 tests)

**Step 5: Commit**

```bash
git add src/intent/constraints.ts src/intent/__tests__/constraints.test.ts
git commit -m "feat(intent): add constraint evaluator with tolerance support"
```

---

### Task 3: Implement chain parser and address normalization

**Files:**
- Create: `src/intent/chains.ts`
- Test: `src/intent/__tests__/chains.test.ts`

**Step 1: Write the failing test**

Create `src/intent/__tests__/chains.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseChain, normalizeAddress, isEvmChain } from '../chains.js';

describe('parseChain', () => {
  it('parses chain without network as mainnet', () => {
    expect(parseChain('solana')).toEqual({ chain: 'solana', network: 'mainnet' });
  });

  it('parses chain with network suffix', () => {
    expect(parseChain('solana:devnet')).toEqual({ chain: 'solana', network: 'devnet' });
  });

  it('parses ethereum with sepolia', () => {
    expect(parseChain('ethereum:sepolia')).toEqual({ chain: 'ethereum', network: 'sepolia' });
  });

  it('parses base without network', () => {
    expect(parseChain('base')).toEqual({ chain: 'base', network: 'mainnet' });
  });

  it('normalizes chain name to lowercase', () => {
    expect(parseChain('SOLANA')).toEqual({ chain: 'solana', network: 'mainnet' });
    expect(parseChain('Ethereum:Sepolia')).toEqual({ chain: 'ethereum', network: 'sepolia' });
  });
});

describe('isEvmChain', () => {
  it('returns true for evm chains', () => {
    expect(isEvmChain('ethereum')).toBe(true);
    expect(isEvmChain('base')).toBe(true);
    expect(isEvmChain('polygon')).toBe(true);
    expect(isEvmChain('arbitrum')).toBe(true);
  });

  it('returns false for non-evm chains', () => {
    expect(isEvmChain('solana')).toBe(false);
  });
});

describe('normalizeAddress', () => {
  it('lowercases EVM addresses for comparison', () => {
    const addr = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    expect(normalizeAddress(addr, 'ethereum')).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  });

  it('preserves Solana address case', () => {
    const addr = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    expect(normalizeAddress(addr, 'solana')).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  });

  it('lowercases for all EVM-family chains', () => {
    const addr = '0xAbCdEf';
    expect(normalizeAddress(addr, 'base')).toBe('0xabcdef');
    expect(normalizeAddress(addr, 'polygon')).toBe('0xabcdef');
    expect(normalizeAddress(addr, 'arbitrum')).toBe('0xabcdef');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/intent/__tests__/chains.test.ts`
Expected: FAIL — module `../chains.js` does not exist.

**Step 3: Write minimal implementation**

Create `src/intent/chains.ts`:

```typescript
const EVM_CHAINS = new Set([
  'ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc', 'gnosis', 'zksync', 'scroll', 'linea', 'mantle',
]);

export interface ParsedChain {
  chain: string;
  network: string;
}

export function parseChain(chainStr: string): ParsedChain {
  const lower = chainStr.toLowerCase();
  const colonIndex = lower.indexOf(':');
  if (colonIndex === -1) {
    return { chain: lower, network: 'mainnet' };
  }
  return {
    chain: lower.slice(0, colonIndex),
    network: lower.slice(colonIndex + 1),
  };
}

export function isEvmChain(chain: string): boolean {
  return EVM_CHAINS.has(chain.toLowerCase());
}

export function normalizeAddress(address: string, chain: string): string {
  if (isEvmChain(chain)) {
    return address.toLowerCase();
  }
  return address;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/intent/__tests__/chains.test.ts`
Expected: PASS (11 tests)

**Step 5: Commit**

```bash
git add src/intent/chains.ts src/intent/__tests__/chains.test.ts
git commit -m "feat(intent): add chain parser and address normalization"
```

---

### Task 4: Implement chain-scoped token registry

**Files:**
- Create: `src/intent/token-registry.ts`
- Test: `src/intent/__tests__/token-registry.test.ts`

This registry maps (chain, network, symbol) → address and (chain, network, address) → metadata. It bundles common tokens and allows custom overrides.

**Step 1: Write the failing test**

Create `src/intent/__tests__/token-registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createTokenRegistry } from '../token-registry.js';

describe('TokenRegistry', () => {
  it('resolves USDC on solana mainnet by symbol', () => {
    const reg = createTokenRegistry();
    const result = reg.resolveSymbol('solana', 'mainnet', 'USDC');
    expect(result).not.toBeNull();
    expect(result!.address).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(result!.decimals).toBe(6);
  });

  it('resolves USDC on ethereum mainnet by symbol', () => {
    const reg = createTokenRegistry();
    const result = reg.resolveSymbol('ethereum', 'mainnet', 'USDC');
    expect(result).not.toBeNull();
    expect(result!.address).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(result!.decimals).toBe(6);
  });

  it('resolves USDC on base mainnet', () => {
    const reg = createTokenRegistry();
    const result = reg.resolveSymbol('base', 'mainnet', 'USDC');
    expect(result).not.toBeNull();
    expect(result!.address).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('returns null for unknown symbol', () => {
    const reg = createTokenRegistry();
    const result = reg.resolveSymbol('solana', 'mainnet', 'SHIB');
    expect(result).toBeNull();
  });

  it('resolves token by address (reverse lookup)', () => {
    const reg = createTokenRegistry();
    const result = reg.resolveAddress('solana', 'mainnet', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('USDC');
    expect(result!.decimals).toBe(6);
  });

  it('reverse lookup on EVM is case-insensitive', () => {
    const reg = createTokenRegistry();
    const result = reg.resolveAddress('ethereum', 'mainnet', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('USDC');
  });

  it('cross-checks symbol and address', () => {
    const reg = createTokenRegistry();
    // Correct pair
    const ok = reg.crossCheck('solana', 'mainnet', 'USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(ok).toBe(true);
    // Wrong pair — USDC symbol with USDT address
    const bad = reg.crossCheck('solana', 'mainnet', 'USDC', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
    expect(bad).toBe(false);
  });

  it('accepts custom overrides', () => {
    const reg = createTokenRegistry({
      solana: {
        mainnet: {
          'CUSTOM': { address: 'CUSTOMaddr111111111111111111111111111111111', decimals: 9 },
        },
      },
    });
    const result = reg.resolveSymbol('solana', 'mainnet', 'CUSTOM');
    expect(result).not.toBeNull();
    expect(result!.address).toBe('CUSTOMaddr111111111111111111111111111111111');
  });

  it('overrides take precedence over bundled tokens', () => {
    const reg = createTokenRegistry({
      solana: {
        mainnet: {
          'USDC': { address: 'OverriddenAddress1111111111111111111111111', decimals: 6 },
        },
      },
    });
    const result = reg.resolveSymbol('solana', 'mainnet', 'USDC');
    expect(result!.address).toBe('OverriddenAddress1111111111111111111111111');
  });

  it('resolves devnet tokens', () => {
    const reg = createTokenRegistry();
    const result = reg.resolveSymbol('solana', 'devnet', 'USDC');
    expect(result).not.toBeNull();
    // devnet USDC has a different address
    expect(result!.address).not.toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/intent/__tests__/token-registry.test.ts`
Expected: FAIL — module `../token-registry.js` does not exist.

**Step 3: Write minimal implementation**

Create `src/intent/token-registry.ts`:

```typescript
import { isEvmChain } from './chains.js';

export interface TokenInfo {
  address: string;
  decimals: number;
  symbol?: string;
}

type OverrideMap = Record<string, Record<string, Record<string, { address: string; decimals: number }>>>;

// ─── Bundled token data ───────────────────────────────────────
// Structure: chain → network → symbol → { address, decimals }

const BUNDLED_TOKENS: Record<string, Record<string, Record<string, { address: string; decimals: number }>>> = {
  solana: {
    mainnet: {
      USDC: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
      USDT: { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
      SOL:  { address: 'So11111111111111111111111111111111111111112', decimals: 9 },
    },
    devnet: {
      USDC: { address: 'uSDCYMsmqUKxijtDMwPnkJDnSwXkZ3RFWq6cznL5Lt2', decimals: 6 },
      USDT: { address: 'USdTT7wzvFCGkabDLMfawUm4QZqFm8qVX69SFjcUtXk', decimals: 6 },
    },
  },
  ethereum: {
    mainnet: {
      USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
    },
    sepolia: {
      USDC: { address: '0x7F65D6637485C6744475d0f9220Dce2695b30C3F', decimals: 6 },
      USDT: { address: '0x404171543Fec71E8E9Cdac46cA143bc191482e2A', decimals: 6 },
    },
  },
  polygon: {
    mainnet: {
      USDC: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
      USDT: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    },
    amoy: {
      USDC: { address: '0xac7AB7E28c295275DA0f66E38e7117EAAD2a10Df', decimals: 6 },
      USDT: { address: '0x452e6e4e90E21B64DFAF33205E1726D75820947E', decimals: 6 },
    },
  },
  base: {
    mainnet: {
      USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
      USDT: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
    },
    sepolia: {
      USDC: { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6 },
    },
  },
};

export function createTokenRegistry(overrides?: OverrideMap) {
  // Merge overrides on top of bundled
  const tokens = mergeDeep(BUNDLED_TOKENS, overrides ?? {});

  function getChainNetwork(chain: string, network: string): Record<string, { address: string; decimals: number }> {
    return tokens[chain]?.[network] ?? {};
  }

  function resolveSymbol(chain: string, network: string, symbol: string): TokenInfo | null {
    const entry = getChainNetwork(chain, network)[symbol];
    if (!entry) return null;
    return { address: entry.address, decimals: entry.decimals, symbol };
  }

  function resolveAddress(chain: string, network: string, address: string): (TokenInfo & { symbol: string }) | null {
    const entries = getChainNetwork(chain, network);
    const evm = isEvmChain(chain);
    const normalizedAddr = evm ? address.toLowerCase() : address;

    for (const [symbol, entry] of Object.entries(entries)) {
      const entryAddr = evm ? entry.address.toLowerCase() : entry.address;
      if (entryAddr === normalizedAddr) {
        return { address: entry.address, decimals: entry.decimals, symbol };
      }
    }
    return null;
  }

  function crossCheck(chain: string, network: string, symbol: string, address: string): boolean {
    const resolved = resolveSymbol(chain, network, symbol);
    if (!resolved) return false;
    const evm = isEvmChain(chain);
    const a = evm ? resolved.address.toLowerCase() : resolved.address;
    const b = evm ? address.toLowerCase() : address;
    return a === b;
  }

  return { resolveSymbol, resolveAddress, crossCheck };
}

function mergeDeep(
  base: Record<string, Record<string, Record<string, { address: string; decimals: number }>>>,
  overrides: Record<string, Record<string, Record<string, { address: string; decimals: number }>>>,
): Record<string, Record<string, Record<string, { address: string; decimals: number }>>> {
  const result = { ...base };
  for (const [chain, networks] of Object.entries(overrides)) {
    if (!result[chain]) {
      result[chain] = networks;
      continue;
    }
    result[chain] = { ...result[chain] };
    for (const [network, tokens] of Object.entries(networks)) {
      result[chain][network] = { ...result[chain][network], ...tokens };
    }
  }
  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/intent/__tests__/token-registry.test.ts`
Expected: PASS (10 tests)

**Step 5: Commit**

```bash
git add src/intent/token-registry.ts src/intent/__tests__/token-registry.test.ts
git commit -m "feat(intent): add chain-scoped token registry"
```

---

### Task 5: Implement intent helpers (isSingleIntent, isCompoundIntent, getActions, parseChainFromIntent)

**Files:**
- Create: `src/intent/helpers.ts`
- Test: `src/intent/__tests__/helpers.test.ts`

**Step 1: Write the failing test**

Create `src/intent/__tests__/helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isSingleIntent, isCompoundIntent, getActions } from '../helpers.js';
import type { Intent } from '../types.js';

describe('isSingleIntent', () => {
  it('returns true for single intent', () => {
    const intent: Intent = { chain: 'solana', action: 'transfer', from: 'A', to: 'B', amount: 100 };
    expect(isSingleIntent(intent)).toBe(true);
  });

  it('returns false for compound intent', () => {
    const intent: Intent = { chain: 'solana', actions: [{ action: 'transfer', from: 'A', to: 'B', amount: 100 }] };
    expect(isSingleIntent(intent)).toBe(false);
  });
});

describe('isCompoundIntent', () => {
  it('returns true for compound intent', () => {
    const intent: Intent = { chain: 'solana', actions: [{ action: 'transfer', from: 'A', to: 'B', amount: 100 }] };
    expect(isCompoundIntent(intent)).toBe(true);
  });

  it('returns false for single intent', () => {
    const intent: Intent = { chain: 'solana', action: 'transfer', from: 'A', to: 'B', amount: 100 };
    expect(isCompoundIntent(intent)).toBe(false);
  });
});

describe('getActions', () => {
  it('returns single action in array for single intent', () => {
    const intent: Intent = { chain: 'solana', action: 'transfer', from: 'A', to: 'B', amount: 100 };
    const actions = getActions(intent);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('transfer');
  });

  it('returns all actions for compound intent', () => {
    const intent: Intent = {
      chain: 'solana',
      actions: [
        { action: 'withdraw', from: 'A', amount: 100 },
        { action: 'transfer', from: 'A', to: 'B', amount: 100 },
      ],
    };
    const actions = getActions(intent);
    expect(actions).toHaveLength(2);
    expect(actions[0].action).toBe('withdraw');
    expect(actions[1].action).toBe('transfer');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/intent/__tests__/helpers.test.ts`
Expected: FAIL — module `../helpers.js` does not exist.

**Step 3: Write minimal implementation**

Create `src/intent/helpers.ts`:

```typescript
import type { Intent, SingleIntent, CompoundIntent, ActionIntent } from './types.js';

export function isSingleIntent(intent: Intent): intent is SingleIntent {
  return 'action' in intent;
}

export function isCompoundIntent(intent: Intent): intent is CompoundIntent {
  return 'actions' in intent;
}

export function getActions(intent: Intent): ActionIntent[] {
  if (isCompoundIntent(intent)) {
    return intent.actions;
  }
  // Extract just the action fields (without chain/strict)
  const { chain: _chain, strict: _strict, ...action } = intent as SingleIntent;
  return [action as ActionIntent];
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/intent/__tests__/helpers.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/intent/helpers.ts src/intent/__tests__/helpers.test.ts
git commit -m "feat(intent): add intent helper utilities"
```

---

### Task 6: Implement the intent matcher (chain-agnostic layer)

This is the core matching logic. It takes decoded instructions (from a chain adapter) and an intent, and produces a `VerifyResult`.

**Files:**
- Create: `src/intent/matcher.ts`
- Test: `src/intent/__tests__/matcher.test.ts`

**Step 1: Write the failing test**

Create `src/intent/__tests__/matcher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { matchIntent } from '../matcher.js';
import type { ActionIntent } from '../types.js';
import type { InstructionAnalysis, RiskFlag } from '../../verify/index.js';

// Helper to build a minimal InstructionAnalysis
function makeIx(overrides: Partial<InstructionAnalysis>): InstructionAnalysis {
  return {
    index: 0,
    programId: 'test-program',
    programName: 'Test',
    type: null,
    known: true,
    params: {},
    flags: [],
    ...overrides,
  };
}

describe('matchIntent', () => {
  it('full confidence when known action and all fields match', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: 100,
      tokenSymbol: 'USDC',
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        params: { from: 'Alice', to: 'Bob', amount: '100000000', amountHuman: '100 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'solana', false);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe('full');
    expect(result.discrepancies).toHaveLength(0);
  });

  it('detects sender mismatch', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: 100,
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        params: { from: 'Charlie', to: 'Bob', amount: '100000000', amountHuman: '100 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'solana', false);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some(d => d.includes('from'))).toBe(true);
  });

  it('detects amount mismatch', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: 200,
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        params: { from: 'Alice', to: 'Bob', amount: '100000000', amountHuman: '100 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'solana', false);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some(d => d.includes('amount'))).toBe(true);
  });

  it('evaluates gte constraint on amount', () => {
    const actions: ActionIntent[] = [{
      action: 'swap',
      from: 'Alice',
      tokenIn: { tokenSymbol: 'ETH' },
      tokenOut: { tokenSymbol: 'USDC' },
      amountOut: { gte: 1000 },
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'swap',
        params: { from: 'Alice', amountOut: '1500000000', amountOutHuman: '1500 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'ethereum', false);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe('full');
  });

  it('gte constraint fails when below minimum', () => {
    const actions: ActionIntent[] = [{
      action: 'swap',
      from: 'Alice',
      tokenIn: { tokenSymbol: 'ETH' },
      tokenOut: { tokenSymbol: 'USDC' },
      amountOut: { gte: 1000 },
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'swap',
        params: { from: 'Alice', amountOut: '500000000', amountOutHuman: '500 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'ethereum', false);
    expect(result.matched).toBe(false);
  });

  it('returns unverified for unknown action', () => {
    const actions: ActionIntent[] = [{
      action: 'flashLoan',
      from: 'Alice',
      amount: 10000,
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'flashLoan',
        known: true,
        params: { from: 'Alice', amount: '10000' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'ethereum', false);
    expect(result.matched).toBe(false);
    expect(result.confidence).toBe('unverified');
  });

  it('fails when action not found in instructions', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: 100,
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({ type: 'swap', params: {} }),
    ];

    const result = matchIntent(actions, instructions, [], 'solana', false);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some(d => d.includes('transfer'))).toBe(true);
  });

  it('error-severity flags cause matched=false', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: 100,
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        params: { from: 'Alice', to: 'Bob', amountHuman: '100 USDC' },
      }),
    ];

    const flags: RiskFlag[] = [{
      severity: 'error',
      code: 'UNKNOWN_PROGRAM',
      message: 'Unknown program detected',
    }];

    const result = matchIntent(actions, instructions, flags, 'solana', false);
    expect(result.matched).toBe(false);
  });

  it('compound intent: matches all actions', () => {
    const actions: ActionIntent[] = [
      { action: 'withdraw', from: 'Alice', amount: 100 },
      { action: 'transfer', from: 'Alice', to: 'Bob', amount: 100 },
    ];

    const instructions: InstructionAnalysis[] = [
      makeIx({ type: 'withdraw', params: { from: 'Alice', amountHuman: '100 USDC' } }),
      makeIx({ index: 1, type: 'transfer', params: { from: 'Alice', to: 'Bob', amountHuman: '100 USDC' } }),
    ];

    const result = matchIntent(actions, instructions, [], 'ethereum', false);
    expect(result.matched).toBe(true);
  });

  it('compound intent: fails if any action missing', () => {
    const actions: ActionIntent[] = [
      { action: 'withdraw', from: 'Alice', amount: 100 },
      { action: 'transfer', from: 'Alice', to: 'Bob', amount: 100 },
    ];

    const instructions: InstructionAnalysis[] = [
      makeIx({ type: 'withdraw', params: { from: 'Alice', amountHuman: '100 USDC' } }),
    ];

    const result = matchIntent(actions, instructions, [], 'ethereum', false);
    expect(result.matched).toBe(false);
  });

  it('EVM addresses compared case-insensitively', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: '0xAbCdEf',
      to: '0x123456',
      amount: 100,
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        params: { from: '0xabcdef', to: '0x123456', amountHuman: '100 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'ethereum', false);
    expect(result.matched).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/intent/__tests__/matcher.test.ts`
Expected: FAIL — module `../matcher.js` does not exist.

**Step 3: Write minimal implementation**

Create `src/intent/matcher.ts`:

```typescript
import type { ActionIntent, Confidence, Constraint } from './types.js';
import type { InstructionAnalysis, RiskFlag } from '../verify/index.js';
import { evaluateConstraint } from './constraints.js';
import { normalizeAddress } from './chains.js';

// Known actions that get deep field-level verification
const KNOWN_ACTIONS = new Set([
  'transfer', 'swap', 'stake', 'lend', 'borrow', 'approve', 'withdraw',
]);

export interface MatchResult {
  matched: boolean;
  confidence: Confidence;
  discrepancies: string[];
}

export function matchIntent(
  actions: ActionIntent[],
  instructions: InstructionAnalysis[],
  globalFlags: RiskFlag[],
  chain: string,
  strict: boolean,
): MatchResult {
  const discrepancies: string[] = [];
  let lowestConfidence: Confidence = 'full';

  // Error-severity flags are automatic failures
  for (const flag of globalFlags) {
    if (flag.severity === 'error') {
      discrepancies.push(flag.message);
    }
  }

  // Match each action against the instructions
  const usedIndices = new Set<number>();

  for (const action of actions) {
    const actionResult = matchSingleAction(action, instructions, usedIndices, chain);
    discrepancies.push(...actionResult.discrepancies);

    if (confidenceRank(actionResult.confidence) < confidenceRank(lowestConfidence)) {
      lowestConfidence = actionResult.confidence;
    }

    if (actionResult.matchedIndex !== null) {
      usedIndices.add(actionResult.matchedIndex);
    }
  }

  // In strict mode, check for unaccounted instructions
  if (strict) {
    for (const ix of instructions) {
      if (!usedIndices.has(ix.index) && !isAncillary(ix)) {
        discrepancies.push(`Strict mode: instruction ${ix.index} (${ix.type ?? ix.programId}) is not part of the intent.`);
      }
    }
  }

  const matched = discrepancies.length === 0 && lowestConfidence !== 'unverified';

  return { matched, confidence: lowestConfidence, discrepancies };
}

interface SingleActionResult {
  confidence: Confidence;
  discrepancies: string[];
  matchedIndex: number | null;
}

function matchSingleAction(
  action: ActionIntent,
  instructions: InstructionAnalysis[],
  usedIndices: Set<number>,
  chain: string,
): SingleActionResult {
  const discrepancies: string[] = [];

  // Find matching instruction by action/type
  const match = instructions.find(
    (ix) => ix.type === action.action && !usedIndices.has(ix.index),
  );

  if (!match) {
    discrepancies.push(`Expected a '${action.action}' instruction but none was found in the transaction.`);
    return { confidence: 'full', discrepancies, matchedIndex: null };
  }

  // Unknown actions get structural match only
  if (!KNOWN_ACTIONS.has(action.action)) {
    return { confidence: 'unverified', discrepancies, matchedIndex: match.index };
  }

  // Deep field comparison for known actions
  const params = match.params;
  const fieldDiscrepancies = compareFields(action, params, chain);
  discrepancies.push(...fieldDiscrepancies);

  return { confidence: 'full', discrepancies, matchedIndex: match.index };
}

function compareFields(
  action: ActionIntent,
  params: Record<string, unknown>,
  chain: string,
): string[] {
  const discrepancies: string[] = [];

  // Address fields to compare
  const addressFields = ['from', 'to', 'owner', 'spender', 'validator'] as const;
  for (const field of addressFields) {
    const intentValue = (action as Record<string, unknown>)[field] as string | undefined;
    const paramValue = params[field] as string | undefined;
    if (intentValue && paramValue) {
      if (normalizeAddress(intentValue, chain) !== normalizeAddress(paramValue, chain)) {
        discrepancies.push(`Field '${field}' mismatch: expected ${intentValue}, got ${paramValue}`);
      }
    }
  }

  // Amount fields to compare (with constraint support)
  const amountFields = ['amount', 'amountIn', 'amountOut'] as const;
  for (const field of amountFields) {
    const intentValue = (action as Record<string, unknown>)[field] as Constraint<number> | undefined;
    if (intentValue === undefined) continue;

    const humanKey = field === 'amount' ? 'amountHuman' : `${field}Human`;
    const humanStr = params[humanKey] as string | undefined;
    if (!humanStr) continue;

    const actual = parseFloat(humanStr.split(' ')[0]);
    if (isNaN(actual)) continue;

    if (!evaluateConstraint(intentValue, actual)) {
      discrepancies.push(`Field '${field}' mismatch: expected ${JSON.stringify(intentValue)}, got ${humanStr}`);
    }
  }

  // Memo field (exact match)
  const intentMemo = (action as Record<string, unknown>)['memo'] as string | undefined;
  const paramMemo = params['memo'] as string | undefined;
  if (intentMemo && paramMemo && intentMemo !== paramMemo) {
    discrepancies.push(`Memo mismatch: expected "${intentMemo}", got "${paramMemo}"`);
  }

  return discrepancies;
}

function confidenceRank(c: Confidence): number {
  switch (c) {
    case 'full': return 2;
    case 'partial': return 1;
    case 'unverified': return 0;
  }
}

// Instructions that are considered ancillary (not part of the user's intent)
const ANCILLARY_TYPES = new Set([
  'set_compute_unit_price', 'set_compute_unit_limit',  // compute budget
  'memo',                                                // memo
  'create', 'create_idempotent',                         // ATA creation
]);

function isAncillary(ix: InstructionAnalysis): boolean {
  return ANCILLARY_TYPES.has(ix.type ?? '');
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/intent/__tests__/matcher.test.ts`
Expected: PASS (12 tests)

**Step 5: Commit**

```bash
git add src/intent/matcher.ts src/intent/__tests__/matcher.test.ts
git commit -m "feat(intent): add chain-agnostic intent matcher"
```

---

### Task 7: Implement the public API (verifyIntent v2)

Wire everything together: parse intent → call existing Solana chain adapter (analyzeTransaction) → run matcher → return VerifyResult.

**Files:**
- Create: `src/intent/index.ts`
- Test: `src/intent/__tests__/verify.test.ts`

**Step 1: Write the failing test**

Create `src/intent/__tests__/verify.test.ts`. This tests the full pipeline using the existing Solana test helpers.

```typescript
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
      action: 'transfer',
      from: ALICE.publicKey.toBase58(),
      to: BOB.publicKey.toBase58(),
      amount: 100,
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
      action: 'transfer',
      from: wrong.publicKey.toBase58(),
      to: BOB.publicKey.toBase58(),
      amount: 100,
    };

    const result = await verifyIntent(txBase64, intent);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some(d => d.includes('from'))).toBe(true);
  });

  it('detects amount mismatch', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);

    const intent: Intent = {
      chain: 'solana',
      action: 'transfer',
      from: ALICE.publicKey.toBase58(),
      to: BOB.publicKey.toBase58(),
      amount: 200,
    };

    const result = await verifyIntent(txBase64, intent);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some(d => d.includes('amount'))).toBe(true);
  });

  it('chain field is required', async () => {
    const txBase64 = buildHandshakeTransferTx(ALICE, BOB, 100_000_000n);

    // Intent without chain should fail at type level,
    // but test runtime behavior
    const intent = {
      action: 'transfer',
      from: ALICE.publicKey.toBase58(),
      to: BOB.publicKey.toBase58(),
      amount: 100,
    } as Intent;

    const result = await verifyIntent(txBase64, intent);
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some(d => d.includes('chain'))).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/intent/__tests__/verify.test.ts`
Expected: FAIL — module `../index.js` does not exist.

**Step 3: Write minimal implementation**

Create `src/intent/index.ts`:

```typescript
import type { Intent, VerifyResult, Confidence } from './types.js';
import type { AnalyzeOptions, TransactionAnalysis } from '../verify/index.js';
import { analyzeTransaction as solanaAnalyze } from '../verify/index.js';
import { parseChain } from './chains.js';
import { getActions } from './helpers.js';
import { matchIntent } from './matcher.js';

export type { Intent, SingleIntent, CompoundIntent, ActionIntent, Constraint, TokenRef, VerifyResult, Confidence } from './types.js';
export type { TransferIntent, SwapIntent, StakeIntent, LendIntent, BorrowIntent, ApproveIntent, WithdrawIntent, CustomIntent } from './types.js';
export { evaluateConstraint } from './constraints.js';
export { createTokenRegistry } from './token-registry.js';
export { parseChain, normalizeAddress, isEvmChain } from './chains.js';

// Action type mapping: maps generic action names to chain-specific instruction types.
// The Solana chain adapter uses Handshake's `create_transfer` for the generic `transfer` action.
const SOLANA_ACTION_MAP: Record<string, string> = {
  transfer: 'create_transfer',
};

export async function verifyIntent(
  txBytes: string,
  intent: Intent,
  opts: AnalyzeOptions = {},
): Promise<VerifyResult> {
  if (!intent.chain) {
    return {
      matched: false,
      confidence: 'unverified',
      discrepancies: ['Intent is missing required "chain" field.'],
      analysis: { feePayer: '', instructions: [], flags: [], summary: '' },
    };
  }

  const { chain } = parseChain(intent.chain);
  const strict = intent.strict ?? false;
  const actions = getActions(intent);

  // Select chain adapter
  let analysis: TransactionAnalysis;

  if (chain === 'solana') {
    analysis = await solanaAnalyze(txBytes, opts);

    // Remap generic action names to Solana-specific instruction types in the analysis
    // so the matcher can find them by the generic name
    for (const ix of analysis.instructions) {
      for (const [generic, specific] of Object.entries(SOLANA_ACTION_MAP)) {
        if (ix.type === specific) {
          ix.type = generic;
          // Also remap param names: sender→from, recipient→to
          if (ix.params['sender']) {
            ix.params['from'] = ix.params['sender'];
          }
          if (ix.params['recipient']) {
            ix.params['to'] = ix.params['recipient'];
          }
        }
      }
    }
  } else {
    // EVM chains not implemented yet
    return {
      matched: false,
      confidence: 'unverified',
      discrepancies: [`Chain adapter for '${chain}' is not yet implemented.`],
      analysis: { feePayer: '', instructions: [], flags: [], summary: '' },
    };
  }

  const result = matchIntent(actions, analysis.instructions, analysis.flags, chain, strict);

  return {
    matched: result.matched,
    confidence: result.confidence,
    discrepancies: result.discrepancies,
    analysis,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/intent/__tests__/verify.test.ts`
Expected: PASS (4 tests)

**Step 5: Verify all existing tests still pass**

Run: `npx vitest run`
Expected: All 61 existing tests + new tests pass.

**Step 6: Commit**

```bash
git add src/intent/index.ts src/intent/__tests__/verify.test.ts
git commit -m "feat(intent): add cross-chain verifyIntent with Solana adapter"
```

---

### Task 8: Export new intent module from SDK entry point

**Files:**
- Modify: `src/index.ts`

**Step 1: Add exports**

Add to `src/index.ts` alongside the existing verify exports:

```typescript
// Cross-chain intent framework
export { verifyIntent as verifyIntentV2 } from './intent/index.js';
export type {
  Intent as IntentV2,
  SingleIntent, CompoundIntent, ActionIntent,
  Constraint, TokenRef, Confidence,
  TransferIntent, SwapIntent, StakeIntent, LendIntent, BorrowIntent, ApproveIntent, WithdrawIntent, CustomIntent,
  VerifyResult as VerifyResultV2,
} from './intent/index.js';
export { evaluateConstraint, createTokenRegistry, parseChain, normalizeAddress, isEvmChain } from './intent/index.js';
```

The old `verifyIntent` and `Intent` exports remain unchanged for backwards compatibility. The new exports use `V2` suffix to avoid conflicts.

**Step 2: Build and verify**

Run: `npm run build`
Expected: No TypeScript errors.

Run: `npx vitest run`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export cross-chain intent framework from SDK entry point"
```

---

### Task 9: Add strict mode test coverage

**Files:**
- Modify: `src/intent/__tests__/verify.test.ts`

**Step 1: Add strict mode tests**

Append to the existing describe block in `src/intent/__tests__/verify.test.ts`:

```typescript
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
    strict: true,
    action: 'transfer',
    from: ALICE.publicKey.toBase58(),
    to: BOB.publicKey.toBase58(),
    amount: 100,
  };

  const result = await verifyIntent(txBase64, intent);
  expect(result.matched).toBe(false);
});

it('non-strict mode ignores extra instructions', async () => {
  // Same tx as above but with strict: false (default)
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
    action: 'transfer',
    from: ALICE.publicKey.toBase58(),
    to: BOB.publicKey.toBase58(),
    amount: 100,
  };

  // Non-strict: unknown program triggers error flag, but intent itself matches.
  // However UNKNOWN_PROGRAM is an error flag so matched will still be false.
  const result = await verifyIntent(txBase64, intent);
  expect(result.matched).toBe(false);
  expect(result.discrepancies.some(d => d.includes('unknown program'))).toBe(true);
});
```

**Step 2: Run tests**

Run: `npx vitest run src/intent/__tests__/verify.test.ts`
Expected: PASS (6 tests)

**Step 3: Commit**

```bash
git add src/intent/__tests__/verify.test.ts
git commit -m "test(intent): add strict mode and extra instruction coverage"
```

---

### Task 10: Final verification and cleanup

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (61 existing + ~49 new).

**Step 2: Build**

Run: `npm run build`
Expected: No TypeScript errors.

**Step 3: Verify file structure**

Run: `find src/intent -type f | sort`
Expected:
```
src/intent/__tests__/chains.test.ts
src/intent/__tests__/constraints.test.ts
src/intent/__tests__/helpers.test.ts
src/intent/__tests__/matcher.test.ts
src/intent/__tests__/token-registry.test.ts
src/intent/__tests__/types.test.ts
src/intent/__tests__/verify.test.ts
src/intent/chains.ts
src/intent/constraints.ts
src/intent/helpers.ts
src/intent/index.ts
src/intent/matcher.ts
src/intent/token-registry.ts
src/intent/types.ts
```

**Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "chore(intent): final cleanup and verification"
```
