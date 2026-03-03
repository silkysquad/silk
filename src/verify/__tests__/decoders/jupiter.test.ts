import { describe, it, expect } from 'vitest';
import { decodeJupiter } from '../../decoders/jupiter.js';

// Known Jupiter discriminator hex strings from source
const DISC_ROUTE = 'e517cb977ae3ad2a';
const DISC_SHARED = '9279c41c15427612';

describe('decodeJupiter', () => {
  it('identifies a route instruction', () => {
    const data = Buffer.from(DISC_ROUTE + '00'.repeat(32), 'hex');
    const accounts = ['TokenProg', 'Authority', 'SourceATA', 'DestATA'];

    const result = decodeJupiter(data, accounts);

    expect(result.type).toBe('route');
    expect(result.params['sourceTokenAccount']).toBe('SourceATA');
    expect(result.params['destinationTokenAccount']).toBe('DestATA');
  });

  it('identifies a shared_accounts_route instruction', () => {
    const data = Buffer.from(DISC_SHARED + '00'.repeat(32), 'hex');
    const accounts = ['TokenProg', 'Authority', 'Source', 'Dest'];

    const result = decodeJupiter(data, accounts);
    expect(result.type).toBe('shared_accounts_route');
  });

  it('returns unknown for unrecognized discriminator', () => {
    const data = Buffer.from('0000000000000000', 'hex');
    const result = decodeJupiter(data, []);
    expect(result.type).toBe('unknown_jupiter_instruction');
  });

  it('returns unknown for data shorter than 8 bytes', () => {
    const result = decodeJupiter(Buffer.alloc(4), []);
    expect(result.type).toBe('unknown_jupiter_instruction');
  });
});
