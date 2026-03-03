export interface MemoDecoded {
  type: string;
  params: Record<string, unknown>;
}

export function decodeMemo(data: Buffer): MemoDecoded {
  return {
    type: 'memo',
    params: {
      text: data.toString('utf-8'),
    },
  };
}
