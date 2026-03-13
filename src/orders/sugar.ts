import type { SingleIntent } from '../intent/types.js';
import { SdkError } from '../errors.js';

const DEFAULT_SLIPPAGE = 0.1;
const MAX_SLIPPAGE = 10;

export interface SwapSugarInput {
  sellAmount: string;
  sellSymbol: string;
  buySymbol: string;
  price: string;
  slippage?: number;
  from: string;
  chain: string;
}

export function parseSwapSugar(input: SwapSugarInput): SingleIntent & { action: 'swap' } {
  const slippage = input.slippage ?? DEFAULT_SLIPPAGE;

  if (slippage < 0 || slippage > MAX_SLIPPAGE) {
    throw new SdkError('INVALID_SLIPPAGE', `INVALID_SLIPPAGE: Slippage must be between 0 and ${MAX_SLIPPAGE}%. Got: ${slippage}`);
  }

  const sellAmount = parseFloat(input.sellAmount);
  if (!Number.isFinite(sellAmount) || sellAmount <= 0) {
    throw new SdkError('INVALID_AMOUNT', `INVALID_AMOUNT: Sell amount must be positive. Got: ${input.sellAmount}`);
  }

  const price = parseFloat(input.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new SdkError('INVALID_PRICE', `INVALID_PRICE: Price must be positive. Got: ${input.price}`);
  }

  const rawOut = sellAmount / price;
  const minOut = rawOut * (1 - slippage / 100);

  // Use enough decimal places to avoid precision loss
  const minOutStr = minOut.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');

  return {
    chain: input.chain,
    signer: input.from,
    action: 'swap',
    from: input.from,
    tokenIn: { tokenSymbol: input.sellSymbol },
    tokenOut: { tokenSymbol: input.buySymbol },
    amountIn: input.sellAmount,
    amountOut: { gte: minOutStr },
  };
}
