import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Order } from '../types.js';

// vi.hoisted runs before imports, so TEST_DIR is available in the mock factory
const { TEST_DIR, TEST_FILE } = vi.hoisted(() => {
  const _os = require('node:os');
  const _path = require('node:path');
  const dir = _path.join(_os.tmpdir(), `silky-orders-test-${Date.now()}`);
  return { TEST_DIR: dir, TEST_FILE: _path.join(dir, 'orders.json') };
});

vi.mock('../../config.js', () => ({
  CONFIG_DIR: TEST_DIR,
}));

// Import after mock setup
const { loadOrders, saveOrders, addOrder, updateOrder, getOrder } = await import('../store.js');

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
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
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
