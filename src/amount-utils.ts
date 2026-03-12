export interface DecimalValue {
  int: bigint;
  scale: number;
}

const DECIMAL_RE = /^-?\d+(?:\.\d+)?$/;

export function parseDecimal(value: string | number): DecimalValue | null {
  const input = String(value).trim();
  if (!DECIMAL_RE.test(input)) {
    return null;
  }

  const negative = input.startsWith('-');
  const unsigned = negative ? input.slice(1) : input;
  const [wholeRaw, fractionRaw = ''] = unsigned.split('.');

  const whole = stripLeadingZeros(wholeRaw);
  const fraction = stripTrailingZeros(fractionRaw);

  const digits = `${whole}${fraction}`;
  const int = BigInt(digits === '' ? '0' : digits) * (negative ? -1n : 1n);
  return { int, scale: fraction.length };
}

export function compareDecimals(a: DecimalValue, b: DecimalValue): number {
  const scale = Math.max(a.scale, b.scale);
  const aInt = scaleDecimal(a, scale);
  const bInt = scaleDecimal(b, scale);
  if (aInt === bInt) return 0;
  return aInt > bInt ? 1 : -1;
}

export function formatUnits(amount: bigint, decimals: number): string {
  if (decimals <= 0) {
    return amount.toString();
  }

  const negative = amount < 0n;
  const absAmount = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = absAmount / base;
  const fraction = absAmount % base;

  if (fraction === 0n) {
    return `${negative ? '-' : ''}${whole.toString()}`;
  }

  const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}.${fractionStr}`;
}

export function withinRelativeTolerance(
  expected: DecimalValue,
  actual: DecimalValue,
  tolerance: DecimalValue,
): boolean {
  if (tolerance.int < 0n) return false;

  const valueScale = Math.max(expected.scale, actual.scale);
  const expectedInt = scaleDecimal(expected, valueScale);
  const actualInt = scaleDecimal(actual, valueScale);

  if (expectedInt === 0n) {
    return actualInt === 0n;
  }

  const diff = abs(actualInt - expectedInt);
  const tolDen = 10n ** BigInt(tolerance.scale);
  const lhs = diff * tolDen;
  const rhs = abs(expectedInt) * tolerance.int;

  return lhs <= rhs;
}

export function extractAmountFromHuman(amountHuman: string | undefined): string | null {
  if (!amountHuman) return null;
  const [amount] = amountHuman.trim().split(/\s+/);
  if (!amount || !DECIMAL_RE.test(amount)) {
    return null;
  }
  return amount;
}

function scaleDecimal(value: DecimalValue, targetScale: number): bigint {
  if (targetScale < value.scale) {
    throw new Error('targetScale must be >= current scale');
  }
  const multiplier = 10n ** BigInt(targetScale - value.scale);
  return value.int * multiplier;
}

function stripLeadingZeros(value: string): string {
  const stripped = value.replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}

function stripTrailingZeros(value: string): string {
  return value.replace(/0+$/, '');
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
