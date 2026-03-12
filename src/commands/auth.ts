import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519';
import { loadConfig, saveConfig, getWallet, getApiUrl, getApiKey, clearApiKey } from '../config.js';
import { createHttpClient } from '../client.js';
import { outputSuccess } from '../output.js';
import { SdkError } from '../errors.js';

export async function authRegister(opts: { wallet?: string }) {
  const config = loadConfig();
  const wallet = getWallet(config, opts.wallet);
  const keypair = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));

  // Use unauthenticated client for challenge/register
  const client = createHttpClient({ baseUrl: getApiUrl(config) });

  // 1. Get challenge nonce
  const challengeRes = await client.get(`/api/auth/challenge?pubkey=${wallet.address}`);
  const { nonce } = challengeRes.data.data;

  // 2. Sign nonce (noble/curves expects 32-byte seed, not Solana's 64-byte combined format)
  const signature = ed25519.sign(Buffer.from(nonce, 'utf-8'), keypair.secretKey.slice(0, 32));
  const signatureBase64 = Buffer.from(signature).toString('base64');

  // 3. Register and receive API key
  const registerRes = await client.post('/api/auth/register', {
    pubkey: wallet.address,
    signature: signatureBase64,
  });

  const { apiKey } = registerRes.data.data;
  config.apiKey = apiKey;
  saveConfig(config);

  outputSuccess({ action: 'auth_register', message: 'API key registered and saved.' });
}

export async function authStatus() {
  const config = loadConfig();
  const apiKey = getApiKey(config);

  if (!apiKey) {
    outputSuccess({
      action: 'auth_status',
      configured: false,
      hint: 'Run `silky auth register` to get an API key.',
    });
    return;
  }

  const source = config.apiKey ? 'config' : 'SILKY_API_KEY env var';
  const fingerprint = apiKey.slice(0, 9);

  outputSuccess({
    action: 'auth_status',
    configured: true,
    source,
    fingerprint: `${fingerprint}...`,
  });
}

export async function authRevoke() {
  const config = loadConfig();
  const apiKey = getApiKey(config);

  if (!apiKey) {
    throw new SdkError('NO_API_KEY', 'No API key configured. Run `silky auth register` first.');
  }

  const client = createHttpClient({ baseUrl: getApiUrl(config), apiKey });

  try {
    await client.post('/api/auth/revoke', {});
  } catch (err: any) {
    if (err.code === 'UNAUTHORIZED') {
      throw new SdkError('UNAUTHORIZED', 'API key is already invalid or expired.');
    }
    throw err;
  }

  clearApiKey(config);
  saveConfig(config);

  outputSuccess({ action: 'auth_revoke', message: 'API key revoked and removed from config.' });
}
