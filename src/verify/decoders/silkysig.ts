import { PublicKey } from '@solana/web3.js';
import { formatUnits } from '../../amount-utils.js';

export interface SilkysigDecoded {
  type: string;
  params: Record<string, unknown>;
}

// Anchor discriminators: sha256("global:{name}")[0:8]
const DISCRIMINATORS: Record<string, number[]> = {
  create_account:        [99, 20, 130, 119, 196, 235, 131, 149],
  deposit:               [242, 35, 198, 137, 82, 225, 242, 182],
  transfer_from_account: [9, 168, 230, 150, 118, 31, 189, 73],
  init_drift_user:       [32, 47, 206, 180, 199, 171, 115, 93],
  add_operator:          [149, 142, 187, 68, 33, 250, 87, 105],
  remove_operator:       [84, 183, 126, 251, 137, 150, 214, 134],
  toggle_pause:          [238, 237, 206, 27, 255, 95, 123, 229],
  close_account:         [125, 255, 149, 14, 110, 34, 72, 24],
};

function matchDiscriminator(data: Buffer): string | null {
  if (data.length < 8) return null;
  for (const [name, disc] of Object.entries(DISCRIMINATORS)) {
    if (disc.every((b, i) => data[i] === b)) return name;
  }
  return null;
}

function readU64(buf: Buffer, offset: number): [bigint, number] {
  return [buf.readBigUInt64LE(offset), offset + 8];
}

function readPubkey(buf: Buffer, offset: number): [string, number] {
  const key = new PublicKey(buf.subarray(offset, offset + 32)).toBase58();
  return [key, offset + 32];
}

function readOptionU64(buf: Buffer, offset: number): [bigint | null, number] {
  const isSome = buf[offset] === 1;
  offset += 1;
  if (!isSome) return [null, offset];
  const val = buf.readBigUInt64LE(offset);
  return [val, offset + 8];
}

export function decodeSilkysig(
  data: Buffer,
  accounts: string[],
  tokenSymbol: (mint: string) => string,
  tokenDecimals: (mint: string) => number,
): SilkysigDecoded | null {
  const name = matchDiscriminator(data);
  if (!name) return null;

  let offset = 8;

  switch (name) {
    case 'create_account':
      // Accounts: owner, mint, silk_account, account_token_account, ...
      return {
        type: 'create_account',
        params: {
          owner: accounts[0] ?? null,
          mint: accounts[1] ?? null,
          silkAccount: accounts[2] ?? null,
        },
      };

    case 'deposit': {
      // Accounts: depositor, silk_account, mint, account_token_account, depositor_token_account, token_program
      const mint = accounts[2] ?? null;
      const symbol = mint ? tokenSymbol(mint) : 'unknown';
      const decimals = mint ? tokenDecimals(mint) : 6;
      let amount: bigint;
      try { [amount, offset] = readU64(data, offset); } catch { return { type: 'deposit', params: { depositor: accounts[0] } }; }
      const humanAmount = formatUnits(amount, decimals);
      return {
        type: 'deposit',
        params: {
          depositor: accounts[0] ?? null,
          silkAccount: accounts[1] ?? null,
          mint,
          amount: amount.toString(),
          amountHuman: `${humanAmount} ${symbol}`,
        },
      };
    }

    case 'transfer_from_account': {
      // Accounts: signer, silk_account, mint, account_token_account, recipient, recipient_token_account, ...
      const mint = accounts[2] ?? null;
      const symbol = mint ? tokenSymbol(mint) : 'unknown';
      const decimals = mint ? tokenDecimals(mint) : 6;
      let amount: bigint;
      try { [amount, offset] = readU64(data, offset); } catch { return { type: 'transfer_from_account', params: { signer: accounts[0] } }; }
      const humanAmount = formatUnits(amount, decimals);
      return {
        type: 'transfer_from_account',
        params: {
          signer: accounts[0] ?? null,
          silkAccount: accounts[1] ?? null,
          mint,
          recipient: accounts[4] ?? null,
          amount: amount.toString(),
          amountHuman: `${humanAmount} ${symbol}`,
        },
      };
    }

    case 'add_operator': {
      let operator: string, perTxLimit: bigint | null;
      try {
        [operator, offset] = readPubkey(data, offset);
        [perTxLimit, offset] = readOptionU64(data, offset);
      } catch {
        return { type: 'add_operator', params: { owner: accounts[0] } };
      }
      return {
        type: 'add_operator',
        params: {
          owner: accounts[0] ?? null,
          silkAccount: accounts[1] ?? null,
          operator,
          perTxLimit: perTxLimit?.toString() ?? null,
        },
      };
    }

    case 'remove_operator': {
      let operator: string;
      try { [operator, offset] = readPubkey(data, offset); } catch { return { type: 'remove_operator', params: { owner: accounts[0] } }; }
      return {
        type: 'remove_operator',
        params: {
          owner: accounts[0] ?? null,
          silkAccount: accounts[1] ?? null,
          operator,
        },
      };
    }

    case 'toggle_pause':
      return {
        type: 'toggle_pause',
        params: {
          owner: accounts[0] ?? null,
          silkAccount: accounts[1] ?? null,
        },
      };

    case 'close_account':
      return {
        type: 'close_account',
        params: {
          owner: accounts[0] ?? null,
          silkAccount: accounts[1] ?? null,
        },
      };

    default:
      return { type: name, params: {} };
  }
}
