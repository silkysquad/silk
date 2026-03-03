import { Connection, PublicKey } from '@solana/web3.js';

export interface TokenMeta {
  symbol: string;
  decimals: number;
}

// Fetches basic token metadata from a mint account.
// Returns symbol as the mint address (truncated) when metadata program is unavailable.
export async function fetchTokenMeta(
  connection: Connection,
  mint: string,
): Promise<TokenMeta | null> {
  try {
    const mintPubkey = new PublicKey(mint);
    const accountInfo = await connection.getAccountInfo(mintPubkey);
    if (!accountInfo) return null;

    // SPL Mint layout: [44 bytes header] where decimals is at byte 44
    // Layout: mintAuthorityOption(4) + mintAuthority(32) + supply(8) + decimals(1) + ...
    if (accountInfo.data.length < 45) return null;
    const decimals = accountInfo.data[44];

    // Use shortened mint as symbol fallback — agents can understand this
    const shortMint = `${mint.slice(0, 4)}..${mint.slice(-4)}`;

    return { symbol: shortMint, decimals };
  } catch {
    return null;
  }
}

// Cache to avoid redundant RPC calls within a single analyzeTransaction call
export function createTokenCache(
  registry: Record<string, { symbol: string; decimals: number }>,
  connection?: Connection,
) {
  const cache = new Map<string, TokenMeta | null>();

  // Pre-populate from registry
  for (const [mint, meta] of Object.entries(registry)) {
    cache.set(mint, meta);
  }

  return {
    getSymbol(mint: string): string {
      return cache.get(mint)?.symbol ?? `${mint.slice(0, 4)}..${mint.slice(-4)}`;
    },
    getDecimals(mint: string): number {
      return cache.get(mint)?.decimals ?? 6;
    },
    async prefetch(mints: string[]): Promise<void> {
      if (!connection) return;
      const unknown = mints.filter((m) => !cache.has(m));
      await Promise.all(
        unknown.map(async (mint) => {
          const meta = await fetchTokenMeta(connection, mint);
          cache.set(mint, meta);
        }),
      );
    },
  };
}
