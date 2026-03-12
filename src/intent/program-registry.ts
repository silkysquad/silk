import { isEvmChain } from './chains.js';

export interface ProgramInfo {
  address: string;
  name: string;
}

type OverrideMap = Record<string, Record<string, Record<string, { address: string }>>>;

// ─── Bundled program data ────────────────────────────────────
// Structure: chain → network → name → { address }

const BUNDLED_PROGRAMS: Record<string, Record<string, Record<string, { address: string }>>> = {
  solana: {
    mainnet: {
      handshake: { address: 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ' },
      silkysig: { address: 'SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS' },
      jupiter: { address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' },
    },
    devnet: {
      handshake: { address: 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ' },
      silkysig: { address: 'SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS' },
    },
  },
};

export function createProgramRegistry(overrides?: OverrideMap) {
  const programs = mergeDeep(BUNDLED_PROGRAMS, overrides ?? {});

  function getChainNetwork(chain: string, network: string): Record<string, { address: string }> {
    return programs[chain]?.[network] ?? {};
  }

  function resolveName(chain: string, network: string, name: string): ProgramInfo | null {
    const entry = getChainNetwork(chain, network)[name];
    if (!entry) return null;
    return { address: entry.address, name };
  }

  function resolveAddress(chain: string, network: string, address: string): ProgramInfo | null {
    const entries = getChainNetwork(chain, network);
    const evm = isEvmChain(chain);
    const normalizedAddr = evm ? address.toLowerCase() : address;

    for (const [name, entry] of Object.entries(entries)) {
      const entryAddr = evm ? entry.address.toLowerCase() : entry.address;
      if (entryAddr === normalizedAddr) {
        return { address: entry.address, name };
      }
    }
    return null;
  }

  function crossCheck(chain: string, network: string, name: string, address: string): boolean {
    const resolved = resolveName(chain, network, name);
    if (!resolved) return false;
    const evm = isEvmChain(chain);
    const a = evm ? resolved.address.toLowerCase() : resolved.address;
    const b = evm ? address.toLowerCase() : address;
    return a === b;
  }

  return { resolveName, resolveAddress, crossCheck };
}

function mergeDeep(
  base: Record<string, Record<string, Record<string, { address: string }>>>,
  overrides: Record<string, Record<string, Record<string, { address: string }>>>,
): Record<string, Record<string, Record<string, { address: string }>>> {
  const result = { ...base };
  for (const [chain, networks] of Object.entries(overrides)) {
    if (!result[chain]) {
      result[chain] = networks;
      continue;
    }
    result[chain] = { ...result[chain] };
    for (const [network, progs] of Object.entries(networks)) {
      result[chain][network] = { ...result[chain][network], ...progs };
    }
  }
  return result;
}
