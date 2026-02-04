/**
 * Plaid Link token creation and public token exchange.
 * Handles the OAuth flow for connecting bank accounts.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { Products, CountryCode } from 'plaid';
import { getPlaidClient, getPlaidConfig } from './client.js';
import type {
  CreateLinkTokenOptions,
  CreateLinkTokenResult,
  ExchangePublicTokenResult,
  PlaidError,
} from './types.js';

/**
 * Create a Link token for initializing Plaid Link.
 * This token is used by the frontend to open the Plaid Link modal.
 */
export async function createLinkToken(
  options: CreateLinkTokenOptions
): Promise<CreateLinkTokenResult> {
  const client = getPlaidClient();
  const config = getPlaidConfig();

  const products = options.products ?? [Products.Transactions];
  const countryCodes = options.countryCodes ?? [CountryCode.Us];

  const request = {
    user: {
      client_user_id: options.userId,
    },
    client_name: 'BOA Statement Parser',
    products,
    country_codes: countryCodes,
    language: options.language ?? 'en',
    ...(options.webhookUrl !== undefined || config.webhookUrl !== undefined
      ? { webhook: options.webhookUrl ?? config.webhookUrl }
      : {}),
    ...(options.redirectUri !== undefined || config.redirectUri !== undefined
      ? { redirect_uri: options.redirectUri ?? config.redirectUri }
      : {}),
    ...(options.accessToken !== undefined
      ? { access_token: options.accessToken }
      : {}),
  };

  const response = await client.linkTokenCreate(request);

  return {
    linkToken: response.data.link_token,
    expiration: response.data.expiration,
    requestId: response.data.request_id,
  };
}

/**
 * Create a Link token for update mode (re-authentication).
 * Used when an Item requires re-authentication.
 */
export async function createUpdateLinkToken(
  userId: string,
  accessToken: string
): Promise<CreateLinkTokenResult> {
  return createLinkToken({
    userId,
    accessToken,
  });
}

/**
 * Exchange a public token for an access token.
 * Called after the user completes the Plaid Link flow.
 */
export async function exchangePublicToken(
  publicToken: string
): Promise<ExchangePublicTokenResult> {
  const client = getPlaidClient();

  const response = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });

  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
    requestId: response.data.request_id,
  };
}

/**
 * Get information about a Plaid Item.
 */
export async function getItem(accessToken: string): Promise<{
  itemId: string;
  institutionId: string | null;
  availableProducts: Products[];
  billedProducts: Products[];
  consentExpirationTime: string | null;
  updateType: string;
  error: PlaidError | null;
}> {
  const client = getPlaidClient();

  const response = await client.itemGet({
    access_token: accessToken,
  });

  const item = response.data.item;

  return {
    itemId: item.item_id,
    institutionId: item.institution_id ?? null,
    availableProducts: item.available_products as Products[],
    billedProducts: item.billed_products as Products[],
    consentExpirationTime: item.consent_expiration_time ?? null,
    updateType: item.update_type,
    error: response.data.item.error as PlaidError | null,
  };
}

/**
 * Remove a Plaid Item (disconnect the bank account).
 */
export async function removeItem(accessToken: string): Promise<{
  removed: boolean;
  requestId: string;
}> {
  const client = getPlaidClient();

  const response = await client.itemRemove({
    access_token: accessToken,
  });

  return {
    removed: true,
    requestId: response.data.request_id,
  };
}

/**
 * Get institution information by ID.
 */
export async function getInstitution(institutionId: string): Promise<{
  institutionId: string;
  name: string;
  url: string | null;
  logo: string | null;
  primaryColor: string | null;
  countryCodes: string[];
  products: Products[];
}> {
  const client = getPlaidClient();

  const response = await client.institutionsGetById({
    institution_id: institutionId,
    country_codes: [CountryCode.Us],
    options: {
      include_optional_metadata: true,
    },
  });

  const institution = response.data.institution;

  return {
    institutionId: institution.institution_id,
    name: institution.name,
    url: institution.url ?? null,
    logo: institution.logo ?? null,
    primaryColor: institution.primary_color ?? null,
    countryCodes: institution.country_codes as string[],
    products: institution.products as Products[],
  };
}

/**
 * Create a sandbox public token for testing.
 * Only works in sandbox environment.
 */
export async function createSandboxPublicToken(
  institutionId: string = 'ins_109508',
  products: Products[] = [Products.Transactions]
): Promise<{ publicToken: string; requestId: string }> {
  const client = getPlaidClient();

  const response = await client.sandboxPublicTokenCreate({
    institution_id: institutionId,
    initial_products: products,
  });

  return {
    publicToken: response.data.public_token,
    requestId: response.data.request_id,
  };
}
