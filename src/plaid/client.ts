/**
 * Plaid client initialization and configuration.
 * Supports environment-based configuration following the same pattern as supabase/client.ts.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */

import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import type { PlaidConfig, PlaidEnvironment } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
let plaidInstance: PlaidApi | null = null;
let currentConfig: PlaidConfig | null = null;

/**
 * Get Plaid configuration from environment variables or explicit config.
 * Priority: explicit config > environment variables
 */
export function getPlaidConfig(config?: Partial<PlaidConfig>): PlaidConfig {
  const clientId = config?.clientId ?? process.env['PLAID_CLIENT_ID'];
  const secret = config?.secret ?? process.env['PLAID_SECRET'];
  const envStr = config?.env ?? process.env['PLAID_ENV'] ?? 'sandbox';
  const webhookUrl = config?.webhookUrl ?? process.env['PLAID_WEBHOOK_URL'];
  const redirectUri = config?.redirectUri ?? process.env['PLAID_REDIRECT_URI'];

  if (clientId === undefined || clientId === '') {
    throw new Error(
      'Plaid client ID is required. Set PLAID_CLIENT_ID environment variable or pass clientId in config.'
    );
  }

  if (secret === undefined || secret === '') {
    throw new Error(
      'Plaid secret is required. Set PLAID_SECRET environment variable or pass secret in config.'
    );
  }

  const env = validatePlaidEnvironment(envStr);

  return {
    clientId,
    secret,
    env,
    ...(webhookUrl !== undefined ? { webhookUrl } : {}),
    ...(redirectUri !== undefined ? { redirectUri } : {}),
  };
}

/**
 * Validate and normalize Plaid environment string.
 */
function validatePlaidEnvironment(env: string): PlaidEnvironment {
  const normalized = env.toLowerCase().trim();
  if (normalized === 'sandbox' || normalized === 'production') {
    return normalized;
  }
  throw new Error(
    `Invalid PLAID_ENV: "${env}". Must be "sandbox" or "production".`
  );
}

/**
 * Map our environment type to Plaid SDK environment.
 */
function getPlaidEnvironmentUrl(env: PlaidEnvironment): string {
  switch (env) {
    case 'sandbox':
      return PlaidEnvironments['sandbox'] ?? 'https://sandbox.plaid.com';
    case 'production':
      return PlaidEnvironments['production'] ?? 'https://production.plaid.com';
    default:
      return PlaidEnvironments['sandbox'] ?? 'https://sandbox.plaid.com';
  }
}

/**
 * Create a new Plaid client instance.
 */
export function createPlaidClient(config?: Partial<PlaidConfig>): PlaidApi {
  const plaidConfig = getPlaidConfig(config);

  const configuration = new Configuration({
    basePath: getPlaidEnvironmentUrl(plaidConfig.env),
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': plaidConfig.clientId,
        'PLAID-SECRET': plaidConfig.secret,
      },
    },
  });

  return new PlaidApi(configuration);
}

/**
 * Get or create a singleton Plaid client instance.
 * Useful for CLI operations where we want to reuse the same connection.
 */
export function getPlaidClient(config?: Partial<PlaidConfig>): PlaidApi {
  const newConfig = getPlaidConfig(config);

  if (
    !plaidInstance ||
    !currentConfig ||
    currentConfig.clientId !== newConfig.clientId ||
    currentConfig.secret !== newConfig.secret ||
    currentConfig.env !== newConfig.env
  ) {
    plaidInstance = createPlaidClient(config);
    currentConfig = newConfig;
  }

  return plaidInstance;
}

/**
 * Reset the singleton client instance.
 * Useful for testing or when configuration changes.
 */
export function resetPlaidClient(): void {
  plaidInstance = null;
  currentConfig = null;
}

/**
 * Check if Plaid is configured (environment variables are set).
 */
export function isPlaidConfigured(): boolean {
  const clientId = process.env['PLAID_CLIENT_ID'];
  const secret = process.env['PLAID_SECRET'];
  return clientId !== undefined && clientId !== '' && secret !== undefined && secret !== '';
}

/**
 * Test the Plaid connection by making a simple API call.
 */
export async function testPlaidConnection(client?: PlaidApi): Promise<{
  success: boolean;
  environment: PlaidEnvironment;
  error?: string;
}> {
  const plaid = client ?? getPlaidClient();
  const config = currentConfig ?? getPlaidConfig();

  try {
    // Use categories endpoint as a simple health check
    await plaid.categoriesGet({});
    return { success: true, environment: config.env };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, environment: config.env, error: message };
  }
}

export type { PlaidApi };
