import axios, { AxiosInstance, AxiosError } from 'axios';
import { SdkError, ANCHOR_ERROR_MAP } from './errors.js';

const DEFAULT_TIMEOUT = 30000;

export interface ClientConfig {
  baseUrl?: string;
  timeout?: number;
  apiKey?: string;
}

export function createHttpClient(config: ClientConfig = {}): AxiosInstance {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const client = axios.create({
    baseURL: config.baseUrl || 'http://localhost:3000',
    timeout: config.timeout || DEFAULT_TIMEOUT,
    headers,
  });

  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError<{ ok: boolean; error?: string; message?: string }>) => {
      if (error.response?.status === 401) {
        throw new SdkError(
          'UNAUTHORIZED',
          'API key required or invalid. Run `silky auth register` to get an API key.',
        );
      }
      if (error.response?.data?.error) {
        const apiCode = error.response.data.error;
        const apiMessage = error.response.data.message || 'Unknown API error';

        if (apiCode === 'TX_FAILED') {
          const hexMatch = apiMessage.match(/0x([0-9a-fA-F]+)/);
          if (hexMatch) {
            const errorCode = parseInt(hexMatch[1], 16);
            const anchor = ANCHOR_ERROR_MAP[errorCode];
            if (anchor) {
              throw new SdkError(anchor.code, anchor.message);
            }
          }
        }

        throw new SdkError(apiCode, apiMessage);
      }
      if (error.response?.data?.message) {
        throw new SdkError('API_ERROR', error.response.data.message);
      }
      if (error.code === 'ECONNABORTED') {
        throw new SdkError('TIMEOUT', 'Request timeout — is the SilkyWay server running?');
      }
      throw new SdkError('NETWORK_ERROR', 'Network error — is the SilkyWay server running?');
    },
  );

  return client;
}
