import { Connection, Transaction, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { REGISTRY } from './registry.js';
import { decodeSystem } from './decoders/system.js';
import { decodeSplToken } from './decoders/spl-token.js';
import { decodeAta } from './decoders/ata.js';
import { decodeComputeBudget } from './decoders/compute-budget.js';
import { decodeMemo } from './decoders/memo.js';
import { decodeHandshake } from './decoders/handshake.js';
import { decodeSilkysig } from './decoders/silkysig.js';
import { decodeJupiter } from './decoders/jupiter.js';
import { applyGlobalFlags, applyTokenTransferFlags } from './flags.js';
import { createTokenCache } from './rpc.js';
import { extractAmountFromHuman, parseDecimal, withinRelativeTolerance } from '../amount-utils.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskFlag {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  instructionIndex?: number;
}

export interface InstructionAnalysis {
  index: number;
  programId: string;
  programName: string | null;
  type: string | null;
  known: boolean;
  params: Record<string, unknown>;
  flags: RiskFlag[];
}

export interface TransactionAnalysis {
  feePayer: string;
  instructions: InstructionAnalysis[];
  flags: RiskFlag[];
  summary: string;
}

type TokenSelector =
  | { token: string; tokenAddress?: never }
  | { token?: never; tokenAddress: string };

export type Intent =
  | ({ type: 'create_transfer'; sender: string; recipient: string; amount: string; memo?: string } & TokenSelector)
  | { type: 'claim_transfer'; claimer: string; transferPda: string }
  | { type: 'cancel_transfer'; canceller: string; transferPda: string }
  | ({ type: 'transfer_from_account'; owner: string; recipient: string; amount: string } & TokenSelector)
  | ({ type: 'deposit'; owner: string; amount: string } & TokenSelector);

export interface VerifyResult {
  verified: boolean;
  discrepancies: string[];
  analysis: TransactionAnalysis;
}

export interface AnalyzeOptions {
  connection?: Connection;
  /** Override the bundled registry. Merged with the bundled one — custom entries win. */
  config?: {
    programs?: Record<string, { name: string; decoder: string }>;
    tokens?: Record<string, { symbol: string; decimals: number }>;
  };
}

// ─── Registry loading ────────────────────────────────────────────────────────

function loadRegistry(override?: AnalyzeOptions['config']) {
  return {
    programs: { ...REGISTRY.programs, ...(override?.programs ?? {}) },
    tokens: { ...REGISTRY.tokens, ...(override?.tokens ?? {}) },
  };
}

// ─── Instruction decoding ─────────────────────────────────────────────────────

function decodeInstruction(
  programId: string,
  decoder: string | undefined,
  data: Buffer,
  accounts: string[],
  tokenCache: ReturnType<typeof createTokenCache>,
): { type: string | null; params: Record<string, unknown> } {
  try {
    switch (decoder) {
      case 'system': {
        const r = decodeSystem(data, accounts);
        return r ? { type: r.type, params: r.params } : { type: null, params: {} };
      }
      case 'spl-token': {
        const r = decodeSplToken(data, accounts, (m) => tokenCache.getSymbol(m));
        return r ? { type: r.type, params: r.params } : { type: null, params: {} };
      }
      case 'ata': {
        const r = decodeAta(data, accounts);
        return { type: r.type, params: r.params };
      }
      case 'compute-budget': {
        const r = decodeComputeBudget(data);
        return { type: r.type, params: r.params };
      }
      case 'memo': {
        const r = decodeMemo(data);
        return { type: r.type, params: r.params };
      }
      case 'handshake': {
        const r = decodeHandshake(
          data, accounts,
          (m) => tokenCache.getSymbol(m),
          (m) => tokenCache.getDecimals(m),
        );
        return r ? { type: r.type, params: r.params } : { type: null, params: {} };
      }
      case 'silkysig': {
        const r = decodeSilkysig(
          data, accounts,
          (m) => tokenCache.getSymbol(m),
          (m) => tokenCache.getDecimals(m),
        );
        return r ? { type: r.type, params: r.params } : { type: null, params: {} };
      }
      case 'jupiter': {
        const r = decodeJupiter(data, accounts);
        return { type: r.type, params: r.params };
      }
      default:
        return { type: null, params: {} };
    }
  } catch {
    return { type: null, params: { decodeError: 'failed to decode instruction data' } };
  }
}

// ─── Transaction deserialization ──────────────────────────────────────────────

interface RawInstruction {
  programId: string;
  accounts: string[];
  data: Buffer;
}

function deserializeTx(txBase64: string): { feePayer: string; instructions: RawInstruction[] } {
  const buf = Buffer.from(txBase64, 'base64');

  // Try versioned first, fall back to legacy
  let feePayer: string;
  let rawInstructions: RawInstruction[];

  try {
    const vtx = VersionedTransaction.deserialize(buf);
    const msg = vtx.message;
    const accountKeys: string[] = msg.staticAccountKeys.map((k) => k.toBase58());

    // For versioned transactions, append lookup table keys if resolved
    feePayer = accountKeys[0] ?? '';

    rawInstructions = msg.compiledInstructions.map((ix) => ({
      programId: accountKeys[ix.programIdIndex] ?? '',
      accounts: ix.accountKeyIndexes.map((i) => accountKeys[i] ?? ''),
      data: Buffer.from(ix.data),
    }));
  } catch {
    const tx = Transaction.from(buf);
    feePayer = tx.feePayer?.toBase58() ?? tx.signatures[0]?.publicKey?.toBase58() ?? '';

    const msg = tx.compileMessage();
    const accountKeys = msg.accountKeys.map((k) => k.toBase58());

    rawInstructions = msg.instructions.map((ix) => ({
      programId: accountKeys[ix.programIdIndex] ?? '',
      accounts: ix.accounts.map((i) => accountKeys[i] ?? ''),
      data: Buffer.from(ix.data, 'base64'),
    }));
  }

  return { feePayer, instructions: rawInstructions };
}

// ─── Summary generation ───────────────────────────────────────────────────────

function buildSummary(
  feePayer: string,
  instructions: InstructionAnalysis[],
  flags: RiskFlag[],
): string {
  const parts: string[] = [];

  for (const ix of instructions) {
    if (!ix.known) {
      parts.push(`calls unknown program ${ix.programId}`);
      continue;
    }

    const p = ix.params;
    switch (ix.type) {
      case 'create_transfer':
        parts.push(`creates Handshake transfer of ${p['amountHuman']} from ${shorten(p['sender'] as string)} to ${shorten(p['recipient'] as string)}`);
        break;
      case 'claim_transfer':
        parts.push(`claims Handshake transfer (PDA: ${shorten(p['transferPda'] as string)})`);
        break;
      case 'cancel_transfer':
        parts.push(`cancels Handshake transfer (PDA: ${shorten(p['transferPda'] as string)})`);
        break;
      case 'transfer_from_account':
        parts.push(`transfers ${p['amountHuman']} from Silkysig account to ${shorten(p['recipient'] as string)}`);
        break;
      case 'deposit':
        parts.push(`deposits ${p['amountHuman']} into Silkysig account`);
        break;
      case 'transfer':
        if (ix.programId === '11111111111111111111111111111111') {
          parts.push(`transfers ${p['sol']} SOL from ${shorten(p['from'] as string)} to ${shorten(p['to'] as string)}`);
        } else {
          parts.push(`SPL token transfer of ${p['amount']} to ${shorten(p['destination'] as string)}`);
        }
        break;
      case 'transfer_checked':
        parts.push(`SPL token transfer of ${p['amountHuman']} to ${shorten(p['destination'] as string)}`);
        break;
      case 'create':
      case 'create_idempotent':
        parts.push(`creates associated token account for ${shorten(p['wallet'] as string)}`);
        break;
      case 'create_account':
        if (ix.programId === '11111111111111111111111111111111') {
          parts.push(`creates account ${shorten(p['newAccount'] as string)}`);
        } else {
          parts.push(`creates Silkysig account for ${shorten(p['owner'] as string)}`);
        }
        break;
      case 'set_compute_unit_price':
        parts.push(`sets priority fee (${p['microLamports']} microLamports/CU)`);
        break;
      case 'set_compute_unit_limit':
        parts.push(`sets compute unit limit (${p['units']})`);
        break;
      case 'memo':
        parts.push(`memo: "${p['text']}"`);
        break;
      default:
        if (ix.programName) {
          parts.push(`${ix.programName}: ${ix.type}`);
        }
    }
  }

  let summary = parts.length > 0
    ? `Transaction ${parts.join('; ')}.`
    : 'Transaction has no recognized instructions.';

  const errors = flags.filter((f) => f.severity === 'error');
  const warnings = flags.filter((f) => f.severity === 'warning');

  if (errors.length > 0) {
    summary += ` ERROR: ${errors.map((f) => f.message).join(' ')}`;
  } else if (warnings.length > 0) {
    summary += ` WARNING: ${warnings.map((f) => f.message).join(' ')}`;
  }

  return summary;
}

function shorten(addr: string | null | undefined): string {
  if (!addr) return '(unknown)';
  return `${addr.slice(0, 4)}..${addr.slice(-4)}`;
}

// ─── analyzeTransaction ───────────────────────────────────────────────────────

export async function analyzeTransaction(
  txBase64: string,
  opts: AnalyzeOptions = {},
): Promise<TransactionAnalysis> {
  const registry = loadRegistry(opts.config);
  const tokenCache = createTokenCache(registry.tokens, opts.connection);

  const { feePayer, instructions: rawInstructions } = deserializeTx(txBase64);

  // Collect all mints for RPC prefetch
  const mints = rawInstructions.flatMap((ix) => {
    const entry = registry.programs[ix.programId];
    if (!entry) return [];
    // heuristic: mint is often 3rd account in token-program instructions
    return ix.accounts.slice(0, 5);
  });
  await tokenCache.prefetch([...new Set(mints)].filter((a) => a.length === 44));

  // Decode each instruction
  const knownAddresses = new Set<string>();
  const instructions: InstructionAnalysis[] = rawInstructions.map((raw, i) => {
    const entry = registry.programs[raw.programId];
    const known = !!entry;

    raw.accounts.forEach((a) => knownAddresses.add(a));

    const { type, params } = known
      ? decodeInstruction(raw.programId, entry.decoder, raw.data, raw.accounts, tokenCache)
      : { type: null, params: {} };

    return {
      index: i,
      programId: raw.programId,
      programName: entry?.name ?? null,
      type,
      known,
      params,
      flags: [],
    };
  });

  // Apply global flags
  const globalFlags = applyGlobalFlags(instructions, feePayer, knownAddresses);

  // Attach per-instruction flags
  for (const flag of globalFlags) {
    if (flag.instructionIndex !== undefined) {
      instructions[flag.instructionIndex]?.flags.push(flag);
    }
  }

  const summary = buildSummary(feePayer, instructions, globalFlags);

  return { feePayer, instructions, flags: globalFlags, summary };
}

// ─── verifyIntent ─────────────────────────────────────────────────────────────

const AMOUNT_TOLERANCE = parseDecimal('0.0001')!; // 0.01%

export async function verifyIntent(
  txBase64: string,
  intent: Intent,
  opts: AnalyzeOptions = {},
): Promise<VerifyResult> {
  const analysis = await analyzeTransaction(txBase64, opts);
  const discrepancies: string[] = [];
  validateIntentShape(intent, discrepancies);

  // Any error-severity flag is an automatic failure
  const errorFlags = analysis.flags.filter((f) => f.severity === 'error');
  if (errorFlags.length > 0) {
    for (const f of errorFlags) {
      discrepancies.push(f.message);
    }
  }

  // Find the instruction matching the intent type
  const targetType = intent.type;
  const match = analysis.instructions.find((ix) => ix.type === targetType);

  if (!match) {
    discrepancies.push(`Expected a ${targetType} instruction but none was found in the transaction.`);
    return { verified: false, discrepancies, analysis };
  }

  const p = match.params;

  switch (intent.type) {
    case 'create_transfer': {
      if (p['sender'] && normalize(p['sender'] as string) !== normalize(intent.sender)) {
        discrepancies.push(`Sender mismatch: expected ${intent.sender}, got ${p['sender']}`);
      }
      if (p['recipient'] && normalize(p['recipient'] as string) !== normalize(intent.recipient)) {
        discrepancies.push(`Recipient mismatch: expected ${intent.recipient}, got ${p['recipient']}`);
      }
      const txAmount = rawAmount(p['amount'] as string, p);
      if (txAmount !== null && !amountsMatch(txAmount, intent.amount, p)) {
        discrepancies.push(`Amount mismatch: expected ${intent.amount}, got ${humanAmount(p)}`);
      }
      compareTokenSelector(intent, p, discrepancies);
      if (intent.memo && p['memo'] && p['memo'] !== intent.memo) {
        discrepancies.push(`Memo mismatch: expected "${intent.memo}", got "${p['memo']}"`);
      }
      break;
    }

    case 'claim_transfer': {
      if (p['claimer'] && normalize(p['claimer'] as string) !== normalize(intent.claimer)) {
        discrepancies.push(`Claimer mismatch: expected ${intent.claimer}, got ${p['claimer']}`);
      }
      if (p['transferPda'] && normalize(p['transferPda'] as string) !== normalize(intent.transferPda)) {
        discrepancies.push(`Transfer PDA mismatch: expected ${intent.transferPda}, got ${p['transferPda']}`);
      }
      break;
    }

    case 'cancel_transfer': {
      if (p['sender'] && normalize(p['sender'] as string) !== normalize(intent.canceller)) {
        discrepancies.push(`Canceller mismatch: expected ${intent.canceller}, got ${p['sender']}`);
      }
      if (p['transferPda'] && normalize(p['transferPda'] as string) !== normalize(intent.transferPda)) {
        discrepancies.push(`Transfer PDA mismatch: expected ${intent.transferPda}, got ${p['transferPda']}`);
      }
      break;
    }

    case 'transfer_from_account': {
      if (p['signer'] && normalize(p['signer'] as string) !== normalize(intent.owner)) {
        discrepancies.push(`Owner mismatch: expected ${intent.owner}, got ${p['signer']}`);
      }
      if (p['recipient'] && normalize(p['recipient'] as string) !== normalize(intent.recipient)) {
        discrepancies.push(`Recipient mismatch: expected ${intent.recipient}, got ${p['recipient']}`);
      }
      const txAmount = rawAmount(p['amount'] as string, p);
      if (txAmount !== null && !amountsMatch(txAmount, intent.amount, p)) {
        discrepancies.push(`Amount mismatch: expected ${intent.amount}, got ${humanAmount(p)}`);
      }
      compareTokenSelector(intent, p, discrepancies);
      break;
    }

    case 'deposit': {
      if (p['depositor'] && normalize(p['depositor'] as string) !== normalize(intent.owner)) {
        discrepancies.push(`Owner mismatch: expected ${intent.owner}, got ${p['depositor']}`);
      }
      const txAmount = rawAmount(p['amount'] as string, p);
      if (txAmount !== null && !amountsMatch(txAmount, intent.amount, p)) {
        discrepancies.push(`Amount mismatch: expected ${intent.amount}, got ${humanAmount(p)}`);
      }
      compareTokenSelector(intent, p, discrepancies);
      break;
    }
  }

  return {
    verified: discrepancies.length === 0,
    discrepancies,
    analysis,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(addr: string): string {
  try { return new PublicKey(addr).toBase58(); } catch { return addr; }
}

function rawAmount(rawStr: string | undefined, params: Record<string, unknown>): string | null {
  if (!rawStr) return null;
  const human = params['amountHuman'] as string | undefined;
  return extractAmountFromHuman(human);
}

function humanAmount(params: Record<string, unknown>): string {
  return (params['amountHuman'] as string) ?? (params['amount'] as string) ?? 'unknown';
}

function amountsMatch(
  txAmount: string,
  intentAmount: string,
  _params: Record<string, unknown>,
): boolean {
  const parsedTxAmount = parseDecimal(txAmount);
  const parsedIntentAmount = parseDecimal(intentAmount);
  if (parsedTxAmount === null || parsedIntentAmount === null) {
    return false;
  }
  return withinRelativeTolerance(parsedIntentAmount, parsedTxAmount, AMOUNT_TOLERANCE);
}

function parseAmountString(value: string): string | null {
  const parsed = parseDecimal(value);
  return parsed ? value : null;
}

function validateIntentShape(intent: Intent, discrepancies: string[]): void {
  switch (intent.type) {
    case 'create_transfer':
    case 'transfer_from_account':
    case 'deposit': {
      const hasToken = typeof intent.token === 'string' && intent.token.length > 0;
      const hasTokenAddress = typeof intent.tokenAddress === 'string' && intent.tokenAddress.length > 0;
      if ((hasToken && hasTokenAddress) || (!hasToken && !hasTokenAddress)) {
        discrepancies.push(`Intent ${intent.type} must provide exactly one of 'token' or 'tokenAddress'.`);
      }

      if (parseAmountString(intent.amount) === null) {
        discrepancies.push(`Invalid amount for ${intent.type}: expected numeric string, got "${intent.amount}".`);
      }
      break;
    }
    default:
      break;
  }
}

function compareTokenSelector(
  intent: { token?: string; tokenAddress?: string },
  params: Record<string, unknown>,
  discrepancies: string[],
): void {
  const mint = params['mint'] as string | undefined;
  if (!mint) return;

  if (intent.tokenAddress && normalize(mint) !== normalize(intent.tokenAddress)) {
    discrepancies.push(`Token address mismatch: expected ${intent.tokenAddress}, got ${mint}`);
  }

  if (intent.token) {
    const txSymbol = extractSymbolFromAmountHuman(params['amountHuman'] as string | undefined);
    if (txSymbol && txSymbol.toUpperCase() !== intent.token.toUpperCase()) {
      discrepancies.push(`Token symbol mismatch: expected ${intent.token}, got ${txSymbol}`);
    }
  }
}

function extractSymbolFromAmountHuman(amountHuman: string | undefined): string | null {
  if (!amountHuman) return null;
  const parts = amountHuman.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return parts[1] ?? null;
}
