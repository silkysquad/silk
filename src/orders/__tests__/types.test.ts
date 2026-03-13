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
