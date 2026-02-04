/**
 * Plaid transactions sync and retrieval.
 * Implements incremental sync using /transactions/sync endpoint.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { getPlaidClient } from './client.js';
import { getPlaidItemStore, type PlaidItemStore } from './store.js';
import type { PlaidTransaction, PlaidSyncResult, PlaidAccount } from './types.js';

/**
 * Sync transactions for a Plaid Item using incremental sync.
 * Uses cursor-based pagination to fetch only new/modified transactions.
 */
export async function syncTransactions(
  accessToken: string,
  cursor?: string
): Promise<PlaidSyncResult> {
  const client = getPlaidClient();

  const request: { access_token: string; cursor?: string; count?: number } = {
    access_token: accessToken,
  };

  if (cursor !== undefined) {
    request.cursor = cursor;
  }

  const response = await client.transactionsSync(request);

  const added: PlaidTransaction[] = response.data.added.map((tx: any) => mapPlaidTransaction(tx as Record<string, unknown>));
  const modified: PlaidTransaction[] = response.data.modified.map((tx: any) => mapPlaidTransaction(tx as Record<string, unknown>));
  const removed = response.data.removed.map((r: any) => ({
    transactionId: r.transaction_id ?? '',
  }));

  return {
    added,
    modified,
    removed,
    nextCursor: response.data.next_cursor,
    hasMore: response.data.has_more,
  };
}

/**
 * Sync all transactions for a Plaid Item, handling pagination.
 * Continues fetching until hasMore is false.
 */
export async function syncAllTransactions(
  accessToken: string,
  initialCursor?: string,
  onProgress?: (result: PlaidSyncResult) => void
): Promise<{
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transactionId: string }[];
  finalCursor: string;
}> {
  const allAdded: PlaidTransaction[] = [];
  const allModified: PlaidTransaction[] = [];
  const allRemoved: { transactionId: string }[] = [];

  let cursor = initialCursor;
  let hasMore = true;

  while (hasMore) {
    const result = await syncTransactions(accessToken, cursor);

    allAdded.push(...result.added);
    allModified.push(...result.modified);
    allRemoved.push(...result.removed);

    cursor = result.nextCursor;
    hasMore = result.hasMore;

    if (onProgress !== undefined) {
      onProgress(result);
    }
  }

  return {
    added: allAdded,
    modified: allModified,
    removed: allRemoved,
    finalCursor: cursor ?? '',
  };
}

/**
 * Sync transactions for a stored Plaid Item by item ID.
 * Automatically updates the sync cursor in the store.
 * @param itemId - The Plaid item ID
 * @param onProgress - Optional callback for progress updates
 * @param customStore - Optional custom store (defaults to in-memory store)
 */
export async function syncItemTransactions(
  itemId: string,
  onProgress?: (result: PlaidSyncResult) => void,
  customStore?: PlaidItemStore
): Promise<{
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transactionId: string }[];
  finalCursor: string;
}> {
  const store = customStore ?? getPlaidItemStore();
  const item = await store.getItem(itemId);

  if (item === null) {
    throw new Error(`Plaid item not found: ${itemId}`);
  }

  const result = await syncAllTransactions(item.accessToken, item.syncCursor, onProgress);

  await store.updateSyncCursor(itemId, result.finalCursor);

  return result;
}

/**
 * Get accounts for a Plaid Item.
 */
export async function getAccounts(accessToken: string): Promise<PlaidAccount[]> {
  const client = getPlaidClient();

  const response = await client.accountsGet({
    access_token: accessToken,
  });

  return response.data.accounts.map((account: any) => ({
    accountId: account.account_id,
    itemId: response.data.item.item_id,
    name: account.name,
    officialName: account.official_name ?? undefined,
    type: account.type,
    subtype: account.subtype ?? undefined,
    mask: account.mask ?? undefined,
    balances: {
      available: account.balances.available ?? undefined,
      current: account.balances.current ?? undefined,
      limit: account.balances.limit ?? undefined,
      isoCurrencyCode: account.balances.iso_currency_code ?? undefined,
      unofficialCurrencyCode: account.balances.unofficial_currency_code ?? undefined,
    },
  }));
}

/**
 * Get account balances for a Plaid Item.
 */
export async function getAccountBalances(accessToken: string): Promise<PlaidAccount[]> {
  const client = getPlaidClient();

  const response = await client.accountsBalanceGet({
    access_token: accessToken,
  });

  return response.data.accounts.map((account: any) => ({
    accountId: account.account_id,
    itemId: response.data.item.item_id,
    name: account.name,
    officialName: account.official_name ?? undefined,
    type: account.type,
    subtype: account.subtype ?? undefined,
    mask: account.mask ?? undefined,
    balances: {
      available: account.balances.available ?? undefined,
      current: account.balances.current ?? undefined,
      limit: account.balances.limit ?? undefined,
      isoCurrencyCode: account.balances.iso_currency_code ?? undefined,
      unofficialCurrencyCode: account.balances.unofficial_currency_code ?? undefined,
    },
  }));
}

/**
 * Map Plaid SDK transaction to our PlaidTransaction type.
 */
function mapPlaidTransaction(tx: Record<string, unknown>): PlaidTransaction {
  const location = tx['location'] as Record<string, unknown> | undefined;
  const paymentMeta = tx['payment_meta'] as Record<string, unknown> | undefined;
  const personalFinanceCategory = tx['personal_finance_category'] as Record<string, unknown> | undefined;

  const result: PlaidTransaction = {
    transactionId: tx['transaction_id'] as string,
    accountId: tx['account_id'] as string,
    amount: tx['amount'] as number,
    date: tx['date'] as string,
    name: tx['name'] as string,
    paymentChannel: tx['payment_channel'] as string,
    pending: tx['pending'] as boolean,
  };

  // Optional string fields
  const optionalStrings: Array<[keyof PlaidTransaction, string]> = [
    ['isoCurrencyCode', 'iso_currency_code'],
    ['unofficialCurrencyCode', 'unofficial_currency_code'],
    ['datetime', 'datetime'],
    ['authorizedDate', 'authorized_date'],
    ['authorizedDatetime', 'authorized_datetime'],
    ['merchantName', 'merchant_name'],
    ['merchantEntityId', 'merchant_entity_id'],
    ['pendingTransactionId', 'pending_transaction_id'],
    ['accountOwner', 'account_owner'],
    ['categoryId', 'category_id'],
    ['transactionCode', 'transaction_code'],
    ['checkNumber', 'check_number'],
  ];

  for (const [key, txKey] of optionalStrings) {
    const val = tx[txKey];
    if (typeof val === 'string') {
      (result as any)[key] = val;
    }
  }

  const category = tx['category'];
  if (Array.isArray(category)) {
    result.category = category as string[];
  }

  if (personalFinanceCategory !== undefined) {
    const pfc: PlaidTransaction['personalFinanceCategory'] = {
      primary: personalFinanceCategory['primary'] as string,
      detailed: personalFinanceCategory['detailed'] as string,
    };
    const cl = personalFinanceCategory['confidence_level'];
    if (typeof cl === 'string') pfc.confidenceLevel = cl;
    result.personalFinanceCategory = pfc;
  }

  if (location !== undefined) {
    const loc: NonNullable<PlaidTransaction['location']> = {};
    const locFields: Array<[keyof NonNullable<PlaidTransaction['location']>, string]> = [
      ['address', 'address'],
      ['city', 'city'],
      ['region', 'region'],
      ['postalCode', 'postal_code'],
      ['country', 'country'],
      ['storeNumber', 'store_number'],
    ];
    for (const [key, txKey] of locFields) {
      const val = location[txKey];
      if (typeof val === 'string') (loc as any)[key] = val;
    }
    const lat = location['lat'];
    const lon = location['lon'];
    if (typeof lat === 'number') loc.lat = lat;
    if (typeof lon === 'number') loc.lon = lon;
    result.location = loc;
  }

  if (paymentMeta !== undefined) {
    const pm: NonNullable<PlaidTransaction['paymentMeta']> = {};
    const pmFields: Array<[keyof NonNullable<PlaidTransaction['paymentMeta']>, string]> = [
      ['referenceNumber', 'reference_number'],
      ['ppdId', 'ppd_id'],
      ['payee', 'payee'],
      ['byOrderOf', 'by_order_of'],
      ['payer', 'payer'],
      ['paymentMethod', 'payment_method'],
      ['paymentProcessor', 'payment_processor'],
      ['reason', 'reason'],
    ];
    for (const [key, txKey] of pmFields) {
      const val = paymentMeta[txKey];
      if (typeof val === 'string') (pm as any)[key] = val;
    }
    result.paymentMeta = pm;
  }

  return result;
}
