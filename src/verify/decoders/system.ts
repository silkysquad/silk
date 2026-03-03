import { PublicKey } from '@solana/web3.js';

export interface SystemDecoded {
  type: string;
  params: Record<string, unknown>;
}

// System Program instruction indices (u32 LE at bytes 0-3)
const IX = {
  CreateAccount: 0,
  Assign: 1,
  Transfer: 2,
  CreateAccountWithSeed: 3,
  AdvanceNonceAccount: 4,
  WithdrawNonceAccount: 5,
  InitializeNonceAccount: 6,
  AuthorizeNonceAccount: 7,
  Allocate: 8,
  AllocateWithSeed: 9,
  AssignWithSeed: 10,
  TransferWithSeed: 11,
} as const;

export function decodeSystem(
  data: Buffer,
  accounts: string[],
): SystemDecoded | null {
  if (data.length < 4) return null;
  const index = data.readUInt32LE(0);

  switch (index) {
    case IX.Transfer: {
      if (data.length < 12) return null;
      const lamports = data.readBigUInt64LE(4);
      return {
        type: 'transfer',
        params: {
          from: accounts[0] ?? null,
          to: accounts[1] ?? null,
          lamports: lamports.toString(),
          sol: (Number(lamports) / 1e9).toFixed(9).replace(/\.?0+$/, ''),
        },
      };
    }
    case IX.CreateAccount: {
      if (data.length < 52) return null;
      const lamports = data.readBigUInt64LE(4);
      const space = data.readBigUInt64LE(12);
      const programId = new PublicKey(data.subarray(20, 52)).toBase58();
      return {
        type: 'create_account',
        params: {
          from: accounts[0] ?? null,
          newAccount: accounts[1] ?? null,
          lamports: lamports.toString(),
          sol: (Number(lamports) / 1e9).toFixed(9).replace(/\.?0+$/, ''),
          space: space.toString(),
          owner: programId,
        },
      };
    }
    case IX.Assign: {
      if (data.length < 36) return null;
      const programId = new PublicKey(data.subarray(4, 36)).toBase58();
      return {
        type: 'assign',
        params: {
          account: accounts[0] ?? null,
          owner: programId,
        },
      };
    }
    case IX.Allocate: {
      if (data.length < 12) return null;
      const space = data.readBigUInt64LE(4);
      return {
        type: 'allocate',
        params: {
          account: accounts[0] ?? null,
          space: space.toString(),
        },
      };
    }
    case IX.AdvanceNonceAccount:
      return { type: 'advance_nonce_account', params: { nonce: accounts[0] ?? null } };
    default:
      return { type: `unknown_system_ix_${index}`, params: {} };
  }
}
