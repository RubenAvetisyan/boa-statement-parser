/**
 * Plaid integration types for boa-statement-parser.
 * These types define the structures for Plaid API interactions and storage.
 */

import type { Products, CountryCode } from 'plaid';

export type PlaidEnvironment = 'sandbox' | 'production';

export interface PlaidConfig {
  clientId: string;
  secret: string;
  env: PlaidEnvironment;
  webhookUrl?: string;
  redirectUri?: string;
}

export type PlaidItemStatus = 'active' | 'login_required' | 'error';

export interface PlaidItem {
  itemId: string;
  accessToken: string;
  institutionId: string;
  institutionName: string;
  userId: string;
  syncCursor?: string;
  lastSyncAt?: string;
  status: PlaidItemStatus;
  availableProducts?: Products[];
  billedProducts?: Products[];
  consentExpirationTime?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlaidAccount {
  accountId: string;
  itemId: string;
  name: string;
  officialName?: string;
  type: string;
  subtype?: string;
  mask?: string;
  balances: {
    available?: number;
    current?: number;
    limit?: number;
    isoCurrencyCode?: string;
    unofficialCurrencyCode?: string;
  };
}

export interface PlaidTransaction {
  transactionId: string;
  accountId: string;
  amount: number;
  isoCurrencyCode?: string;
  unofficialCurrencyCode?: string;
  date: string;
  datetime?: string;
  authorizedDate?: string;
  authorizedDatetime?: string;
  name: string;
  merchantName?: string;
  merchantEntityId?: string;
  paymentChannel: string;
  pending: boolean;
  pendingTransactionId?: string;
  accountOwner?: string;
  category?: string[];
  categoryId?: string;
  personalFinanceCategory?: {
    primary: string;
    detailed: string;
    confidenceLevel?: string;
  };
  location?: {
    address?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
    lat?: number;
    lon?: number;
    storeNumber?: string;
  };
  paymentMeta?: {
    referenceNumber?: string;
    ppdId?: string;
    payee?: string;
    byOrderOf?: string;
    payer?: string;
    paymentMethod?: string;
    paymentProcessor?: string;
    reason?: string;
  };
  transactionCode?: string;
  checkNumber?: string;
}

export interface PlaidSyncResult {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transactionId: string }[];
  nextCursor: string;
  hasMore: boolean;
}

export interface CreateLinkTokenOptions {
  userId: string;
  products?: Products[];
  countryCodes?: CountryCode[];
  language?: string;
  webhookUrl?: string;
  redirectUri?: string;
  accessToken?: string;
}

export interface CreateLinkTokenResult {
  linkToken: string;
  expiration: string;
  requestId: string;
}

export interface ExchangePublicTokenResult {
  accessToken: string;
  itemId: string;
  requestId: string;
}

export interface PlaidError {
  errorType: string;
  errorCode: string;
  errorMessage: string;
  displayMessage?: string;
  requestId?: string;
  causes?: unknown[];
  status?: number;
  documentationUrl?: string;
  suggestedAction?: string;
}

export function isPlaidError(error: unknown): error is PlaidError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'errorType' in error &&
    'errorCode' in error &&
    'errorMessage' in error
  );
}
