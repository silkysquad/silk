const EVM_CHAINS = new Set([
  'ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc', 'gnosis', 'zksync', 'scroll', 'linea', 'mantle',
]);

export interface ParsedChain {
  chain: string;
  network: string;
}

export function parseChain(chainStr: string): ParsedChain {
  const lower = chainStr.toLowerCase();
  const colonIndex = lower.indexOf(':');
  if (colonIndex === -1) {
    return { chain: lower, network: 'mainnet' };
  }
  return {
    chain: lower.slice(0, colonIndex),
    network: lower.slice(colonIndex + 1),
  };
}

export function isEvmChain(chain: string): boolean {
  return EVM_CHAINS.has(chain.toLowerCase());
}

export function normalizeAddress(address: string, chain: string): string {
  if (isEvmChain(chain)) {
    return address.toLowerCase();
  }
  return address;
}
