import type { InstructionAnalysis, RiskFlag } from './index.js';

// Known program IDs that are safe to receive SOL from System Program transfers
// (e.g. rent payments, account creation). Transfers to these are not flagged.
const KNOWN_SAFE_PROGRAMS = new Set([
  '11111111111111111111111111111111',            // System Program itself
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bC5', // ATA
  'ComputeBudget111111111111111111111111111111', // Compute Budget
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', // Memo
  'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ', // Handshake
  'SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS',  // Silkysig
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter v6
  'SysvarRent111111111111111111111111111111111',    // Sysvar Rent
  'SysvarC1ock11111111111111111111111111111111',    // Sysvar Clock
]);

export function applyGlobalFlags(
  instructions: InstructionAnalysis[],
  feePayer: string,
  knownAddresses: Set<string>,
): RiskFlag[] {
  const flags: RiskFlag[] = [];

  // Collect all addresses involved in the transaction (for context)
  const txAddresses = new Set<string>([feePayer, ...knownAddresses]);
  for (const ix of instructions) {
    if (ix.programId) txAddresses.add(ix.programId);
  }

  for (const ix of instructions) {
    // Rule: UNKNOWN_PROGRAM
    if (!ix.known) {
      flags.push({
        severity: 'error',
        code: 'UNKNOWN_PROGRAM',
        message: `Instruction ${ix.index} calls unknown program ${ix.programId} — this instruction cannot be verified.`,
        instructionIndex: ix.index,
      });
    }

    // Rule: UNEXPECTED_SOL_DRAIN
    // A System Program transfer to an address that isn't the fee payer, a new account
    // being created, or a known safe program is suspicious.
    if (
      ix.programId === '11111111111111111111111111111111' &&
      ix.type === 'transfer' &&
      ix.params
    ) {
      const to = ix.params['to'] as string | null;
      if (to && !txAddresses.has(to) && !KNOWN_SAFE_PROGRAMS.has(to)) {
        flags.push({
          severity: 'error',
          code: 'UNEXPECTED_SOL_DRAIN',
          message: `Instruction ${ix.index} transfers SOL to unrecognized address ${to} — potential drain.`,
          instructionIndex: ix.index,
        });
      }
    }

    // Rule: LARGE_COMPUTE_BUDGET
    if (
      ix.programId === 'ComputeBudget111111111111111111111111111111' &&
      ix.type === 'set_compute_unit_price'
    ) {
      flags.push({
        severity: 'info',
        code: 'LARGE_COMPUTE_BUDGET',
        message: `Instruction ${ix.index} sets a priority fee (${ix.params['microLamports']} microLamports/CU).`,
        instructionIndex: ix.index,
      });
    }
  }

  return flags;
}

export function applyTokenTransferFlags(
  instructions: InstructionAnalysis[],
  intentAddresses: Set<string>,
): RiskFlag[] {
  const flags: RiskFlag[] = [];

  for (const ix of instructions) {
    // Rule: UNEXPECTED_TOKEN_TRANSFER
    // SPL Token transfer/transfer_checked where the destination isn't in the intent's known addresses
    if (
      ix.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' &&
      (ix.type === 'transfer' || ix.type === 'transfer_checked') &&
      ix.params
    ) {
      const destination = ix.params['destination'] as string | null;
      if (destination && intentAddresses.size > 0 && !intentAddresses.has(destination)) {
        flags.push({
          severity: 'warning',
          code: 'UNEXPECTED_TOKEN_TRANSFER',
          message: `Instruction ${ix.index} transfers tokens to ${destination}, which is not part of the requested intent.`,
          instructionIndex: ix.index,
        });
      }
    }
  }

  return flags;
}
