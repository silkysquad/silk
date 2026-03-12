import { describe, it, expect } from 'vitest';
import type { Intent } from '../types.js';

describe('Intent types', () => {
  it('single transfer intent is assignable', () => {
    const intent: Intent = {
      chain: 'solana',
      signer: 'AgXx...w1',
      action: 'transfer',
      from: 'AgXx...w1',
      to: 'BobA...c2',
      amount: '100',
      tokenSymbol: 'USDC',
    };
    expect(intent.chain).toBe('solana');
  });

  it('compound intent with actions array is assignable', () => {
    const intent: Intent = {
      chain: 'ethereum',
      signer: '0xAlice',
      actions: [
        { action: 'withdraw', from: '0xAlice', amount: '100', tokenSymbol: 'USDC' },
        { action: 'transfer', from: '0xAlice', to: '0xBob', amount: '100', tokenSymbol: 'USDC' },
      ],
    };
    expect('actions' in intent).toBe(true);
  });

  it('constraint amount is assignable', () => {
    const intent: Intent = {
      chain: 'ethereum',
      signer: '0xAlice',
      action: 'swap',
      from: '0xAlice',
      tokenIn: { tokenSymbol: 'ETH' },
      tokenOut: { tokenSymbol: 'USDC' },
      amountIn: '0.5',
      amountOut: { gte: '1000' },
    };
    expect(intent.chain).toBe('ethereum');
  });

  it('custom action intent is assignable', () => {
    const intent: Intent = {
      chain: 'ethereum',
      signer: '0xAlice',
      action: 'flashLoan',
      from: '0xAlice',
      amount: '10000',
      protocol: 'aave',
    };
    expect(intent.action).toBe('flashLoan');
  });

  it('strict mode is optional and defaults conceptually to false', () => {
    const intent: Intent = {
      chain: 'solana',
      signer: 'AgXx',
      strict: true,
      action: 'transfer',
      from: 'AgXx',
      to: 'BobA',
      amount: '50',
      tokenSymbol: 'USDC',
    };
    expect(intent.strict).toBe(true);
  });

  it('chain with network suffix is valid', () => {
    const intent: Intent = {
      chain: 'solana:devnet',
      signer: 'AgXx',
      action: 'transfer',
      from: 'AgXx',
      to: 'BobA',
      amount: '100',
      tokenSymbol: 'USDC',
    };
    expect(intent.chain).toBe('solana:devnet');
  });

  it('feePayer is optional', () => {
    const intent: Intent = {
      chain: 'solana',
      signer: 'AgXx',
      feePayer: 'RelayerPubkey',
      action: 'transfer',
      from: 'AgXx',
      to: 'BobA',
      amount: '100',
    };
    expect(intent.feePayer).toBe('RelayerPubkey');
  });
});
