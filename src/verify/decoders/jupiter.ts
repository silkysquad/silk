export interface JupiterDecoded {
  type: string;
  params: Record<string, unknown>;
}

// Jupiter v6 uses a complex routing format. We do best-effort identification
// of the top-level instruction type without full decoding.
// The discriminator structure follows Anchor conventions.
const KNOWN_TYPES: Record<string, string> = {
  'e517cb977ae3ad2a': 'route',
  'c1209b3341d69c81': 'route_with_token_ledger',
  '9279c41c15427612': 'shared_accounts_route',
  '36d7ebfe04130a5b': 'shared_accounts_route_with_token_ledger',
  'b0d169a89a7d453e': 'exact_out_route',
  'a6c1780c5e87f5b2': 'shared_accounts_exact_out_route',
};

export function decodeJupiter(data: Buffer, accounts: string[]): JupiterDecoded {
  if (data.length >= 8) {
    const discHex = Buffer.from(data.subarray(0, 8)).toString('hex');
    const typeName = KNOWN_TYPES[discHex];
    if (typeName) {
      return {
        type: typeName,
        params: {
          // We can identify the source and destination token accounts from accounts list
          // but full route decoding requires Jupiter-specific Borsh schemas
          sourceTokenAccount: accounts[2] ?? null,
          destinationTokenAccount: accounts[3] ?? null,
          note: 'Jupiter route — full params not decoded, verify input/output token accounts',
        },
      };
    }
  }

  return {
    type: 'unknown_jupiter_instruction',
    params: {
      note: 'Unknown Jupiter instruction — discriminator not recognized',
    },
  };
}
