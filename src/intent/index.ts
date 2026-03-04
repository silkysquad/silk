import type { Intent, VerifyResult } from './types.js';
import type { AnalyzeOptions, TransactionAnalysis } from '../verify/index.js';
import { analyzeTransaction as solanaAnalyze } from '../verify/index.js';
import { parseChain } from './chains.js';
import { getActions } from './helpers.js';
import { matchIntent } from './matcher.js';

export type { Intent, SingleIntent, CompoundIntent, ActionIntent, Constraint, TokenRef, VerifyResult, Confidence } from './types.js';
export type { TransferIntent, SwapIntent, StakeIntent, LendIntent, BorrowIntent, ApproveIntent, WithdrawIntent, CustomIntent } from './types.js';
export { evaluateConstraint } from './constraints.js';
export { createTokenRegistry } from './token-registry.js';
export { parseChain, normalizeAddress, isEvmChain } from './chains.js';

// Maps generic action names to adapter-specific decoded instruction types.
const SOLANA_ACTION_MAP: Record<string, string> = {
  transfer: 'create_transfer',
};

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

  const { chain } = parseChain(intent.chain);
  const strict = intent.strict ?? false;
  const actions = getActions(intent);

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

  const result = matchIntent(actions, analysis.instructions, analysis.flags, chain, strict);

  return {
    matched: result.matched,
    confidence: result.confidence,
    discrepancies: result.discrepancies,
    analysis,
  };
}
