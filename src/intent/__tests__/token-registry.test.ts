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
    const ok = reg.crossCheck('solana', 'mainnet', 'USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(ok).toBe(true);

    const bad = reg.crossCheck('solana', 'mainnet', 'USDC', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
    expect(bad).toBe(false);
  });

  it('accepts custom overrides', () => {
    const reg = createTokenRegistry({
      solana: {
        mainnet: {
          CUSTOM: { address: 'CUSTOMaddr111111111111111111111111111111111', decimals: 9 },
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
          USDC: { address: 'OverriddenAddress1111111111111111111111111', decimals: 6 },
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
    expect(result!.address).not.toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  });
});
