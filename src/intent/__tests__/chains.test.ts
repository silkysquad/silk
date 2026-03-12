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
