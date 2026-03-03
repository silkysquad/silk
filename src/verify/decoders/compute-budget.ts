export interface ComputeBudgetDecoded {
  type: string;
  params: Record<string, unknown>;
}

// Compute Budget program: u8 at byte 0
const IX = {
  RequestHeapFrame: 1,
  SetComputeUnitLimit: 2,
  SetComputeUnitPrice: 3,
  SetLoadedAccountsDataSizeLimit: 4,
} as const;

export function decodeComputeBudget(data: Buffer): ComputeBudgetDecoded {
  if (data.length < 1) return { type: 'unknown', params: {} };
  const index = data[0];

  switch (index) {
    case IX.SetComputeUnitLimit: {
      const units = data.length >= 5 ? data.readUInt32LE(1) : null;
      return { type: 'set_compute_unit_limit', params: { units } };
    }
    case IX.SetComputeUnitPrice: {
      const microLamports = data.length >= 9 ? data.readBigUInt64LE(1).toString() : null;
      return { type: 'set_compute_unit_price', params: { microLamports } };
    }
    case IX.RequestHeapFrame: {
      const bytes = data.length >= 5 ? data.readUInt32LE(1) : null;
      return { type: 'request_heap_frame', params: { bytes } };
    }
    default:
      return { type: `unknown_compute_budget_ix_${index}`, params: {} };
  }
}
