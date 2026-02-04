/**
 * Data import functions for uploading parsed statements to Supabase.
 * Handles deduplication via deterministic IDs (statementId, transactionId).
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FinalResultV2 } from '../output/adapters.js';
import { PARSER_VERSION } from '../utils/constants.js';

type SupabaseClientAny = SupabaseClient<any, any, any>;

export interface ImportSourceInput {
  fileName: string;
  fileSha256: string;
  pageCount: number;
  provider?: string;
  notes?: string;
}

export interface ImportSourceResult {
  sourceId: string;
  isNew: boolean;
}

/**
 * Import a source file with SHA-256 deduplication.
 * Returns existing source if file was already uploaded.
 */
export async function importSource(
  client: SupabaseClientAny,
  userId: string,
  input: ImportSourceInput
): Promise<ImportSourceResult> {
  // Check if source already exists
  const { data: existing } = await client
    .from('sources')
    .select('id')
    .eq('user_id', userId)
    .eq('file_sha256', input.fileSha256)
    .single();

  if (existing) {
    return { sourceId: existing.id, isNew: false };
  }

  // Insert new source
  const { data, error } = await client
    .from('sources')
    .insert({
      user_id: userId,
      provider: input.provider ?? 'Bank of America',
      file_name: input.fileName,
      file_sha256: input.fileSha256,
      page_count: input.pageCount,
      notes: input.notes,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to import source: ${error.message}`);
  }

  return { sourceId: data.id, isNew: true };
}

export interface ImportParseRunInput {
  sourceId?: string;
  schemaVersion: string;
  options?: Record<string, unknown>;
  status: 'success' | 'failed';
  warnings: string[];
  outputSnapshot?: unknown;
}

export interface ImportParseRunResult {
  parseRunId: string;
}

/**
 * Store a parser execution record with optional JSONB snapshot.
 */
export async function importParseRun(
  client: SupabaseClientAny,
  userId: string,
  input: ImportParseRunInput
): Promise<ImportParseRunResult> {
  const { data, error } = await client
    .from('parse_runs')
    .insert({
      user_id: userId,
      source_id: input.sourceId,
      parser_version: PARSER_VERSION,
      schema_version: input.schemaVersion,
      options: input.options ?? {},
      status: input.status,
      warnings: input.warnings,
      output_snapshot: input.outputSnapshot ?? null,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to import parse run: ${error.message}`);
  }

  return { parseRunId: data.id };
}

export interface UpsertAccountInput {
  institution: string;
  accountType: string;
  accountNumberMasked: string;
  currency?: string;
}

export interface UpsertAccountResult {
  accountId: string;
  isNew: boolean;
}

/**
 * Create or update an account with natural key deduplication.
 * Natural key: (user_id, institution, account_type, account_number_masked)
 */
export async function upsertAccount(
  client: SupabaseClientAny,
  userId: string,
  input: UpsertAccountInput
): Promise<UpsertAccountResult> {
  // Check if account already exists
  const { data: existing } = await client
    .from('accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('institution', input.institution)
    .eq('account_type', input.accountType)
    .eq('account_number_masked', input.accountNumberMasked)
    .single();

  if (existing) {
    return { accountId: existing.id, isNew: false };
  }

  // Insert new account
  const { data, error } = await client
    .from('accounts')
    .insert({
      user_id: userId,
      institution: input.institution,
      account_type: input.accountType,
      account_number_masked: input.accountNumberMasked,
      currency: input.currency ?? 'USD',
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to upsert account: ${error.message}`);
  }

  return { accountId: data.id, isNew: true };
}

export interface UpsertStatementInput {
  accountId: string;
  statementId: string;
  periodStart: string;
  periodEnd: string;
  statementKind: string;
  startingBalance?: number;
  endingBalance?: number;
  totalCredits?: number;
  totalDebits?: number;
  transactionCount?: number;
  pageStart?: number;
  pageEnd?: number;
  provenance?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpsertStatementResult {
  statementDbId: string;
  isNew: boolean;
}

/**
 * Create or update a statement using statementId for deduplication.
 */
export async function upsertStatement(
  client: SupabaseClientAny,
  userId: string,
  input: UpsertStatementInput
): Promise<UpsertStatementResult> {
  // Check if statement already exists
  const { data: existing } = await client
    .from('statements')
    .select('id')
    .eq('user_id', userId)
    .eq('statement_id', input.statementId)
    .single();

  if (existing) {
    // Update existing statement
    const { error: updateError } = await client
      .from('statements')
      .update({
        starting_balance: input.startingBalance,
        ending_balance: input.endingBalance,
        total_credits: input.totalCredits,
        total_debits: input.totalDebits,
        transaction_count: input.transactionCount,
        page_start: input.pageStart,
        page_end: input.pageEnd,
        provenance: input.provenance ?? {},
        metadata: input.metadata ?? {},
      })
      .eq('id', existing.id);

    if (updateError) {
      throw new Error(`Failed to update statement: ${updateError.message}`);
    }

    return { statementDbId: existing.id, isNew: false };
  }

  // Insert new statement
  const { data, error } = await client
    .from('statements')
    .insert({
      user_id: userId,
      account_id: input.accountId,
      statement_id: input.statementId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      statement_kind: input.statementKind,
      starting_balance: input.startingBalance,
      ending_balance: input.endingBalance,
      total_credits: input.totalCredits,
      total_debits: input.totalDebits,
      transaction_count: input.transactionCount,
      page_start: input.pageStart,
      page_end: input.pageEnd,
      provenance: input.provenance ?? {},
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to insert statement: ${error.message}`);
  }

  return { statementDbId: data.id, isNew: true };
}

export interface TransactionInput {
  transactionId: string;
  date: string;
  postedDate?: string | null;
  amount: number;
  direction: 'debit' | 'credit';
  description: string;
  descriptionRaw?: string;
  merchant?: Record<string, unknown>;
  bankReference?: Record<string, unknown>;
  channel?: Record<string, unknown>;
  category?: string;
  subcategory?: string | null;
  confidence?: number;
  ruleId?: string | null;
  rationale?: string | null;
  flags?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface UpsertTransactionsInput {
  accountId: string;
  statementDbId?: string;
  transactions: TransactionInput[];
}

export interface UpsertTransactionsResult {
  inserted: number;
  skipped: number;
  transactionDbIds: string[];
}

/**
 * Batch insert transactions with transactionId deduplication.
 * Skips transactions that already exist (by transactionId).
 */
export async function upsertTransactions(
  client: SupabaseClientAny,
  userId: string,
  input: UpsertTransactionsInput
): Promise<UpsertTransactionsResult> {
  if (input.transactions.length === 0) {
    return { inserted: 0, skipped: 0, transactionDbIds: [] };
  }

  // Get existing transaction IDs
  const transactionIds = input.transactions.map((t) => t.transactionId);
  const { data: existingTxns } = await client
    .from('transactions')
    .select('id, transaction_id')
    .eq('user_id', userId)
    .in('transaction_id', transactionIds);

  const existingIdSet = new Set((existingTxns ?? []).map((t) => t.transaction_id));
  const existingDbIdMap = new Map((existingTxns ?? []).map((t) => [t.transaction_id, t.id]));

  // Filter out existing transactions
  const newTransactions = input.transactions.filter((t) => !existingIdSet.has(t.transactionId));

  const transactionDbIds: string[] = [];

  // Add existing DB IDs
  for (const txn of input.transactions) {
    const existingDbId = existingDbIdMap.get(txn.transactionId);
    if (existingDbId) {
      transactionDbIds.push(existingDbId);
    }
  }

  if (newTransactions.length === 0) {
    return {
      inserted: 0,
      skipped: input.transactions.length,
      transactionDbIds,
    };
  }

  // Prepare insert records
  const insertRecords = newTransactions.map((txn) => ({
    user_id: userId,
    account_id: input.accountId,
    statement_db_id: input.statementDbId,
    transaction_id: txn.transactionId,
    date: txn.date,
    posted_date: txn.postedDate,
    amount: txn.amount,
    direction: txn.direction,
    description: txn.description,
    description_raw: txn.descriptionRaw,
    merchant: txn.merchant ?? {},
    bank_reference: txn.bankReference ?? {},
    channel: txn.channel ?? {},
    category: txn.category,
    subcategory: txn.subcategory,
    confidence: txn.confidence,
    rule_id: txn.ruleId,
    rationale: txn.rationale,
    flags: txn.flags ?? {},
    raw: txn.raw ?? {},
  }));

  // Batch insert (Supabase handles batching internally)
  const { data, error } = await client
    .from('transactions')
    .insert(insertRecords)
    .select('id');

  if (error) {
    throw new Error(`Failed to insert transactions: ${error.message}`);
  }

  // Add new DB IDs
  for (const row of data ?? []) {
    transactionDbIds.push(row.id);
  }

  return {
    inserted: newTransactions.length,
    skipped: input.transactions.length - newTransactions.length,
    transactionDbIds,
  };
}

/**
 * Link a statement to its source and parse run.
 */
export async function linkStatementSource(
  client: SupabaseClientAny,
  statementDbId: string,
  sourceId: string,
  parseRunId: string,
  role: string = 'primary'
): Promise<void> {
  const { error } = await client.from('statement_sources').upsert(
    {
      statement_id: statementDbId,
      source_id: sourceId,
      parse_run_id: parseRunId,
      role,
    },
    { onConflict: 'statement_id,source_id,parse_run_id' }
  );

  if (error) {
    throw new Error(`Failed to link statement source: ${error.message}`);
  }
}

export interface ImportV2ResultInput {
  result: FinalResultV2;
  sourceId?: string;
  parseRunId?: string;
}

export interface ImportV2ResultOutput {
  accountsCreated: number;
  accountsExisting: number;
  statementsCreated: number;
  statementsUpdated: number;
  transactionsInserted: number;
  transactionsSkipped: number;
}

/**
 * Import a complete FinalResultV2 output to Supabase.
 * Handles account, statement, and transaction upserts with full deduplication.
 */
export async function importV2Result(
  client: SupabaseClientAny,
  userId: string,
  input: ImportV2ResultInput
): Promise<ImportV2ResultOutput> {
  const { result, sourceId, parseRunId } = input;
  const stats: ImportV2ResultOutput = {
    accountsCreated: 0,
    accountsExisting: 0,
    statementsCreated: 0,
    statementsUpdated: 0,
    transactionsInserted: 0,
    transactionsSkipped: 0,
  };

  // Group transactions by statementId for proper linking
  const txnsByStatement = new Map<string, typeof result.accounts[0]['transactions']>();

  for (const account of result.accounts) {
    // Upsert account
    const accountResult = await upsertAccount(client, userId, {
      institution: account.account.institution,
      accountType: account.account.accountType,
      accountNumberMasked: account.account.accountNumberMasked,
      currency: account.account.currency,
    });

    if (accountResult.isNew) {
      stats.accountsCreated++;
    } else {
      stats.accountsExisting++;
    }

    // Group transactions by statementId
    for (const txn of account.transactions) {
      const existing = txnsByStatement.get(txn.statementId) ?? [];
      existing.push(txn);
      txnsByStatement.set(txn.statementId, existing);
    }

    // Process each statement
    const processedStatements = new Set<string>();

    for (const txn of account.transactions) {
      if (processedStatements.has(txn.statementId)) continue;
      processedStatements.add(txn.statementId);

      const statementTxns = txnsByStatement.get(txn.statementId) ?? [];

      // Extract period from statementId (format: BOA-checking-****3529-2025-03-11-2025-04-09)
      const parts = txn.statementId.split('-');
      const periodEnd = parts.slice(-3).join('-');
      const periodStart = parts.slice(-6, -3).join('-');

      // Calculate statement totals from transactions
      let totalCredits = 0;
      let totalDebits = 0;
      for (const t of statementTxns) {
        if (t.direction === 'credit') {
          totalCredits += t.amount;
        } else {
          totalDebits += Math.abs(t.amount);
        }
      }

      // Upsert statement
      const statementResult = await upsertStatement(client, userId, {
        accountId: accountResult.accountId,
        statementId: txn.statementId,
        periodStart,
        periodEnd,
        statementKind: account.account.accountType,
        startingBalance: account.summary.startingBalance,
        endingBalance: account.summary.endingBalance,
        totalCredits,
        totalDebits,
        transactionCount: statementTxns.length,
      });

      if (statementResult.isNew) {
        stats.statementsCreated++;
      } else {
        stats.statementsUpdated++;
      }

      // Link statement to source/parse run if provided
      if (sourceId && parseRunId) {
        await linkStatementSource(client, statementResult.statementDbId, sourceId, parseRunId);
      }

      // Upsert transactions for this statement
      const txnResult = await upsertTransactions(client, userId, {
        accountId: accountResult.accountId,
        statementDbId: statementResult.statementDbId,
        transactions: statementTxns.map((t) => ({
          transactionId: t.transactionId,
          date: t.date,
          postedDate: t.postedDate,
          amount: t.direction === 'debit' ? -Math.abs(t.amount) : Math.abs(t.amount),
          direction: t.direction,
          description: t.description,
          merchant: { name: t.merchant },
          category: t.category,
          subcategory: t.subcategory,
          confidence: t.confidence,
          raw: t.raw,
        })),
      });

      stats.transactionsInserted += txnResult.inserted;
      stats.transactionsSkipped += txnResult.skipped;
    }
  }

  return stats;
}

/**
 * Compute SHA-256 hash of file contents.
 */
export function computeFileSha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
