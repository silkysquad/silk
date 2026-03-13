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
