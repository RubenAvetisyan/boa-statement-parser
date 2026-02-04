/**
 * Supabase database types for the bank ledger schema.
 * These types are aligned with the schema defined in references/schema.sql
 */

/* eslint-disable @typescript-eslint/no-redundant-type-constituents */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      sources: {
        Row: {
          id: string;
          user_id: string;
          provider: string;
          file_name: string;
          file_sha256: string;
          page_count: number;
          uploaded_at: string;
          notes: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider: string;
          file_name: string;
          file_sha256: string;
          page_count: number;
          uploaded_at?: string;
          notes?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          provider?: string;
          file_name?: string;
          file_sha256?: string;
          page_count?: number;
          uploaded_at?: string;
          notes?: string | null;
        };
      };
      parse_runs: {
        Row: {
          id: string;
          user_id: string;
          source_id: string | null;
          parser_version: string;
          schema_version: string;
          options: Json;
          status: 'success' | 'failed';
          warnings: Json;
          output_snapshot: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_id?: string | null;
          parser_version: string;
          schema_version: string;
          options?: Json;
          status: 'success' | 'failed';
          warnings?: Json;
          output_snapshot?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          source_id?: string | null;
          parser_version?: string;
          schema_version?: string;
          options?: Json;
          status?: 'success' | 'failed';
          warnings?: Json;
          output_snapshot?: Json | null;
          created_at?: string;
        };
      };
      accounts: {
        Row: {
          id: string;
          user_id: string;
          institution: string;
          account_type: string;
          account_number_masked: string;
          currency: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          institution: string;
          account_type: string;
          account_number_masked: string;
          currency?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          institution?: string;
          account_type?: string;
          account_number_masked?: string;
          currency?: string;
          created_at?: string;
        };
      };
      statements: {
        Row: {
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
          provenance: Json;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          account_id: string;
          statement_id: string;
          period_start: string;
          period_end: string;
          statement_kind: string;
          starting_balance?: number | null;
          ending_balance?: number | null;
          total_credits?: number | null;
          total_debits?: number | null;
          transaction_count?: number | null;
          page_start?: number | null;
          page_end?: number | null;
          provenance?: Json;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          account_id?: string;
          statement_id?: string;
          period_start?: string;
          period_end?: string;
          statement_kind?: string;
          starting_balance?: number | null;
          ending_balance?: number | null;
          total_credits?: number | null;
          total_debits?: number | null;
          transaction_count?: number | null;
          page_start?: number | null;
          page_end?: number | null;
          provenance?: Json;
          metadata?: Json;
          created_at?: string;
        };
      };
      statement_sources: {
        Row: {
          statement_id: string;
          source_id: string;
          parse_run_id: string;
          role: string;
          created_at: string;
        };
        Insert: {
          statement_id: string;
          source_id: string;
          parse_run_id: string;
          role: string;
          created_at?: string;
        };
        Update: {
          statement_id?: string;
          source_id?: string;
          parse_run_id?: string;
          role?: string;
          created_at?: string;
        };
      };
      transactions: {
        Row: {
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
          merchant: Json;
          bank_reference: Json;
          channel: Json;
          category: string | null;
          subcategory: string | null;
          confidence: number | null;
          rule_id: string | null;
          rationale: string | null;
          flags: Json;
          raw: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          account_id: string;
          statement_db_id?: string | null;
          transaction_id: string;
          date: string;
          posted_date?: string | null;
          amount: number;
          direction: string;
          description: string;
          description_raw?: string | null;
          merchant?: Json;
          bank_reference?: Json;
          channel?: Json;
          category?: string | null;
          subcategory?: string | null;
          confidence?: number | null;
          rule_id?: string | null;
          rationale?: string | null;
          flags?: Json;
          raw?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          account_id?: string;
          statement_db_id?: string | null;
          transaction_id?: string;
          date?: string;
          posted_date?: string | null;
          amount?: number;
          direction?: string;
          description?: string;
          description_raw?: string | null;
          merchant?: Json;
          bank_reference?: Json;
          channel?: Json;
          category?: string | null;
          subcategory?: string | null;
          confidence?: number | null;
          rule_id?: string | null;
          rationale?: string | null;
          flags?: Json;
          raw?: Json;
          created_at?: string;
        };
      };
      transaction_overrides: {
        Row: {
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
        };
        Insert: {
          id?: string;
          user_id: string;
          transaction_db_id: string;
          category?: string | null;
          subcategory?: string | null;
          merchant_normalized_name?: string | null;
          notes?: string | null;
          source: 'human' | 'ml' | 'rule';
          confidence?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          transaction_db_id?: string;
          category?: string | null;
          subcategory?: string | null;
          merchant_normalized_name?: string | null;
          notes?: string | null;
          source?: 'human' | 'ml' | 'rule';
          confidence?: number | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: {
      transactions_effective: {
        Row: {
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
          merchant: Json;
          bank_reference: Json;
          channel: Json;
          category: string | null;
          subcategory: string | null;
          confidence: number | null;
          rule_id: string | null;
          rationale: string | null;
          flags: Json;
          raw: Json;
          created_at: string;
          effective_category: string | null;
          effective_subcategory: string | null;
          effective_merchant: string | null;
          override_source: string | null;
          override_notes: string | null;
        };
      };
      monthly_category_totals: {
        Row: {
          user_id: string;
          month: string;
          effective_category: string | null;
          total_debits: number;
          total_credits: number;
          net_amount: number;
          transaction_count: number;
        };
      };
      account_summary: {
        Row: {
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
        };
      };
      merchant_spending: {
        Row: {
          user_id: string;
          effective_merchant: string | null;
          effective_category: string | null;
          transaction_count: number;
          total_spent: number;
          avg_transaction: number | null;
          first_seen: string;
          last_seen: string;
        };
      };
      daily_balance: {
        Row: {
          user_id: string;
          account_id: string;
          date: string;
          daily_net: number;
          running_balance: number;
          transaction_count: number;
        };
      };
      parse_run_stats: {
        Row: {
          parse_run_id: string;
          user_id: string;
          parser_version: string;
          schema_version: string;
          status: string;
          created_at: string;
          file_name: string | null;
          provider: string | null;
          warning_count: number;
          statement_count: number;
        };
      };
      transactions_needing_review: {
        Row: {
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
          merchant: Json;
          bank_reference: Json;
          channel: Json;
          category: string | null;
          subcategory: string | null;
          confidence: number | null;
          rule_id: string | null;
          rationale: string | null;
          flags: Json;
          raw: Json;
          created_at: string;
          effective_category: string | null;
          effective_subcategory: string | null;
          effective_merchant: string | null;
          override_source: string | null;
          override_notes: string | null;
        };
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type InsertTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type UpdateTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
export type Views<T extends keyof Database['public']['Views']> =
  Database['public']['Views'][T]['Row'];
