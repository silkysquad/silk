export { loadConfig, saveConfig, getWallet, getApiUrl, getApiKey, clearApiKey, CONFIG_DIR } from './config.js';
export type { SilkConfig, WalletEntry } from './config.js';
export { loadContacts, saveContacts, addContact, removeContact, getContact, listContacts, resolveRecipient, initContacts } from './contacts.js';
export type { Contact, ContactsStore } from './contacts.js';
export { createHttpClient } from './client.js';
export type { ClientConfig } from './client.js';
export { getTransfer } from './transfers.js';
export type { TransferInfo, TokenInfo, PoolInfo } from './transfers.js';
export { SdkError, ANCHOR_ERROR_MAP, toSdkError } from './errors.js';
export { outputSuccess, outputError, wrapCommand } from './output.js';
export { validateAddress, validateAmount, fetchTransfer, validateClaim, validateCancel, validatePay } from './validate.js';
export { analyzeTransaction, verifyIntent } from './verify/index.js';
export type { TransactionAnalysis, InstructionAnalysis, RiskFlag, VerifyResult, Intent, AnalyzeOptions } from './verify/index.js';

// Cross-chain intent framework
export { verifyIntent as verifyIntentV2 } from './intent/index.js';
export type {
  Intent as IntentV2,
  SingleIntent,
  CompoundIntent,
  ActionIntent,
  Constraint,
  TokenRef,
  ProgramRef,
  ExecutionRef,
  Confidence,
  TransferIntent,
  SwapIntent,
  StakeIntent,
  LendIntent,
  BorrowIntent,
  ApproveIntent,
  WithdrawIntent,
  CustomIntent,
  VerifyResult as VerifyResultV2,
  ProgramInfo,
} from './intent/index.js';
export { evaluateConstraint, createTokenRegistry, createProgramRegistry, getProgramRef, getExecutionRef, parseChain, normalizeAddress, isEvmChain } from './intent/index.js';

// Standing orders
export {
  loadOrders, saveOrders, addOrder, getOrder, updateOrder,
  evaluateOrders,
  parseSwapSugar,
} from './orders/index.js';
export type {
  Order, OrderStatus, ExecutionPolicy, OrderEvent, EvaluationResult, PriceFeed,
  OrdersStore, EvaluateOptions, ServerEvaluateResponse, SwapSugarInput,
} from './orders/index.js';
