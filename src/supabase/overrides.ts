/**
 * Override functions for human/ML category corrections.
 * Allows corrections without mutating raw transaction data.
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

export interface SetTransactionOverrideInput {
  transactionDbId: string;
  category?: string | null;
  subcategory?: string | null;
  merchantNormalizedName?: string | null;
  notes?: string | null;
  source: 'human' | 'ml' | 'rule';
  confidence?: number | null;
}

export interface TransactionOverrideRow {
  id: string;
  user_id: string;
  transaction_db_id: string;
  category: string | null;
  subcategory: string | null;
  merchant_normalized_name: string | null;
  notes: string | null;
  source: 'human' | 'ml' | 'rule';
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Set or update a transaction override (human/ML correction).
 * Uses upsert to handle both insert and update cases.
 */
export async function setTransactionOverride(
  client: SupabaseClientAny,
  userId: string,
  input: SetTransactionOverrideInput
): Promise<TransactionOverrideRow> {
  const { data, error } = await client
    .from('transaction_overrides')
    .upsert(
      {
        user_id: userId,
        transaction_db_id: input.transactionDbId,
        category: input.category,
        subcategory: input.subcategory,
        merchant_normalized_name: input.merchantNormalizedName,
        notes: input.notes,
        source: input.source,
        confidence: input.confidence,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'transaction_db_id' }
    )
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to set transaction override: ${error.message}`);
  }

  return data;
}

/**
 * Get override for a specific transaction.
 */
export async function getTransactionOverride(
  client: SupabaseClientAny,
  userId: string,
  transactionDbId: string
): Promise<TransactionOverrideRow | null> {
  const { data, error } = await client
    .from('transaction_overrides')
    .select('*')
    .eq('user_id', userId)
    .eq('transaction_db_id', transactionDbId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    throw new Error(`Failed to get transaction override: ${error.message}`);
  }

  return data;
}

/**
 * Delete a transaction override.
 */
export async function deleteTransactionOverride(
  client: SupabaseClientAny,
  userId: string,
  transactionDbId: string
): Promise<void> {
  const { error } = await client
    .from('transaction_overrides')
    .delete()
    .eq('user_id', userId)
    .eq('transaction_db_id', transactionDbId);

  if (error) {
    throw new Error(`Failed to delete transaction override: ${error.message}`);
  }
}

/**
 * Batch set overrides for multiple transactions.
 */
export async function setTransactionOverridesBatch(
  client: SupabaseClientAny,
  userId: string,
  inputs: SetTransactionOverrideInput[]
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  for (const input of inputs) {
    try {
      await setTransactionOverride(client, userId, input);
      succeeded++;
    } catch {
      failed++;
    }
  }

  return { succeeded, failed };
}

/**
 * Get all overrides for a user.
 */
export async function getAllOverrides(
  client: SupabaseClientAny,
  userId: string,
  limit?: number
): Promise<TransactionOverrideRow[]> {
  let query = client
    .from('transaction_overrides')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get overrides: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Get overrides by source type (human, ml, rule).
 */
export async function getOverridesBySource(
  client: SupabaseClientAny,
  userId: string,
  source: 'human' | 'ml' | 'rule'
): Promise<TransactionOverrideRow[]> {
  const { data, error } = await client
    .from('transaction_overrides')
    .select('*')
    .eq('user_id', userId)
    .eq('source', source)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get overrides by source: ${error.message}`);
  }

  return data ?? [];
}
