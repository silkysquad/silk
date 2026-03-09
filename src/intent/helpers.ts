import type { Intent, SingleIntent, CompoundIntent, ActionIntent, ProgramRef, ExecutionRef } from './types.js';

export function isSingleIntent(intent: Intent): intent is SingleIntent {
  return 'action' in intent;
}

export function isCompoundIntent(intent: Intent): intent is CompoundIntent {
  return 'actions' in intent;
}

export function getActions(intent: Intent): ActionIntent[] {
  if (isCompoundIntent(intent)) {
    return intent.actions;
  }
  // Extract just the action fields (without chain/strict/program/programName/signer/feePayer)
  const { chain: _chain, strict: _strict, program: _program, programName: _programName, signer: _signer, feePayer: _feePayer, ...action } = intent as SingleIntent;
  return [action as ActionIntent];
}

export function getProgramRef(intent: Intent): ProgramRef {
  return {
    programName: intent.programName,
    program: intent.program,
  };
}

export function getExecutionRef(intent: Intent): ExecutionRef {
  return {
    signer: intent.signer,
    feePayer: intent.feePayer,
  };
}
