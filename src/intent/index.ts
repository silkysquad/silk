import type { Intent, VerifyResult } from './types.js';
import type { AnalyzeOptions, TransactionAnalysis } from '../verify/index.js';
import { analyzeTransaction as solanaAnalyze } from '../verify/index.js';
import { parseChain } from './chains.js';
import { getActions, getProgramRef } from './helpers.js';
import { matchIntent } from './matcher.js';
import { createProgramRegistry } from './program-registry.js';

export type { Intent, SingleIntent, CompoundIntent, ActionIntent, Constraint, TokenRef, ProgramRef, ExecutionRef, VerifyResult, Confidence } from './types.js';
export type { TransferIntent, SwapIntent, StakeIntent, LendIntent, BorrowIntent, ApproveIntent, WithdrawIntent, CustomIntent } from './types.js';
export type { ProgramInfo } from './program-registry.js';
export { evaluateConstraint } from './constraints.js';
export { createTokenRegistry } from './token-registry.js';
export { createProgramRegistry } from './program-registry.js';
export { getProgramRef, getExecutionRef } from './helpers.js';
export { parseChain, normalizeAddress, isEvmChain } from './chains.js';

// Maps generic action names to adapter-specific decoded instruction types.
const SOLANA_ACTION_MAP: Record<string, string> = {
  transfer: 'create_transfer',
};

const programRegistry = createProgramRegistry();

export async function verifyIntent(
  txBytes: string,
  intent: Intent,
  opts: AnalyzeOptions = {},
): Promise<VerifyResult> {
  if (!intent.chain) {
    return {
      matched: false,
      confidence: 'unverified',
      discrepancies: ['Intent is missing required "chain" field.'],
      analysis: { feePayer: '', instructions: [], flags: [], summary: '' },
    };
  }

  const { chain, network } = parseChain(intent.chain);
  const strict = intent.strict ?? false;
  const actions = getActions(intent);

  // Resolve expected program from ProgramRef
  const programRef = getProgramRef(intent);
  let expectedProgram: string | undefined;

  if (programRef.program && programRef.programName) {
    // Both specified: cross-check
    if (!programRegistry.crossCheck(chain, network, programRef.programName, programRef.program)) {
      return {
        matched: false,
        confidence: 'full',
        discrepancies: [
          `Program cross-check failed: name '${programRef.programName}' does not match address '${programRef.program}'.`,
        ],
        analysis: { feePayer: '', instructions: [], flags: [], summary: '' },
      };
    }
    expectedProgram = programRef.program;
  } else if (programRef.program) {
    expectedProgram = programRef.program;
  } else if (programRef.programName) {
    const resolved = programRegistry.resolveName(chain, network, programRef.programName);
    if (resolved) {
      expectedProgram = resolved.address;
    }
  }

  let analysis: TransactionAnalysis;

  if (chain === 'solana') {
    analysis = await solanaAnalyze(txBytes, opts);

    for (const ix of analysis.instructions) {
      for (const [generic, specific] of Object.entries(SOLANA_ACTION_MAP)) {
        if (ix.type === specific) {
          ix.type = generic;
          if (ix.params['sender']) {
            ix.params['from'] = ix.params['sender'];
          }
          if (ix.params['recipient']) {
            ix.params['to'] = ix.params['recipient'];
          }
        }
      }
    }
  } else {
    return {
      matched: false,
      confidence: 'unverified',
      discrepancies: [`Chain adapter for '${chain}' is not yet implemented.`],
      analysis: { feePayer: '', instructions: [], flags: [], summary: '' },
    };
  }

  const result = matchIntent(actions, analysis.instructions, analysis.flags, chain, strict, expectedProgram);

  return {
    matched: result.matched,
    confidence: result.confidence,
    discrepancies: result.discrepancies,
    analysis,
  };
}
