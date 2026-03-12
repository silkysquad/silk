import { describe, it, expect } from 'vitest';
import { createProgramRegistry } from '../program-registry.js';

describe('createProgramRegistry', () => {
  const registry = createProgramRegistry();

  describe('resolveName', () => {
    it('resolves handshake by name', () => {
      const info = registry.resolveName('solana', 'mainnet', 'handshake');
      expect(info).not.toBeNull();
      expect(info!.address).toBe('HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ');
      expect(info!.name).toBe('handshake');
    });

    it('resolves silkysig by name', () => {
      const info = registry.resolveName('solana', 'mainnet', 'silkysig');
      expect(info).not.toBeNull();
      expect(info!.address).toBe('SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS');
    });

    it('resolves jupiter by name', () => {
      const info = registry.resolveName('solana', 'mainnet', 'jupiter');
      expect(info).not.toBeNull();
      expect(info!.address).toBe('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
    });

    it('returns null for unknown name', () => {
      expect(registry.resolveName('solana', 'mainnet', 'unknown')).toBeNull();
    });
  });

  describe('resolveAddress', () => {
    it('resolves handshake by address', () => {
      const info = registry.resolveAddress('solana', 'mainnet', 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ');
      expect(info).not.toBeNull();
      expect(info!.name).toBe('handshake');
    });

    it('returns null for unknown address', () => {
      expect(registry.resolveAddress('solana', 'mainnet', 'UnknownAddress123')).toBeNull();
    });
  });

  describe('crossCheck', () => {
    it('returns true when name matches address', () => {
      expect(registry.crossCheck('solana', 'mainnet', 'handshake', 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ')).toBe(true);
    });

    it('returns false when name does not match address', () => {
      expect(registry.crossCheck('solana', 'mainnet', 'handshake', 'SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS')).toBe(false);
    });
  });

  describe('EVM case-insensitive address', () => {
    it('resolves address case-insensitively on EVM chains', () => {
      const evmRegistry = createProgramRegistry({
        ethereum: {
          mainnet: {
            uniswap: { address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' },
          },
        },
      });
      const info = evmRegistry.resolveAddress('ethereum', 'mainnet', '0x7A250D5630B4CF539739DF2C5DACB4C659F2488D');
      expect(info).not.toBeNull();
      expect(info!.name).toBe('uniswap');
    });

    it('cross-checks case-insensitively on EVM chains', () => {
      const evmRegistry = createProgramRegistry({
        ethereum: {
          mainnet: {
            uniswap: { address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' },
          },
        },
      });
      expect(evmRegistry.crossCheck('ethereum', 'mainnet', 'uniswap', '0x7A250D5630B4CF539739DF2C5DACB4C659F2488D')).toBe(true);
    });
  });

  describe('custom overrides', () => {
    it('adds custom programs via overrides', () => {
      const custom = createProgramRegistry({
        solana: {
          mainnet: {
            myProgram: { address: 'CustomAddress123' },
          },
        },
      });
      const info = custom.resolveName('solana', 'mainnet', 'myProgram');
      expect(info).not.toBeNull();
      expect(info!.address).toBe('CustomAddress123');
      // Bundled entries still present
      expect(custom.resolveName('solana', 'mainnet', 'handshake')).not.toBeNull();
    });
  });

  describe('devnet', () => {
    it('resolves handshake on devnet', () => {
      const info = registry.resolveName('solana', 'devnet', 'handshake');
      expect(info).not.toBeNull();
      expect(info!.address).toBe('HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ');
    });

    it('jupiter not available on devnet', () => {
      expect(registry.resolveName('solana', 'devnet', 'jupiter')).toBeNull();
    });
  });
});
