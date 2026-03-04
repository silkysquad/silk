import { formatUnits } from '../../amount-utils.js';

export interface SplTokenDecoded {
  type: string;
  params: Record<string, unknown>;
}

// SPL Token instruction discriminator is u8 at byte 0
const IX = {
  InitializeMint: 0,
  InitializeAccount: 1,
  Transfer: 3,
  Approve: 4,
  Revoke: 5,
  MintTo: 7,
  Burn: 8,
  CloseAccount: 9,
  FreezeAccount: 10,
  ThawAccount: 11,
  TransferChecked: 12,
  ApproveChecked: 13,
  MintToChecked: 14,
  BurnChecked: 15,
  SyncNative: 17,
} as const;

export function decodeSplToken(
  data: Buffer,
  accounts: string[],
  tokenSymbol: (mint: string) => string,
): SplTokenDecoded | null {
  if (data.length < 1) return null;
  const index = data[0];

  switch (index) {
    case IX.Transfer: {
      // [source, destination, authority], amount: u64 at bytes 1-8
      if (data.length < 9) return null;
      const amount = data.readBigUInt64LE(1);
      return {
        type: 'transfer',
        params: {
          source: accounts[0] ?? null,
          destination: accounts[1] ?? null,
          authority: accounts[2] ?? null,
          amount: amount.toString(),
        },
      };
    }
    case IX.TransferChecked: {
      // [source, mint, destination, authority], amount: u64 at bytes 1-8, decimals: u8 at byte 9
      if (data.length < 10) return null;
      const amount = data.readBigUInt64LE(1);
      const decimals = data[9];
      const mint = accounts[1] ?? null;
      const symbol = mint ? tokenSymbol(mint) : 'unknown';
      const humanAmount = mint
        ? formatUnits(amount, decimals)
        : amount.toString();
      return {
        type: 'transfer_checked',
        params: {
          source: accounts[0] ?? null,
          mint,
          destination: accounts[2] ?? null,
          authority: accounts[3] ?? null,
          amount: amount.toString(),
          decimals,
          amountHuman: `${humanAmount} ${symbol}`,
        },
      };
    }
    case IX.MintTo:
    case IX.MintToChecked: {
      if (data.length < 9) return null;
      const amount = data.readBigUInt64LE(1);
      return {
        type: index === IX.MintTo ? 'mint_to' : 'mint_to_checked',
        params: {
          mint: accounts[0] ?? null,
          destination: accounts[1] ?? null,
          authority: accounts[2] ?? null,
          amount: amount.toString(),
        },
      };
    }
    case IX.Burn:
    case IX.BurnChecked: {
      if (data.length < 9) return null;
      const amount = data.readBigUInt64LE(1);
      return {
        type: index === IX.Burn ? 'burn' : 'burn_checked',
        params: {
          account: accounts[0] ?? null,
          mint: accounts[1] ?? null,
          authority: accounts[2] ?? null,
          amount: amount.toString(),
        },
      };
    }
    case IX.CloseAccount:
      return {
        type: 'close_account',
        params: {
          account: accounts[0] ?? null,
          destination: accounts[1] ?? null,
          authority: accounts[2] ?? null,
        },
      };
    case IX.InitializeAccount:
      return {
        type: 'initialize_account',
        params: {
          account: accounts[0] ?? null,
          mint: accounts[1] ?? null,
          owner: accounts[2] ?? null,
        },
      };
    case IX.SyncNative:
      return { type: 'sync_native', params: { account: accounts[0] ?? null } };
    case IX.FreezeAccount:
      return { type: 'freeze_account', params: { account: accounts[0] ?? null, mint: accounts[1] ?? null } };
    case IX.ThawAccount:
      return { type: 'thaw_account', params: { account: accounts[0] ?? null, mint: accounts[1] ?? null } };
    default:
      return { type: `unknown_spl_ix_${index}`, params: {} };
  }
}
