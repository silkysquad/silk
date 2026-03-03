import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { decodeSilkysig } from '../../decoders/silkysig.js';

const ALICE = Keypair.generate();
const BOB = Keypair.generate();
const SILK_ACCOUNT = Keypair.generate();
const MINT = Keypair.generate();

const stubSymbol = () => 'USDC';
const stubDecimals = () => 6;

// Discriminators from silkysig.ts source
const DISC = {
  create_account:        [99, 20, 130, 119, 196, 235, 131, 149],
  deposit:               [242, 35, 198, 137, 82, 225, 242, 182],
  transfer_from_account: [9, 168, 230, 150, 118, 31, 189, 73],
  add_operator:          [149, 142, 187, 68, 33, 250, 87, 105],
  toggle_pause:          [238, 237, 206, 27, 255, 95, 123, 229],
};

function borshU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

function borshPubkey(key: Keypair): Buffer {
  return Buffer.from(key.publicKey.toBytes());
}

describe('decodeSilkysig', () => {
  it('decodes create_account', () => {
    const data = Buffer.from(DISC.create_account);
    const accounts = [
      ALICE.publicKey.toBase58(),
      MINT.publicKey.toBase58(),
      SILK_ACCOUNT.publicKey.toBase58(),
    ];

    const result = decodeSilkysig(data, accounts, stubSymbol, stubDecimals);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('create_account');
    expect(result!.params['owner']).toBe(ALICE.publicKey.toBase58());
    expect(result!.params['mint']).toBe(MINT.publicKey.toBase58());
    expect(result!.params['silkAccount']).toBe(SILK_ACCOUNT.publicKey.toBase58());
  });

  it('decodes deposit with amount', () => {
    const data = Buffer.concat([
      Buffer.from(DISC.deposit),
      borshU64(50_000_000n), // 50 USDC
    ]);
    const accounts = [
      ALICE.publicKey.toBase58(),        // depositor
      SILK_ACCOUNT.publicKey.toBase58(), // silk_account
      MINT.publicKey.toBase58(),         // mint
      'AccountToken', 'DepositorToken', 'TokenProgram',
    ];

    const result = decodeSilkysig(data, accounts, stubSymbol, stubDecimals);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('deposit');
    expect(result!.params['depositor']).toBe(ALICE.publicKey.toBase58());
    expect(result!.params['amount']).toBe('50000000');
    expect(result!.params['amountHuman']).toBe('50 USDC');
  });

  it('decodes transfer_from_account', () => {
    const data = Buffer.concat([
      Buffer.from(DISC.transfer_from_account),
      borshU64(25_000_000n), // 25 USDC
    ]);
    const accounts = [
      ALICE.publicKey.toBase58(),        // signer
      SILK_ACCOUNT.publicKey.toBase58(), // silk_account
      MINT.publicKey.toBase58(),         // mint
      'AccountToken',
      BOB.publicKey.toBase58(),          // recipient
      'RecipientToken', 'TokenProgram',
    ];

    const result = decodeSilkysig(data, accounts, stubSymbol, stubDecimals);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('transfer_from_account');
    expect(result!.params['signer']).toBe(ALICE.publicKey.toBase58());
    expect(result!.params['recipient']).toBe(BOB.publicKey.toBase58());
    expect(result!.params['amount']).toBe('25000000');
    expect(result!.params['amountHuman']).toBe('25 USDC');
  });

  it('decodes toggle_pause', () => {
    const data = Buffer.from(DISC.toggle_pause);
    const accounts = [
      ALICE.publicKey.toBase58(),
      SILK_ACCOUNT.publicKey.toBase58(),
    ];

    const result = decodeSilkysig(data, accounts, stubSymbol, stubDecimals);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('toggle_pause');
    expect(result!.params['owner']).toBe(ALICE.publicKey.toBase58());
  });

  it('returns null for unrecognized discriminator', () => {
    expect(decodeSilkysig(Buffer.alloc(8), [], stubSymbol, stubDecimals)).toBeNull();
  });
});
