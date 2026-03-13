import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Order, EvaluationResult } from '../types.js';

const { TEST_DIR } = vi.hoisted(() => {
  const _os = require('node:os');
  const _path = require('node:path');
  const dir = _path.join(_os.tmpdir(), `silky-eval-test-${Date.now()}`);
  return { TEST_DIR: dir };
});

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

const { evaluateOrders } = await import('../evaluate.js');

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
      getPrice: vi.fn().mockResolvedValue(120.0), // Way above ~85 limit
    };

    const results = await evaluateOrders({ dryRun: true, priceFeed });
    expect(priceFeed.getPrice).toHaveBeenCalled();
    // Should still attempt evaluation in dry run but log the skip
    expect(results).toHaveLength(1);
    expect(results[0].event.type).toBe('attempted');
    expect(results[0].event.reason).toBe('PRICE_PRE_CHECK_SKIP');
  });

  it('server returns "not fillable" -> stays pending', async () => {
    writeOrders([makeOrder({ id: 'not-fillable', policy: { cooldown: 0 } })]);

    const serverEvaluate = vi.fn().mockResolvedValue({
      executable: false,
      reason: 'PRICE_OUT_OF_RANGE',
      detail: 'SOL at 120',
    });

    const results = await evaluateOrders({ serverEvaluate });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('pending');
    expect(results[0].event.reason).toBe('PRICE_OUT_OF_RANGE');
  });

  it('server returns tx + verification passes -> filled', async () => {
    writeOrders([makeOrder({ id: 'fillable', policy: { cooldown: 0 } })]);

    const serverEvaluate = vi.fn().mockResolvedValue({
      executable: true,
      transaction: 'fakeTxBase64',
      quote: { price: '84.90', amountIn: '500', amountOut: '5.889' },
    });
    const verifyTransaction = vi.fn().mockResolvedValue({ matched: true, discrepancies: [] });
    const signAndSubmit = vi.fn().mockResolvedValue('txid123');

    const results = await evaluateOrders({ serverEvaluate, verifyTransaction, signAndSubmit });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('filled');
    expect(results[0].event.txid).toBe('txid123');
  });

  it('verification failure -> stays pending', async () => {
    writeOrders([makeOrder({ id: 'verify-fail', policy: { cooldown: 0 } })]);

    const serverEvaluate = vi.fn().mockResolvedValue({
      executable: true,
      transaction: 'fakeTx',
    });
    const verifyTransaction = vi.fn().mockResolvedValue({
      matched: false,
      discrepancies: ['Recipient mismatch'],
    });
    const signAndSubmit = vi.fn();

    const results = await evaluateOrders({ serverEvaluate, verifyTransaction, signAndSubmit });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('pending');
    expect(results[0].event.reason).toBe('VERIFICATION_FAILED');
    expect(signAndSubmit).not.toHaveBeenCalled();
  });
});
