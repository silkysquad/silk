export interface AtaDecoded {
  type: string;
  params: Record<string, unknown>;
}

// ATA program: u8 discriminator at byte 0 (or no data = Create in older versions)
export function decodeAta(data: Buffer, accounts: string[]): AtaDecoded {
  const index = data.length > 0 ? data[0] : 0;
  const isIdempotent = index === 1;

  // Accounts: [fundingAccount, newATA, walletAddress, tokenMintAddress, systemProgram, tokenProgram]
  return {
    type: isIdempotent ? 'create_idempotent' : 'create',
    params: {
      funder: accounts[0] ?? null,
      newAta: accounts[1] ?? null,
      wallet: accounts[2] ?? null,
      mint: accounts[3] ?? null,
    },
  };
}
