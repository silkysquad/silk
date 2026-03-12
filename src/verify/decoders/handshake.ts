import { PublicKey } from '@solana/web3.js';
import { formatUnits } from '../../amount-utils.js';

export interface HandshakeDecoded {
  type: string;
  params: Record<string, unknown>;
}

// Anchor discriminators: sha256("global:{name}")[0:8]
const DISCRIMINATORS: Record<string, number[]> = {
  create_transfer: [142, 232, 86, 212, 85, 158, 131, 190],
  claim_transfer:  [202, 178, 58, 190, 230, 234, 229, 17],
  cancel_transfer: [50, 32, 70, 130, 142, 41, 111, 175],
  decline_transfer: [157, 102, 22, 26, 29, 72, 206, 181],
  reject_transfer: [250, 250, 180, 34, 151, 19, 110, 207],
  expire_transfer: [120, 220, 22, 191, 234, 70, 205, 117],
  destroy_transfer: [213, 186, 122, 7, 20, 48, 250, 144],
  init_pool:       [116, 233, 199, 204, 115, 159, 171, 36],
  pause_pool:      [160, 15, 12, 189, 160, 0, 243, 245],
  reset_pool:      [108, 172, 93, 91, 146, 8, 155, 112],
  close_pool:      [140, 189, 209, 23, 239, 62, 239, 11],
  withdraw_fees:   [198, 212, 171, 109, 144, 215, 174, 89],
};

function matchDiscriminator(data: Buffer): string | null {
  if (data.length < 8) return null;
  for (const [name, disc] of Object.entries(DISCRIMINATORS)) {
    if (disc.every((b, i) => data[i] === b)) return name;
  }
  return null;
}

// Borsh readers
function readPubkey(buf: Buffer, offset: number): [string, number] {
  const key = new PublicKey(buf.subarray(offset, offset + 32)).toBase58();
  return [key, offset + 32];
}

function readU64(buf: Buffer, offset: number): [bigint, number] {
  return [buf.readBigUInt64LE(offset), offset + 8];
}

function readI64(buf: Buffer, offset: number): [bigint, number] {
  return [buf.readBigInt64LE(offset), offset + 8];
}

function readString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  offset += 4;
  const str = buf.subarray(offset, offset + len).toString('utf-8');
  return [str, offset + len];
}

function readOptionU8(buf: Buffer, offset: number): [number | null, number] {
  const isSome = buf[offset] === 1;
  offset += 1;
  if (!isSome) return [null, offset];
  return [buf[offset], offset + 1];
}

export function decodeHandshake(
  data: Buffer,
  accounts: string[],
  tokenSymbol: (mint: string) => string,
  tokenDecimals: (mint: string) => number,
): HandshakeDecoded | null {
  const name = matchDiscriminator(data);
  if (!name) return null;

  let offset = 8; // skip discriminator

  switch (name) {
    case 'create_transfer': {
      // Accounts: sender, pool, mint, pool_token_account, sender_token_account, transfer, token_program, system_program, associated_token_program
      const mint = accounts[2] ?? null;
      const symbol = mint ? tokenSymbol(mint) : 'unknown';
      const decimals = mint ? tokenDecimals(mint) : 6;

      let recipient: string, nonce: bigint, amount: bigint, memo: string, claimableAfter: bigint, claimableUntil: bigint;
      try {
        [recipient, offset] = readPubkey(data, offset);
        [nonce, offset] = readU64(data, offset);
        [amount, offset] = readU64(data, offset);
        [memo, offset] = readString(data, offset);
        [claimableAfter, offset] = readI64(data, offset);
        [claimableUntil, offset] = readI64(data, offset);
      } catch {
        return { type: 'create_transfer', params: { sender: accounts[0], decodeError: 'failed to parse args' } };
      }

      const humanAmount = formatUnits(amount, decimals);

      return {
        type: 'create_transfer',
        params: {
          sender: accounts[0] ?? null,
          recipient,
          pool: accounts[1] ?? null,
          mint,
          amount: amount.toString(),
          amountHuman: `${humanAmount} ${symbol}`,
          memo: memo || null,
          claimableAfter: claimableAfter === 0n ? null : Number(claimableAfter),
          claimableUntil: claimableUntil === 0n ? null : Number(claimableUntil),
          nonce: nonce.toString(),
        },
      };
    }

    case 'claim_transfer':
      // Accounts: recipient, pool, mint, pool_token_account, recipient_token_account, transfer, sender, token_program
      return {
        type: 'claim_transfer',
        params: {
          claimer: accounts[0] ?? null,
          transferPda: accounts[5] ?? null,
          sender: accounts[6] ?? null,
        },
      };

    case 'cancel_transfer':
      // Accounts: sender, pool, mint, pool_token_account, sender_token_account, transfer, token_program
      return {
        type: 'cancel_transfer',
        params: {
          sender: accounts[0] ?? null,
          transferPda: accounts[5] ?? null,
        },
      };

    case 'decline_transfer': {
      let reason: number | null = null;
      try { [reason] = readOptionU8(data, offset); } catch { /* ok */ }
      return {
        type: 'decline_transfer',
        params: {
          recipient: accounts[0] ?? null,
          transferPda: accounts[5] ?? null,
          reason,
        },
      };
    }

    case 'reject_transfer': {
      let reason: number | null = null;
      try { [reason] = readOptionU8(data, offset); } catch { /* ok */ }
      return {
        type: 'reject_transfer',
        params: {
          operator: accounts[0] ?? null,
          transferPda: accounts[5] ?? null,
          reason,
        },
      };
    }

    case 'expire_transfer':
      return {
        type: 'expire_transfer',
        params: {
          caller: accounts[0] ?? null,
          transferPda: accounts[5] ?? null,
        },
      };

    case 'init_pool':
      return {
        type: 'init_pool',
        params: {
          operator: accounts[0] ?? null,
          mint: accounts[1] ?? null,
          pool: accounts[2] ?? null,
        },
      };

    case 'pause_pool':
      return {
        type: 'pause_pool',
        params: {
          operator: accounts[0] ?? null,
          pool: accounts[1] ?? null,
        },
      };

    case 'withdraw_fees':
      return {
        type: 'withdraw_fees',
        params: {
          operator: accounts[0] ?? null,
          pool: accounts[1] ?? null,
        },
      };

    default:
      return { type: name, params: {} };
  }
}
