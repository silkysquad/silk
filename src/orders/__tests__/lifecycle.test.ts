import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import type { Order } from '../types.js';

// vi.hoisted runs before imports, so TEST_DIR is available in the mock factory
const { TEST_DIR } = vi.hoisted(() => {
  const _os = require('node:os');
  const _path = require('node:path');
  const dir = _path.join(_os.tmpdir(), `silky-lifecycle-test-${Date.now()}`);
  return { TEST_DIR: dir };
});

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

// Import after mock setup
const { addOrder, getOrder, updateOrder } = await import('../store.js');
const { evaluateOrders } = await import('../evaluate.js');

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
    history: [{ timestamp: '2026-03-13T00:00:00.000Z', type: 'created' as const }],
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

  it('create → attempt (not fillable) → attempt (fillable + verified) → filled', async () => {
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

  it('verification failure keeps order pending (signAndSubmit not called)', async () => {
    addOrder(makeOrder());

    const signAndSubmit = vi.fn();

    const results = await evaluateOrders({
      serverEvaluate: vi.fn().mockResolvedValue({ executable: true, transaction: 'fakeTx' }),
      verifyTransaction: vi.fn().mockResolvedValue({ matched: false, discrepancies: ['Recipient mismatch'] }),
      signAndSubmit,
    });

    expect(results[0].status).toBe('pending');
    expect(results[0].event.reason).toBe('VERIFICATION_FAILED');
    expect(getOrder('lifecycle-1')!.status).toBe('pending');
    // signAndSubmit must NOT have been called
    expect(signAndSubmit).not.toHaveBeenCalled();
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
