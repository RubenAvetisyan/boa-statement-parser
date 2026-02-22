/**
 * Query functions for retrieving data from Supabase.
 * Uses the analytics views defined in references/views.sql
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */

import type { SupabaseClient } from '@supabase/supabase-js';

type SupabaseClientAny = SupabaseClient<any, any, any>;

export interface TransactionFilter {
  startDate?: string;
  endDate?: string;
  accountId?: string;
  category?: string;
  subcategory?: string;
  minAmount?: number;
  maxAmount?: number;
  direction?: 'debit' | 'credit';
  limit?: number;
  offset?: number;
}

export interface TransactionRow {
  id: string;
  user_id: string;
  account_id: string;
  statement_db_id: string | null;
  transaction_id: string;
  date: string;
  posted_date: string | null;
  amount: number;
  direction: string;
  description: string;
  description_raw: string | null;
  merchant: Record<string, unknown>;
  bank_reference: Record<string, unknown>;
  channel: Record<string, unknown>;
  category: string | null;
  subcategory: string | null;
  confidence: number | null;
  rule_id: string | null;
  rationale: string | null;
  flags: Record<string, unknown>;
  raw: Record<string, unknown>;
  created_at: string;
}

/**
 * Get transactions with optional filters.
 */
export async function getTransactions(
  client: SupabaseClientAny,
  userId: string,
  filter?: TransactionFilter
): Promise<TransactionRow[]> {
  let query = client
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (filter?.startDate) {
    query = query.gte('date', filter.startDate);
  }
  if (filter?.endDate) {
    query = query.lte('date', filter.endDate);
  }
  if (filter?.accountId) {
    query = query.eq('account_id', filter.accountId);
  }
  if (filter?.category) {
    query = query.eq('category', filter.category);
  }
  if (filter?.subcategory) {
    query = query.eq('subcategory', filter.subcategory);
  }
  if (filter?.minAmount !== undefined) {
    query = query.gte('amount', filter.minAmount);
  }
  if (filter?.maxAmount !== undefined) {
    query = query.lte('amount', filter.maxAmount);
  }
  if (filter?.direction) {
    query = query.eq('direction', filter.direction);
  }
  if (filter?.limit) {
    query = query.limit(filter.limit);
  }
  if (filter?.offset) {
    query = query.range(filter.offset, filter.offset + (filter.limit ?? 100) - 1);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get transactions: ${error.message}`);
  }

  return data ?? [];
}

export interface StatementFilter {
  accountId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface StatementRow {
  id: string;
  user_id: string;
  account_id: string;
  statement_id: string;
  period_start: string;
  period_end: string;
  statement_kind: string;
  starting_balance: number | null;
  ending_balance: number | null;
  total_credits: number | null;
  total_debits: number | null;
  transaction_count: number | null;
  page_start: number | null;
  page_end: number | null;
  provenance: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
}

/**
 * Get statements with optional filters.
 */
export async function getStatements(
  client: SupabaseClientAny,
  userId: string,
  filter?: StatementFilter
): Promise<StatementRow[]> {
  let query = client
    .from('statements')
    .select('*')
    .eq('user_id', userId)
    .order('period_start', { ascending: false });

  if (filter?.accountId) {
    query = query.eq('account_id', filter.accountId);
  }
  if (filter?.startDate) {
    query = query.gte('period_start', filter.startDate);
  }
  if (filter?.endDate) {
    query = query.lte('period_end', filter.endDate);
  }
  if (filter?.limit) {
    query = query.limit(filter.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get statements: ${error.message}`);
  }

  return data ?? [];
}

export interface AccountSummaryRow {
  account_id: string;
  user_id: string;
  institution: string;
  account_type: string;
  account_number_masked: string;
  currency: string;
  statement_count: number;
  transaction_count: number;
  earliest_period: string | null;
  latest_period: string | null;
  latest_balance: number | null;
}

/**
 * Get account summary using the account_summary view.
 */
export async function getAccountSummary(
  client: SupabaseClientAny,
  userId: string
): Promise<AccountSummaryRow[]> {
  const { data, error } = await client
    .from('account_summary')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to get account summary: ${error.message}`);
  }

  return data ?? [];
}

export interface MonthlyCategoryTotalsFilter {
  startMonth?: string;
  endMonth?: string;
  category?: string;
}

export interface MonthlyCategoryTotalsRow {
  user_id: string;
  month: string;
  effective_category: string | null;
  total_debits: number;
  total_credits: number;
  net_amount: number;
  transaction_count: number;
}

/**
 * Get monthly category totals using the monthly_category_totals view.
 */
export async function getMonthlyCategoryTotals(
  client: SupabaseClientAny,
  userId: string,
  filter?: MonthlyCategoryTotalsFilter
): Promise<MonthlyCategoryTotalsRow[]> {
  let query = client
    .from('monthly_category_totals')
    .select('*')
    .eq('user_id', userId)
    .order('month', { ascending: false });

  if (filter?.startMonth) {
    query = query.gte('month', filter.startMonth);
  }
  if (filter?.endMonth) {
    query = query.lte('month', filter.endMonth);
  }
  if (filter?.category) {
    query = query.eq('effective_category', filter.category);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get monthly category totals: ${error.message}`);
  }

  return data ?? [];
}

export interface MerchantSpendingFilter {
  minSpent?: number;
  category?: string;
  limit?: number;
}

export interface MerchantSpendingRow {
  user_id: string;
  effective_merchant: string | null;
  effective_category: string | null;
  transaction_count: number;
  total_spent: number;
  avg_transaction: number | null;
  first_seen: string;
  last_seen: string;
}

/**
 * Get merchant spending using the merchant_spending view.
 */
export async function getMerchantSpending(
  client: SupabaseClientAny,
  userId: string,
  filter?: MerchantSpendingFilter
): Promise<MerchantSpendingRow[]> {
  let query = client
    .from('merchant_spending')
    .select('*')
    .eq('user_id', userId)
    .order('total_spent', { ascending: false });

  if (filter?.minSpent !== undefined) {
    query = query.gte('total_spent', filter.minSpent);
  }
  if (filter?.category) {
    query = query.eq('effective_category', filter.category);
  }
  if (filter?.limit) {
    query = query.limit(filter.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get merchant spending: ${error.message}`);
  }

  return data ?? [];
}

export interface TransactionNeedingReviewRow extends TransactionRow {
  effective_category: string | null;
  effective_subcategory: string | null;
  effective_merchant: string | null;
  override_source: string | null;
  override_notes: string | null;
}

/**
 * Get transactions needing review (uncategorized or low confidence).
 */
export async function getTransactionsNeedingReview(
  client: SupabaseClientAny,
  userId: string,
  limit?: number
): Promise<TransactionNeedingReviewRow[]> {
  let query = client
    .from('transactions_needing_review')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get transactions needing review: ${error.message}`);
  }

  return data ?? [];
}

export interface AccountRow {
  id: string;
  user_id: string;
  institution: string;
  account_type: string;
  account_number_masked: string;
  currency: string;
  created_at: string;
}

/**
 * Get all accounts for a user.
 */
export async function getAccounts(
  client: SupabaseClientAny,
  userId: string
): Promise<AccountRow[]> {
  const { data, error } = await client
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get accounts: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Get a single transaction by its transaction_id.
 */
export async function getTransactionByTransactionId(
  client: SupabaseClientAny,
  userId: string,
  transactionId: string
): Promise<TransactionRow | null> {
  const { data, error } = await client
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('transaction_id', transactionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    throw new Error(`Failed to get transaction: ${error.message}`);
  }

  return data;
}

export interface AccountDateRange {
  accountId: string;
  institution: string;
  accountType: string;
  accountNumberMasked: string;
  minDate: string;
  maxDate: string;
  transactionCount: number;
}

/**
 * Get the min/max transaction date range for each account.
 * Used by the unified sync pipeline to detect coverage gaps.
 */
export async function getAccountDateRanges(
  client: SupabaseClientAny,
  userId: string
): Promise<AccountDateRange[]> {
  // Join accounts with an aggregate sub-query on transactions
  const { data: accounts, error: accErr } = await client
    .from('accounts')
    .select('id, institution, account_type, account_number_masked')
    .eq('user_id', userId);

  if (accErr) {
    throw new Error(`Failed to get accounts: ${accErr.message}`);
  }

  const results: AccountDateRange[] = [];

  for (const acc of accounts ?? []) {
    const { data: agg, error: aggErr } = await client
      .from('transactions')
      .select('date')
      .eq('user_id', userId)
      .eq('account_id', acc.id)
      .order('date', { ascending: true })
      .limit(1);

    const { data: aggMax, error: aggMaxErr } = await client
      .from('transactions')
      .select('date')
      .eq('user_id', userId)
      .eq('account_id', acc.id)
      .order('date', { ascending: false })
      .limit(1);

    const { count, error: cntErr } = await client
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('account_id', acc.id);

    if (aggErr || aggMaxErr || cntErr) continue;

    const minDate = agg?.[0]?.date;
    const maxDate = aggMax?.[0]?.date;

    if (minDate && maxDate) {
      results.push({
        accountId: acc.id,
        institution: acc.institution,
        accountType: acc.account_type,
        accountNumberMasked: acc.account_number_masked,
        minDate,
        maxDate,
        transactionCount: count ?? 0,
      });
    }
  }

  return results;
}

/**
 * Get daily balance for an account.
 */
export async function getDailyBalance(
  client: SupabaseClientAny,
  userId: string,
  accountId: string,
  startDate?: string,
  endDate?: string
): Promise<Array<{ date: string; daily_net: number; running_balance: number; transaction_count: number }>> {
  let query = client
    .from('daily_balance')
    .select('*')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .order('date', { ascending: true });

  if (startDate) {
    query = query.gte('date', startDate);
  }
  if (endDate) {
    query = query.lte('date', endDate);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get daily balance: ${error.message}`);
  }

  return data ?? [];
}
