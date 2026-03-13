import type { Intent } from '../intent/types.js';

export type OrderStatus = 'pending' | 'executing' | 'filled' | 'cancelled' | 'expired' | 'failed';

export interface ExecutionPolicy {
  expiresAt?: string;
  cooldown?: number;
  maxAttempts?: number;
  recurrence?: {
    interval: number;
    remaining?: number;
  };
}

export interface OrderEvent {
  timestamp: string;
  type: 'created' | 'attempted' | 'filled' | 'cancelled' | 'expired' | 'failed';
  reason?: string;
  detail?: string;
  txid?: string;
}

export interface Order {
  id: string;
  intent: Intent;
  policy: ExecutionPolicy;
  status: OrderStatus;
  slippage: number;
  wallet?: string;
  createdAt: string;
  updatedAt: string;
  history: OrderEvent[];
}

export interface EvaluationResult {
  orderId: string;
  status: OrderStatus;
  event: OrderEvent;
}

export interface PriceFeed {
  getPrice(base: string, quote: string): Promise<number | null>;
}
