import type { Intent, SingleIntent, CompoundIntent, ActionIntent } from './types.js';

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
  // Extract just the action fields (without chain/strict)
  const { chain: _chain, strict: _strict, ...action } = intent as SingleIntent;
  return [action as ActionIntent];
}
