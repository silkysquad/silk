import type { ActionIntent, Confidence, Constraint } from './types.js';
import type { InstructionAnalysis, RiskFlag } from '../verify/index.js';
import { evaluateConstraint } from './constraints.js';
import { normalizeAddress } from './chains.js';
import { extractAmountFromHuman } from '../amount-utils.js';

// Known actions that get deep field-level verification
const KNOWN_ACTIONS = new Set([
  'transfer', 'swap', 'stake', 'lend', 'borrow', 'approve', 'withdraw',
]);

export interface MatchResult {
  matched: boolean;
  confidence: Confidence;
  discrepancies: string[];
}

export function matchIntent(
  actions: ActionIntent[],
  instructions: InstructionAnalysis[],
  globalFlags: RiskFlag[],
  chain: string,
  strict: boolean,
  expectedProgram?: string,
): MatchResult {
  const discrepancies: string[] = [];
  let lowestConfidence: Confidence = 'full';

  // Error-severity flags are automatic failures
  for (const flag of globalFlags) {
    if (flag.severity === 'error') {
      discrepancies.push(flag.message);
    }
  }

  // Match each action against the instructions
  const usedIndices = new Set<number>();

  for (const action of actions) {
    const actionResult = matchSingleAction(action, instructions, usedIndices, chain, expectedProgram);
    discrepancies.push(...actionResult.discrepancies);

    if (confidenceRank(actionResult.confidence) < confidenceRank(lowestConfidence)) {
      lowestConfidence = actionResult.confidence;
    }

    if (actionResult.matchedIndex !== null) {
      usedIndices.add(actionResult.matchedIndex);
    }
  }

  // In strict mode, check for unaccounted instructions
  if (strict) {
    for (const ix of instructions) {
      if (!usedIndices.has(ix.index) && !isAncillary(ix)) {
        discrepancies.push(`Strict mode: instruction ${ix.index} (${ix.type ?? ix.programId}) is not part of the intent.`);
      }
    }
  }

  const matched = discrepancies.length === 0 && lowestConfidence !== 'unverified';

  return { matched, confidence: lowestConfidence, discrepancies };
}

interface SingleActionResult {
  confidence: Confidence;
  discrepancies: string[];
  matchedIndex: number | null;
}

function matchSingleAction(
  action: ActionIntent,
  instructions: InstructionAnalysis[],
  usedIndices: Set<number>,
  chain: string,
  expectedProgram?: string,
): SingleActionResult {
  const discrepancies: string[] = [];

  // Find matching instruction by action/type
  const match = instructions.find(
    (ix) => ix.type === action.action && !usedIndices.has(ix.index),
  );

  if (!match) {
    discrepancies.push(`Expected a '${action.action}' instruction but none was found in the transaction.`);
    return { confidence: 'full', discrepancies, matchedIndex: null };
  }

  // Check expected program
  if (expectedProgram && match.programId !== expectedProgram) {
    discrepancies.push(`Expected program ${expectedProgram} but instruction calls ${match.programId}`);
  }

  // Unknown actions get structural match only
  if (!KNOWN_ACTIONS.has(action.action)) {
    return { confidence: 'unverified', discrepancies, matchedIndex: match.index };
  }

  // Deep field comparison for known actions
  const params = match.params;
  const fieldDiscrepancies = compareFields(action, params, chain);
  discrepancies.push(...fieldDiscrepancies);

  return { confidence: 'full', discrepancies, matchedIndex: match.index };
}

function compareFields(
  action: ActionIntent,
  params: Record<string, unknown>,
  chain: string,
): string[] {
  const discrepancies: string[] = [];

  // Address fields to compare
  const addressFields = ['from', 'to', 'owner', 'spender', 'validator'] as const;
  for (const field of addressFields) {
    const intentValue = (action as Record<string, unknown>)[field] as string | undefined;
    const paramValue = params[field] as string | undefined;
    if (intentValue && paramValue) {
      if (normalizeAddress(intentValue, chain) !== normalizeAddress(paramValue, chain)) {
        discrepancies.push(`Field '${field}' mismatch: expected ${intentValue}, got ${paramValue}`);
      }
    }
  }

  // Amount fields to compare (with constraint support)
  const amountFields = ['amount', 'amountIn', 'amountOut'] as const;
  for (const field of amountFields) {
    const intentValue = (action as Record<string, unknown>)[field] as Constraint<string | number> | undefined;
    if (intentValue === undefined) continue;

    const humanKey = field === 'amount' ? 'amountHuman' : `${field}Human`;
    const humanStr = params[humanKey] as string | undefined;
    if (!humanStr) continue;

    const actual = extractAmountFromHuman(humanStr);
    if (!actual) continue;

    if (!evaluateConstraint(intentValue, actual)) {
      discrepancies.push(`Field '${field}' mismatch: expected ${JSON.stringify(intentValue)}, got ${humanStr}`);
    }
  }

  // Memo field (exact match)
  const intentMemo = (action as Record<string, unknown>)['memo'] as string | undefined;
  const paramMemo = params['memo'] as string | undefined;
  if (intentMemo && paramMemo && intentMemo !== paramMemo) {
    discrepancies.push(`Memo mismatch: expected "${intentMemo}", got "${paramMemo}"`);
  }

  return discrepancies;
}

function confidenceRank(c: Confidence): number {
  switch (c) {
    case 'full': return 2;
    case 'partial': return 1;
    case 'unverified': return 0;
  }
}

// Instructions that are considered ancillary (not part of the user's intent)
const ANCILLARY_TYPES = new Set([
  'set_compute_unit_price', 'set_compute_unit_limit',
  'memo',
  'create', 'create_idempotent',
]);

function isAncillary(ix: InstructionAnalysis): boolean {
  return ANCILLARY_TYPES.has(ix.type ?? '');
}
