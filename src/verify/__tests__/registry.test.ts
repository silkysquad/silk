import { describe, it, expect } from 'vitest';
import { REGISTRY } from '../registry.js';

describe('REGISTRY', () => {
  it('has all expected programs', () => {
    const keys = Object.keys(REGISTRY.programs);
    expect(keys).toContain('11111111111111111111111111111111');
    expect(keys).toContain('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    expect(keys).toContain('HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ');
    expect(keys).toContain('SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS');
    expect(keys).toContain('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
  });

  it('has USDC in token registry with 6 decimals', () => {
    const usdc = REGISTRY.tokens['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'];
    expect(usdc).toBeDefined();
    expect(usdc.symbol).toBe('USDC');
    expect(usdc.decimals).toBe(6);
  });

  it('each program has name and decoder fields', () => {
    for (const [id, entry] of Object.entries(REGISTRY.programs)) {
      expect(entry.name, `program ${id} missing name`).toBeTruthy();
      expect(entry.decoder, `program ${id} missing decoder`).toBeTruthy();
    }
  });

  it('each token has symbol and decimals fields', () => {
    for (const [mint, entry] of Object.entries(REGISTRY.tokens)) {
      expect(entry.symbol, `token ${mint} missing symbol`).toBeTruthy();
      expect(typeof entry.decimals, `token ${mint} decimals should be number`).toBe('number');
    }
  });
});
