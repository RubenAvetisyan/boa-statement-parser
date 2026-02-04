/**
 * Supabase client initialization and configuration.
 * Supports environment-based configuration and connection pooling.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.js';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string | undefined;
}

let supabaseInstance: SupabaseClient<Database> | null = null;

/**
 * Get Supabase configuration from environment variables or explicit config.
 * Priority: explicit config > environment variables
 */
export function getSupabaseConfig(config?: Partial<SupabaseConfig>): SupabaseConfig {
  const url = config?.url ?? process.env['SUPABASE_URL'];
  const anonKey = config?.anonKey ?? process.env['SUPABASE_ANON_KEY'];
  const serviceRoleKey = config?.serviceRoleKey ?? process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (url === undefined || url === '') {
    throw new Error(
      'Supabase URL is required. Set SUPABASE_URL environment variable or pass url in config.'
    );
  }

  if (anonKey === undefined || anonKey === '') {
    throw new Error(
      'Supabase anon key is required. Set SUPABASE_ANON_KEY environment variable or pass anonKey in config.'
    );
  }

  return {
    url,
    anonKey,
    serviceRoleKey,
  };
}

/**
 * Create a new Supabase client instance.
 * Uses service role key if available for server-side operations.
 */
export function createSupabaseClient(config?: Partial<SupabaseConfig>): SupabaseClient<Database> {
  const { url, anonKey, serviceRoleKey } = getSupabaseConfig(config);

  // Use service role key for server-side operations if available
  const key = serviceRoleKey ?? anonKey;

  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
  });
}

/**
 * Get or create a singleton Supabase client instance.
 * Useful for CLI operations where we want to reuse the same connection.
 */
export function getSupabaseClient(config?: Partial<SupabaseConfig>): SupabaseClient<Database> {
  if (!supabaseInstance) {
    supabaseInstance = createSupabaseClient(config);
  }
  return supabaseInstance;
}

/**
 * Reset the singleton client instance.
 * Useful for testing or when configuration changes.
 */
export function resetSupabaseClient(): void {
  supabaseInstance = null;
}

/**
 * Check if Supabase is configured (environment variables are set).
 */
export function isSupabaseConfigured(): boolean {
  return !!(process.env['SUPABASE_URL'] && process.env['SUPABASE_ANON_KEY']);
}

/**
 * Test the Supabase connection by making a simple query.
 */
export async function testConnection(client?: SupabaseClient<Database>): Promise<{
  success: boolean;
  error?: string;
}> {
  const supabase = client ?? getSupabaseClient();

  try {
    // Try to query the accounts table (should return empty if no data)
    const { error } = await supabase.from('accounts').select('id').limit(1);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export type { SupabaseClient };
