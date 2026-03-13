import { randomUUID } from 'node:crypto';
import { loadConfig, getWallet, getApiUrl, getApiKey } from '../config.js';
import { addOrder, getOrder, updateOrder, loadOrders } from '../orders/store.js';
import { parseSwapSugar } from '../orders/sugar.js';
import { evaluateOrders } from '../orders/evaluate.js';
import { createHttpClient } from '../client.js';
import { verifyIntent as verifyIntentV2 } from '../intent/index.js';
import { outputSuccess } from '../output.js';
import { SdkError } from '../errors.js';
import { Keypair, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import type { Order } from '../orders/types.js';
import type { ServerEvaluateResponse } from '../orders/evaluate.js';
import type { Intent } from '../intent/types.js';

const DEFAULT_SLIPPAGE = 0.1;
const MAX_SLIPPAGE = 10;

export async function ordersCreate(intentOrAction: string, opts: {
  sell?: string;
  buy?: string;
  price?: string;
  slippage?: string;
  expires?: string;
  cooldown?: string;
  maxAttempts?: string;
  wallet?: string;
}) {
  const config = loadConfig();
  const wallet = getWallet(config, opts.wallet);
  const slippage = opts.slippage ? parseFloat(opts.slippage) : DEFAULT_SLIPPAGE;

  if (slippage < 0 || slippage > MAX_SLIPPAGE) {
    throw new SdkError('INVALID_SLIPPAGE', `Slippage must be between 0 and ${MAX_SLIPPAGE}%. Got: ${slippage}`);
  }

  let intent: Intent;

  // Try JSON parse first (agent path)
  try {
    intent = JSON.parse(intentOrAction) as Intent;
  } catch {
    // Sugar path: intentOrAction is the action name (e.g., "swap")
    if (intentOrAction !== 'swap') {
      throw new SdkError('UNSUPPORTED_ACTION', `Sugar syntax only supports "swap". Got: "${intentOrAction}". Use JSON for other actions.`);
    }

    if (!opts.sell || !opts.buy || !opts.price) {
      throw new SdkError('MISSING_FIELD', 'swap sugar requires --sell "<amount> <symbol>", --buy "<symbol>", and --price "<number>"');
    }

    const sellParts = opts.sell.split(/\s+/);
    if (sellParts.length !== 2) {
      throw new SdkError('INVALID_SELL', '--sell must be "<amount> <symbol>" (e.g., --sell "500 USDC")');
    }

    const chain = `solana${config.cluster === 'devnet' ? ':devnet' : ''}`;

    intent = parseSwapSugar({
      sellAmount: sellParts[0],
      sellSymbol: sellParts[1],
      buySymbol: opts.buy,
      price: opts.price,
      slippage,
      from: wallet.address,
      chain,
    });
  }

  const now = new Date().toISOString();
  const order: Order = {
    id: randomUUID(),
    intent,
    policy: {
      cooldown: opts.cooldown ? parseInt(opts.cooldown, 10) : 60,
      maxAttempts: opts.maxAttempts ? parseInt(opts.maxAttempts, 10) : undefined,
      expiresAt: opts.expires ? parseExpiry(opts.expires) : undefined,
    },
    status: 'pending',
    slippage,
    wallet: opts.wallet,
    createdAt: now,
    updatedAt: now,
    history: [{ timestamp: now, type: 'created' }],
  };

  addOrder(order);
  outputSuccess({ action: 'order_created', orderId: order.id, status: order.status });
}

export async function ordersList(opts: { status?: string }) {
  const store = loadOrders();
  let orders = store.orders;

  if (opts.status) {
    orders = orders.filter((o) => o.status === opts.status);
  }

  const summary = orders.map((o) => ({
    id: o.id,
    action: (o.intent as any).action || 'unknown',
    status: o.status,
    slippage: o.slippage,
    createdAt: o.createdAt,
    lastEvent: o.history.length > 0 ? o.history[o.history.length - 1].type : null,
  }));

  outputSuccess({ orders: summary });
}

export async function ordersGet(orderId: string) {
  const order = getOrder(orderId);
  if (!order) {
    throw new SdkError('ORDER_NOT_FOUND', `Order "${orderId}" not found`);
  }
  outputSuccess({ order });
}

export async function ordersCancel(orderId: string) {
  const order = getOrder(orderId);
  if (!order) {
    throw new SdkError('ORDER_NOT_FOUND', `Order "${orderId}" not found`);
  }
  if (order.status !== 'pending') {
    throw new SdkError('ORDER_NOT_PENDING', `Order "${orderId}" is ${order.status}, not pending`);
  }
  updateOrder(orderId, {
    status: 'cancelled',
    history: [...order.history, { timestamp: new Date().toISOString(), type: 'cancelled' }],
  });
  outputSuccess({ action: 'order_cancelled', orderId });
}

export async function ordersEvaluate(opts: { dryRun?: boolean; wallet?: string }) {
  const config = loadConfig();
  const wallet = getWallet(config, opts.wallet);
  const apiUrl = getApiUrl(config);
  const apiKey = getApiKey(config);

  const client = createHttpClient({ baseUrl: apiUrl, apiKey });

  const results = await evaluateOrders({
    dryRun: opts.dryRun,
    serverEvaluate: async (order: Order): Promise<ServerEvaluateResponse> => {
      const res = await client.post('/api/orders/evaluate', {
        intent: order.intent,
        slippage: order.slippage,
        wallet: wallet.address,
      });
      const data = res.data.data;
      if (data.transaction) {
        return { executable: true, transaction: data.transaction, quote: data.quote };
      }
      return { executable: false, reason: data.reason, detail: data.detail };
    },
    verifyTransaction: async (txBase64: string, order: Order) => {
      const result = await verifyIntentV2(txBase64, order.intent);
      return { matched: result.matched, discrepancies: result.discrepancies };
    },
    signAndSubmit: async (txBase64: string, _order: Order) => {
      const tx = Transaction.from(Buffer.from(txBase64, 'base64'));
      const keypair = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
      tx.sign(keypair);
      const submitRes = await client.post('/api/tx/submit', {
        signedTx: tx.serialize().toString('base64'),
      });
      return submitRes.data.data.txid;
    },
  });

  outputSuccess({ action: 'orders_evaluated', results });
}

function parseExpiry(value: string): string {
  // Support relative durations: 1h, 7d, 30m
  const match = value.match(/^(\d+)(m|h|d)$/);
  if (match) {
    const num = parseInt(match[1], 10);
    const unit = match[2];
    const ms = unit === 'm' ? num * 60000 : unit === 'h' ? num * 3600000 : num * 86400000;
    return new Date(Date.now() + ms).toISOString();
  }
  // Otherwise treat as ISO date
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new SdkError('INVALID_EXPIRY', `Cannot parse expiry: "${value}". Use relative (7d, 24h, 30m) or ISO date.`);
  }
  return date.toISOString();
}
