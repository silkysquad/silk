import { isEvmChain } from './chains.js';

export interface TokenInfo {
  address: string;
  decimals: number;
  symbol?: string;
}

type OverrideMap = Record<string, Record<string, Record<string, { address: string; decimals: number }>>>;

// ─── Bundled token data ───────────────────────────────────────
// Structure: chain → network → symbol → { address, decimals }

const BUNDLED_TOKENS: Record<string, Record<string, Record<string, { address: string; decimals: number }>>> = {
  solana: {
    mainnet: {
      USDC: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
      USDT: { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
      SOL: { address: 'So11111111111111111111111111111111111111112', decimals: 9 },
    },
    devnet: {
      USDC: { address: 'uSDCYMsmqUKxijtDMwPnkJDnSwXkZ3RFWq6cznL5Lt2', decimals: 6 },
      USDT: { address: 'USdTT7wzvFCGkabDLMfawUm4QZqFm8qVX69SFjcUtXk', decimals: 6 },
    },
  },
  ethereum: {
    mainnet: {
      USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
    },
    sepolia: {
      USDC: { address: '0x7F65D6637485C6744475d0f9220Dce2695b30C3F', decimals: 6 },
      USDT: { address: '0x404171543Fec71E8E9Cdac46cA143bc191482e2A', decimals: 6 },
    },
  },
  polygon: {
    mainnet: {
      USDC: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
      USDT: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    },
    amoy: {
      USDC: { address: '0xac7AB7E28c295275DA0f66E38e7117EAAD2a10Df', decimals: 6 },
      USDT: { address: '0x452e6e4e90E21B64DFAF33205E1726D75820947E', decimals: 6 },
    },
  },
  base: {
    mainnet: {
      USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
      USDT: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
    },
    sepolia: {
      USDC: { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6 },
    },
  },
};

export function createTokenRegistry(overrides?: OverrideMap) {
  // Merge overrides on top of bundled
  const tokens = mergeDeep(BUNDLED_TOKENS, overrides ?? {});

  function getChainNetwork(chain: string, network: string): Record<string, { address: string; decimals: number }> {
    return tokens[chain]?.[network] ?? {};
  }

  function resolveSymbol(chain: string, network: string, symbol: string): TokenInfo | null {
    const entry = getChainNetwork(chain, network)[symbol];
    if (!entry) return null;
    return { address: entry.address, decimals: entry.decimals, symbol };
  }

  function resolveAddress(chain: string, network: string, address: string): (TokenInfo & { symbol: string }) | null {
    const entries = getChainNetwork(chain, network);
    const evm = isEvmChain(chain);
    const normalizedAddr = evm ? address.toLowerCase() : address;

    for (const [symbol, entry] of Object.entries(entries)) {
      const entryAddr = evm ? entry.address.toLowerCase() : entry.address;
      if (entryAddr === normalizedAddr) {
        return { address: entry.address, decimals: entry.decimals, symbol };
      }
    }
    return null;
  }

  function crossCheck(chain: string, network: string, symbol: string, address: string): boolean {
    const resolved = resolveSymbol(chain, network, symbol);
    if (!resolved) return false;
    const evm = isEvmChain(chain);
    const a = evm ? resolved.address.toLowerCase() : resolved.address;
    const b = evm ? address.toLowerCase() : address;
    return a === b;
  }

  return { resolveSymbol, resolveAddress, crossCheck };
}

function mergeDeep(
  base: Record<string, Record<string, Record<string, { address: string; decimals: number }>>>,
  overrides: Record<string, Record<string, Record<string, { address: string; decimals: number }>>>,
): Record<string, Record<string, Record<string, { address: string; decimals: number }>>> {
  const result = { ...base };
  for (const [chain, networks] of Object.entries(overrides)) {
    if (!result[chain]) {
      result[chain] = networks;
      continue;
    }
    result[chain] = { ...result[chain] };
    for (const [network, tokens] of Object.entries(networks)) {
      result[chain][network] = { ...result[chain][network], ...tokens };
    }
  }
  return result;
}
