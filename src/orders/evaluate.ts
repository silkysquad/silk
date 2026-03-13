import { loadOrders, saveOrders } from './store.js';
import type { Order, OrderEvent, EvaluationResult, PriceFeed } from './types.js';

export interface EvaluateOptions {
  dryRun?: boolean;
  priceFeed?: PriceFeed;
  /** Override for testing — async function that calls the server. If not provided, uses the real HTTP client. */
  serverEvaluate?: (order: Order) => Promise<ServerEvaluateResponse>;
  /** Override for testing — function that signs and submits a transaction. */
  signAndSubmit?: (txBase64: string, order: Order) => Promise<string>;
  /** Override for testing — function that verifies an intent against a transaction. */
  verifyTransaction?: (txBase64: string, order: Order) => Promise<{ matched: boolean; discrepancies: string[] }>;
  /** Override for time source — defaults to Date.now(). */
  now?: () => number;
}

export interface ServerEvaluateResponse {
  executable: boolean;
  transaction?: string;
  quote?: { price: string; amountIn: string; amountOut: string };
  reason?: string;
  detail?: string;
}

function nowMs(opts: EvaluateOptions): number {
  return opts.now ? opts.now() : Date.now();
}

function isExpired(order: Order, now: number): boolean {
  if (!order.policy.expiresAt) return false;
  return new Date(order.policy.expiresAt).getTime() <= now;
}

function isInCooldown(order: Order, now: number): boolean {
  const cooldown = order.policy.cooldown ?? 60;
  const lastAttempt = [...order.history].reverse().find((e) => e.type === 'attempted' || e.type === 'filled' || e.type === 'failed');
  if (!lastAttempt) return false;
  const elapsed = (now - new Date(lastAttempt.timestamp).getTime()) / 1000;
  return elapsed < cooldown;
}

function attemptCount(order: Order): number {
  return order.history.filter((e) => e.type === 'attempted').length;
}

function makeEvent(type: OrderEvent['type'], now: number, extra: Partial<OrderEvent> = {}): OrderEvent {
  return { timestamp: new Date(now).toISOString(), type, ...extra };
}

/** Extract price target from a swap intent for pre-check comparison. */
function getSwapPriceTarget(order: Order): { base: string; quote: string; maxPrice: number } | null {
  const intent = order.intent as any;
  if (intent.action !== 'swap') return null;

  const tokenIn = intent.tokenIn?.tokenSymbol;
  const tokenOut = intent.tokenOut?.tokenSymbol;
  if (!tokenIn || !tokenOut) return null;

  const amountIn = parseFloat(intent.amountIn);
  const amountOutGte = intent.amountOut?.gte ? parseFloat(intent.amountOut.gte) : null;
  if (!amountIn || !amountOutGte || amountOutGte <= 0) return null;

  // maxPrice = amountIn / amountOutGte (e.g., 500 USDC / 5.882 SOL = ~85 USDC/SOL)
  return { base: tokenOut, quote: tokenIn, maxPrice: amountIn / amountOutGte };
}

export async function evaluateOrders(opts: EvaluateOptions = {}): Promise<EvaluationResult[]> {
  const store = loadOrders();
  const results: EvaluationResult[] = [];
  const now = nowMs(opts);
  let modified = false;

  for (const order of store.orders) {
    if (order.status !== 'pending') continue;

    // Check expiry
    if (isExpired(order, now)) {
      order.status = 'expired';
      order.updatedAt = new Date(now).toISOString();
      const event = makeEvent('expired', now, { detail: `Expired at ${order.policy.expiresAt}` });
      order.history.push(event);
      results.push({ orderId: order.id, status: 'expired', event });
      modified = true;
      continue;
    }

    // Check cooldown
    if (isInCooldown(order, now)) continue;

    // Check maxAttempts
    if (order.policy.maxAttempts !== undefined && attemptCount(order) >= order.policy.maxAttempts) {
      order.status = 'failed';
      order.updatedAt = new Date(now).toISOString();
      const event = makeEvent('failed', now, { reason: 'MAX_ATTEMPTS', detail: `Reached ${order.policy.maxAttempts} attempts` });
      order.history.push(event);
      results.push({ orderId: order.id, status: 'failed', event });
      modified = true;
      continue;
    }

    // Optional price pre-check
    if (opts.priceFeed) {
      const target = getSwapPriceTarget(order);
      if (target) {
        const currentPrice = await opts.priceFeed.getPrice(target.base, target.quote);
        if (currentPrice !== null && currentPrice > target.maxPrice * 1.05) {
          // Price is more than 5% away — skip server call
          const event = makeEvent('attempted', now, { reason: 'PRICE_PRE_CHECK_SKIP', detail: `Current ${target.quote}/${target.base}: ${currentPrice}, need <= ${target.maxPrice.toFixed(2)}` });
          order.history.push(event);
          order.updatedAt = new Date(now).toISOString();
          results.push({ orderId: order.id, status: 'pending', event });
          modified = true;
          continue;
        }
      }
    }

    // Dry run stops here
    if (opts.dryRun) {
      const event = makeEvent('attempted', now, { reason: 'DRY_RUN', detail: 'Would evaluate against server' });
      results.push({ orderId: order.id, status: 'pending', event });
      continue;
    }

    // Call server
    if (!opts.serverEvaluate) continue; // No server function provided — skip
    try {
      const response = await opts.serverEvaluate(order);

      if (!response.executable || !response.transaction) {
        const event = makeEvent('attempted', now, { reason: response.reason, detail: response.detail });
        order.history.push(event);
        order.updatedAt = new Date(now).toISOString();
        results.push({ orderId: order.id, status: 'pending', event });
        modified = true;
        continue;
      }

      // Transaction returned — set executing
      order.status = 'executing';
      order.updatedAt = new Date(now).toISOString();
      modified = true;

      // Verify
      if (opts.verifyTransaction) {
        const verification = await opts.verifyTransaction(response.transaction, order);
        if (!verification.matched) {
          order.status = 'pending';
          const event = makeEvent('attempted', now, { reason: 'VERIFICATION_FAILED', detail: verification.discrepancies.join('; ') });
          order.history.push(event);
          order.updatedAt = new Date(now).toISOString();
          results.push({ orderId: order.id, status: 'pending', event });
          continue;
        }
      }

      // Sign and submit
      if (opts.signAndSubmit) {
        const txid = await opts.signAndSubmit(response.transaction, order);
        order.status = 'filled';
        order.updatedAt = new Date(now).toISOString();
        const event = makeEvent('filled', now, { txid, detail: response.quote ? `Price: ${response.quote.price}` : undefined });
        order.history.push(event);
        results.push({ orderId: order.id, status: 'filled', event });

        // Handle recurrence
        if (order.policy.recurrence) {
          const remaining = order.policy.recurrence.remaining;
          if (remaining === undefined || remaining > 1) {
            const clone: Order = {
              ...JSON.parse(JSON.stringify(order)),
              id: `${order.id}-r${now}`,
              status: 'pending' as const,
              history: [makeEvent('created', now, { detail: `Recurring from ${order.id}` })],
              createdAt: new Date(now).toISOString(),
              updatedAt: new Date(now).toISOString(),
            };
            if (remaining !== undefined) {
              clone.policy.recurrence = { ...order.policy.recurrence, remaining: remaining - 1 };
            }
            store.orders.push(clone);
          }
        }
      }
    } catch (err) {
      order.status = 'pending';
      const message = err instanceof Error ? err.message : String(err);
      const event = makeEvent('attempted', now, { reason: 'SERVER_ERROR', detail: message });
      order.history.push(event);
      order.updatedAt = new Date(now).toISOString();
      results.push({ orderId: order.id, status: 'pending', event });
      modified = true;
    }
  }

  if (modified) {
    saveOrders(store);
  }

  return results;
}
