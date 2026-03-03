import { describe, it, expect } from 'vitest';
import { createTokenCache } from '../rpc.js';

const REGISTRY_TOKENS = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6 },
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9 },
};

describe('createTokenCache', () => {
  it('returns registry symbol for known mint', () => {
    const cache = createTokenCache(REGISTRY_TOKENS);
    expect(cache.getSymbol('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe('USDC');
  });

  it('returns registry decimals for known mint', () => {
    const cache = createTokenCache(REGISTRY_TOKENS);
    expect(cache.getDecimals('So11111111111111111111111111111111111111112')).toBe(9);
  });

  it('returns shortened address for unknown mint symbol', () => {
    const cache = createTokenCache(REGISTRY_TOKENS);
    const unknown = 'AbCdEfGhIjKlMnOpQrStUvWxYz123456789ABCDEFGH';
    const symbol = cache.getSymbol(unknown);
    expect(symbol).toBe('AbCd..EFGH');
  });

  it('returns default 6 decimals for unknown mint', () => {
    const cache = createTokenCache(REGISTRY_TOKENS);
    expect(cache.getDecimals('UnknownMint1111111111111111111111111111111')).toBe(6);
  });

  it('prefetch is a no-op without connection', async () => {
    const cache = createTokenCache(REGISTRY_TOKENS);
    // Should not throw
    await cache.prefetch(['SomeRandomMint11111111111111111111111111111']);
  });
});
