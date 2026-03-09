import type { TransactionAnalysis } from '../verify/index.js';

// ─── Constraints ──────────────────────────────────────────────

export type Constraint<T> = T | {
  gte?: T;
  lte?: T;
  gt?: T;
  lt?: T;
};

// ─── Token identification ─────────────────────────────────────

export type TokenRef = {
  tokenSymbol?: string;
  token?: string;
};

// ─── Program identification ──────────────────────────────────

export type ProgramRef = {
  programName?: string;
  program?: string;
};

// ─── Execution context ───────────────────────────────────────

export type ExecutionRef = {
  signer: string;
  feePayer?: string;
};

// ─── Known actions ────────────────────────────────────────────

export type TransferIntent = {
  action: 'transfer';
  from: string;
  to: string;
  amount: Constraint<string>;
  memo?: string;
} & TokenRef;

export type SwapIntent = {
  action: 'swap';
  from: string;
  tokenIn: TokenRef;
  tokenOut: TokenRef;
  amountIn?: Constraint<string>;
  amountOut?: Constraint<string>;
  slippage?: number;
};

export type StakeIntent = {
  action: 'stake';
  from: string;
  amount: Constraint<string>;
  validator?: string;
  protocol?: string;
} & TokenRef;

export type LendIntent = {
  action: 'lend';
  from: string;
  amount: Constraint<string>;
  protocol?: string;
} & TokenRef;

export type BorrowIntent = {
  action: 'borrow';
  from: string;
  amount: Constraint<string>;
  protocol?: string;
} & TokenRef;

export type ApproveIntent = {
  action: 'approve';
  owner: string;
  spender: string;
  amount: Constraint<string>;
} & TokenRef;

export type WithdrawIntent = {
  action: 'withdraw';
  from: string;
  amount: Constraint<string>;
  protocol?: string;
} & TokenRef;

// ─── Unknown / custom actions ─────────────────────────────────

export type CustomIntent = {
  action: string;
  [key: string]: unknown;
};

// ─── Action union ─────────────────────────────────────────────

export type ActionIntent =
  | TransferIntent
  | SwapIntent
  | StakeIntent
  | LendIntent
  | BorrowIntent
  | ApproveIntent
  | WithdrawIntent
  | CustomIntent;

// ─── Single and compound intents ──────────────────────────────

export type SingleIntent = {
  chain: string;
  strict?: boolean;
} & ExecutionRef & ActionIntent & ProgramRef;

export type CompoundIntent = {
  chain: string;
  strict?: boolean;
  actions: ActionIntent[];
} & ExecutionRef & ProgramRef;

export type Intent = SingleIntent | CompoundIntent;

// ─── Result ───────────────────────────────────────────────────

export type Confidence = 'full' | 'partial' | 'unverified';

export interface VerifyResult {
  matched: boolean;
  confidence: Confidence;
  discrepancies: string[];
  analysis: TransactionAnalysis;
}

// ─── Re-export analysis types from verify module ──────────────

export type { TransactionAnalysis, InstructionAnalysis, RiskFlag } from '../verify/index.js';
