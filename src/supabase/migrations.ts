/**
 * Auto-migration system for Supabase database tables.
 * Creates tables if they don't exist using service role key.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

type SupabaseClientAny = SupabaseClient<any, any, any>;

/**
 * SQL schema for all tables.
 */
const SCHEMA_SQL = `
-- Normalized ledger schema for Supabase
-- All monetary values use numeric(14,2)

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  file_name text not null,
  file_sha256 text not null,
  page_count int not null,
  uploaded_at timestamptz not null default now(),
  notes text,
  unique (user_id, file_sha256)
);

create table if not exists parse_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_id uuid references sources(id),
  parser_version text not null,
  schema_version text not null,
  options jsonb not null default '{}'::jsonb,
  status text not null check (status in ('success','failed')),
  warnings jsonb not null default '[]'::jsonb,
  output_snapshot jsonb,
  created_at timestamptz not null default now()
);

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  institution text not null,
  account_type text not null,
  account_number_masked text not null,
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  unique (user_id, institution, account_type, account_number_masked)
);

create table if not exists statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null references accounts(id),
  statement_id text not null,
  period_start date not null,
  period_end date not null,
  statement_kind text not null,
  starting_balance numeric(14,2),
  ending_balance numeric(14,2),
  total_credits numeric(14,2),
  total_debits numeric(14,2),
  transaction_count int,
  page_start int,
  page_end int,
  provenance jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, statement_id)
);

create table if not exists statement_sources (
  statement_id uuid references statements(id),
  source_id uuid references sources(id),
  parse_run_id uuid references parse_runs(id),
  role text not null,
  created_at timestamptz not null default now(),
  primary key (statement_id, source_id, parse_run_id)
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null references accounts(id),
  statement_db_id uuid references statements(id),
  transaction_id text not null,
  date date not null,
  posted_date date,
  amount numeric(14,2) not null,
  direction text not null,
  description text not null,
  description_raw text,
  merchant jsonb not null default '{}'::jsonb,
  bank_reference jsonb not null default '{}'::jsonb,
  channel jsonb not null default '{}'::jsonb,
  category text,
  subcategory text,
  confidence real,
  rule_id text,
  rationale text,
  flags jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, transaction_id)
);

create table if not exists transaction_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  transaction_db_id uuid not null references transactions(id),
  category text,
  subcategory text,
  merchant_normalized_name text,
  notes text,
  source text not null check (source in ('human','ml','rule')),
  confidence real,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_db_id)
);
`;

/**
 * SQL for indexes.
 */
const INDEXES_SQL = `
create index if not exists idx_transactions_user_date on transactions(user_id, date);
create index if not exists idx_transactions_user_account_date on transactions(user_id, account_id, date);
create index if not exists idx_transactions_user_category on transactions(user_id, category);
create index if not exists idx_transactions_user_statement on transactions(user_id, statement_db_id);
create index if not exists idx_transactions_merchant_gin on transactions using gin (merchant);
create index if not exists idx_statements_user_account_period
  on statements(user_id, account_id, period_start, period_end);
create index if not exists idx_transaction_overrides_user
  on transaction_overrides(user_id);
create index if not exists idx_transaction_overrides_txn
  on transaction_overrides(transaction_db_id);
`;

/**
 * SQL for RLS policies (optional - requires service role).
 */
const RLS_SQL = `
-- Enable Row Level Security
alter table sources enable row level security;
alter table parse_runs enable row level security;
alter table accounts enable row level security;
alter table statements enable row level security;
alter table transactions enable row level security;
alter table statement_sources enable row level security;
alter table transaction_overrides enable row level security;

-- Drop existing policies if they exist (to allow re-running)
drop policy if exists "select_own_sources" on sources;
drop policy if exists "insert_own_sources" on sources;
drop policy if exists "select_own_parse_runs" on parse_runs;
drop policy if exists "insert_own_parse_runs" on parse_runs;
drop policy if exists "select_own_accounts" on accounts;
drop policy if exists "insert_own_accounts" on accounts;
drop policy if exists "update_own_accounts" on accounts;
drop policy if exists "select_own_statements" on statements;
drop policy if exists "insert_own_statements" on statements;
drop policy if exists "update_own_statements" on statements;
drop policy if exists "select_own_transactions" on transactions;
drop policy if exists "insert_own_transactions" on transactions;
drop policy if exists "update_own_transactions" on transactions;
drop policy if exists "select_own_statement_sources" on statement_sources;
drop policy if exists "insert_own_statement_sources" on statement_sources;
drop policy if exists "select_own_transaction_overrides" on transaction_overrides;
drop policy if exists "insert_own_transaction_overrides" on transaction_overrides;
drop policy if exists "update_own_transaction_overrides" on transaction_overrides;
drop policy if exists "delete_own_transaction_overrides" on transaction_overrides;

-- Create policies
create policy "select_own_sources" on sources for select using (user_id = auth.uid());
create policy "insert_own_sources" on sources for insert with check (user_id = auth.uid());

create policy "select_own_parse_runs" on parse_runs for select using (user_id = auth.uid());
create policy "insert_own_parse_runs" on parse_runs for insert with check (user_id = auth.uid());

create policy "select_own_accounts" on accounts for select using (user_id = auth.uid());
create policy "insert_own_accounts" on accounts for insert with check (user_id = auth.uid());
create policy "update_own_accounts" on accounts for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "select_own_statements" on statements for select using (user_id = auth.uid());
create policy "insert_own_statements" on statements for insert with check (user_id = auth.uid());
create policy "update_own_statements" on statements for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "select_own_transactions" on transactions for select using (user_id = auth.uid());
create policy "insert_own_transactions" on transactions for insert with check (user_id = auth.uid());
create policy "update_own_transactions" on transactions for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "select_own_statement_sources" on statement_sources for select using (
  exists (select 1 from statements s where s.id = statement_sources.statement_id and s.user_id = auth.uid())
);
create policy "insert_own_statement_sources" on statement_sources for insert with check (
  exists (select 1 from statements s where s.id = statement_sources.statement_id and s.user_id = auth.uid())
);

create policy "select_own_transaction_overrides" on transaction_overrides for select using (user_id = auth.uid());
create policy "insert_own_transaction_overrides" on transaction_overrides for insert with check (user_id = auth.uid());
create policy "update_own_transaction_overrides" on transaction_overrides for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete_own_transaction_overrides" on transaction_overrides for delete using (user_id = auth.uid());
`;

/**
 * SQL for views.
 */
const VIEWS_SQL = `
-- Apply human overrides without mutating raw data
create or replace view transactions_effective as
select
  t.*,
  coalesce(o.category, t.category) as effective_category,
  coalesce(o.subcategory, t.subcategory) as effective_subcategory,
  coalesce(o.merchant_normalized_name, t.merchant->>'normalizedName') as effective_merchant,
  o.source as override_source,
  o.notes as override_notes
from transactions t
left join transaction_overrides o on o.transaction_db_id = t.id;

-- Monthly spending by category
create or replace view monthly_category_totals as
select
  user_id,
  date_trunc('month', date)::date as month,
  effective_category,
  sum(case when amount < 0 then amount else 0 end) as total_debits,
  sum(case when amount > 0 then amount else 0 end) as total_credits,
  sum(amount) as net_amount,
  count(*) as transaction_count
from transactions_effective
group by 1, 2, 3;

-- Account summary with latest statement info
create or replace view account_summary as
select
  a.id as account_id,
  a.user_id,
  a.institution,
  a.account_type,
  a.account_number_masked,
  a.currency,
  count(distinct s.id) as statement_count,
  count(distinct t.id) as transaction_count,
  min(s.period_start) as earliest_period,
  max(s.period_end) as latest_period,
  (
    select ending_balance
    from statements s2
    where s2.account_id = a.id
    order by s2.period_end desc
    limit 1
  ) as latest_balance
from accounts a
left join statements s on s.account_id = a.id
left join transactions t on t.account_id = a.id
group by a.id, a.user_id, a.institution, a.account_type, a.account_number_masked, a.currency;

-- Top merchants by spending
create or replace view merchant_spending as
select
  user_id,
  effective_merchant,
  effective_category,
  count(*) as transaction_count,
  sum(case when amount < 0 then abs(amount) else 0 end) as total_spent,
  avg(case when amount < 0 then abs(amount) else null end) as avg_transaction,
  min(date) as first_seen,
  max(date) as last_seen
from transactions_effective
where effective_merchant is not null
group by 1, 2, 3;

-- Daily running balance per account
create or replace view daily_balance as
select
  user_id,
  account_id,
  date,
  sum(amount) as daily_net,
  sum(sum(amount)) over (
    partition by user_id, account_id
    order by date
    rows unbounded preceding
  ) as running_balance,
  count(*) as transaction_count
from transactions
group by 1, 2, 3;

-- Parse run statistics
create or replace view parse_run_stats as
select
  pr.id as parse_run_id,
  pr.user_id,
  pr.parser_version,
  pr.schema_version,
  pr.status,
  pr.created_at,
  s.file_name,
  s.provider,
  jsonb_array_length(pr.warnings) as warning_count,
  (
    select count(*)
    from statements st
    join statement_sources ss on ss.statement_id = st.id
    where ss.parse_run_id = pr.id
  ) as statement_count
from parse_runs pr
left join sources s on s.id = pr.source_id;

-- Uncategorized transactions needing review
create or replace view transactions_needing_review as
select *
from transactions_effective
where effective_category is null
   or effective_category = 'Uncategorized'
   or confidence < 0.7
order by date desc;
`;

/**
 * Required tables for the schema.
 */
const REQUIRED_TABLES = [
  'sources',
  'parse_runs',
  'accounts',
  'statements',
  'statement_sources',
  'transactions',
  'transaction_overrides',
];

export interface MigrationResult {
  success: boolean;
  tablesCreated: string[];
  tablesExisting: string[];
  indexesCreated: boolean;
  viewsCreated: boolean;
  rlsEnabled: boolean;
  errors: string[];
}

/**
 * Check which tables already exist.
 */
export async function checkExistingTables(
  client: SupabaseClientAny,
  verbose = false
): Promise<{ existing: string[]; missing: string[] }> {
  const existing: string[] = [];
  const missing: string[] = [];

  for (const table of REQUIRED_TABLES) {
    // Use count instead of select id - some tables don't have 'id' column (e.g., statement_sources)
    const { error } = await client.from(table).select('*', { count: 'exact', head: true });

    if (error !== null && error !== undefined) {
      // Check if it's a "relation does not exist" error (table missing)
      // vs RLS/permission error (table exists but no access)
      const errorMessage = error.message ?? '';
      const errorCode = error.code ?? '';
      
      if (verbose) {
        console.error(`[DEBUG] Table ${table}: error.code=${errorCode}, error.message=${errorMessage}`);
      }
      
      const isTableMissing = errorMessage.includes('does not exist') ||
                             errorCode === '42P01' || // PostgreSQL: undefined_table
                             errorCode === 'PGRST204'; // PostgREST: table not found
      
      if (isTableMissing) {
        missing.push(table);
      } else {
        // Table exists but we got a different error (likely RLS with no rows, or empty result)
        existing.push(table);
      }
    } else {
      // No error means table exists (data may be empty array due to RLS, but that's fine)
      existing.push(table);
      if (verbose) {
        console.error(`[DEBUG] Table ${table}: OK`);
      }
    }
  }

  return { existing, missing };
}

/**
 * Check if migrations are needed.
 */
export async function needsMigration(client: SupabaseClientAny): Promise<boolean> {
  const { missing } = await checkExistingTables(client);
  return missing.length > 0;
}

/**
 * Run database migrations using Supabase's rpc function.
 * Requires service role key for DDL operations.
 *
 * NOTE: Supabase doesn't allow direct DDL via the client API.
 * You need to either:
 * 1. Run migrations via Supabase Dashboard SQL Editor
 * 2. Use Supabase CLI: `supabase db push`
 * 3. Create a custom RPC function that runs migrations
 *
 * This function provides the SQL that needs to be run.
 */
export async function runMigrations(
  client: SupabaseClientAny,
  options: {
    enableRls?: boolean;
    createViews?: boolean;
    verbose?: boolean;
  } = {}
): Promise<MigrationResult> {
  const { enableRls = false, createViews = true, verbose = false } = options;

  const result: MigrationResult = {
    success: false,
    tablesCreated: [],
    tablesExisting: [],
    indexesCreated: false,
    viewsCreated: false,
    rlsEnabled: false,
    errors: [],
  };

  // Check current state
  const { existing, missing } = await checkExistingTables(client);
  result.tablesExisting = existing;

  if (missing.length === 0) {
    if (verbose) {
      console.error('[INFO] All tables already exist, no migration needed');
    }
    result.success = true;
    return result;
  }

  if (verbose) {
    console.error(`[INFO] Missing tables: ${missing.join(', ')}`);
    console.error('[INFO] Attempting to run migrations...');
  }

  // Try to run schema SQL via RPC (requires a custom function in Supabase)
  // Most Supabase projects don't have this, so we'll try and catch the error
  try {
    const { error: schemaError } = await client.rpc('run_sql', { sql: SCHEMA_SQL });

    if (schemaError !== null && schemaError !== undefined) {
      // RPC function doesn't exist - provide manual instructions
      result.errors.push(
        'Cannot auto-create tables. Please run the schema SQL manually in Supabase Dashboard.'
      );
      result.errors.push('Go to: Supabase Dashboard > SQL Editor > New Query');
      result.errors.push('Then run the SQL from: .windsurf/skills/supabase-bank-ledger-schema/references/schema.sql');
      return result;
    }

    result.tablesCreated = missing;

    // Run indexes
    const { error: indexError } = await client.rpc('run_sql', { sql: INDEXES_SQL });
    if (indexError === null || indexError === undefined) {
      result.indexesCreated = true;
    }

    // Run RLS if requested
    if (enableRls) {
      const { error: rlsError } = await client.rpc('run_sql', { sql: RLS_SQL });
      if (rlsError === null || rlsError === undefined) {
        result.rlsEnabled = true;
      }
    }

    // Run views if requested
    if (createViews) {
      const { error: viewsError } = await client.rpc('run_sql', { sql: VIEWS_SQL });
      if (viewsError === null || viewsError === undefined) {
        result.viewsCreated = true;
      }
    }

    result.success = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(`Migration failed: ${message}`);
  }

  return result;
}

/**
 * Get the full migration SQL for manual execution.
 */
export function getMigrationSQL(options: {
  includeRls?: boolean;
  includeViews?: boolean;
} = {}): string {
  const { includeRls = true, includeViews = true } = options;

  let sql = '-- BOA Statement Parser Database Schema\n';
  sql += '-- Run this SQL in Supabase Dashboard > SQL Editor\n\n';
  sql += '-- ============================================\n';
  sql += '-- STEP 1: Create Tables\n';
  sql += '-- ============================================\n';
  sql += SCHEMA_SQL;
  sql += '\n\n-- ============================================\n';
  sql += '-- STEP 2: Create Indexes\n';
  sql += '-- ============================================\n';
  sql += INDEXES_SQL;

  if (includeRls) {
    sql += '\n\n-- ============================================\n';
    sql += '-- STEP 3: Enable Row Level Security\n';
    sql += '-- ============================================\n';
    sql += RLS_SQL;
  }

  if (includeViews) {
    sql += '\n\n-- ============================================\n';
    sql += '-- STEP 4: Create Views\n';
    sql += '-- ============================================\n';
    sql += VIEWS_SQL;
  }

  return sql;
}

/**
 * Export SQL to a file for manual execution.
 */
export function exportMigrationSQL(): string {
  return getMigrationSQL({ includeRls: true, includeViews: true });
}

/**
 * Configuration for auto-migration via direct PostgreSQL connection.
 */
export interface AutoMigrationConfig {
  /** Supabase project URL (e.g., https://xxx.supabase.co) */
  supabaseUrl: string;
  /** Database password (from Supabase Dashboard > Settings > Database) */
  databasePassword: string;
  /** Include RLS policies (default: true) */
  includeRls?: boolean;
  /** Include views (default: true) */
  includeViews?: boolean;
  /** Verbose logging (default: false) */
  verbose?: boolean;
}

export interface AutoMigrationResult {
  success: boolean;
  tablesCreated: boolean;
  indexesCreated: boolean;
  rlsEnabled: boolean;
  viewsCreated: boolean;
  errors: string[];
}

/**
 * Extract the project reference from a Supabase URL.
 * e.g., "https://abcdefghijkl.supabase.co" -> "abcdefghijkl"
 */
function extractProjectRef(supabaseUrl: string): string {
  const match = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
  if (match === null || match[1] === undefined) {
    throw new Error(`Invalid Supabase URL: ${supabaseUrl}`);
  }
  return match[1];
}

/**
 * Build PostgreSQL connection string for Supabase.
 * Uses direct connection (port 5432) for DDL operations.
 * Pooler (port 6543) doesn't support DDL well.
 */
function buildConnectionString(supabaseUrl: string, databasePassword: string): string {
  const projectRef = extractProjectRef(supabaseUrl);
  // Direct connection format (required for DDL operations like CREATE TABLE)
  // Format: postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
  return `postgresql://postgres:${encodeURIComponent(databasePassword)}@db.${projectRef}.supabase.co:5432/postgres`;
}

/**
 * Run migrations automatically via direct PostgreSQL connection.
 * Requires the database password from Supabase Dashboard > Settings > Database.
 */
export async function runAutoMigration(config: AutoMigrationConfig): Promise<AutoMigrationResult> {
  const {
    supabaseUrl,
    databasePassword,
    includeRls = true,
    includeViews = true,
    verbose = false,
  } = config;

  const result: AutoMigrationResult = {
    success: false,
    tablesCreated: false,
    indexesCreated: false,
    rlsEnabled: false,
    viewsCreated: false,
    errors: [],
  };

  let client: pg.Client | null = null;

  try {
    const connectionString = buildConnectionString(supabaseUrl, databasePassword);

    if (verbose) {
      console.error('[INFO] Connecting to Supabase PostgreSQL...');
    }

    client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();

    if (verbose) {
      console.error('[INFO] Connected. Running schema migration...');
    }

    // Step 1: Create tables
    await client.query(SCHEMA_SQL);
    result.tablesCreated = true;
    if (verbose) {
      console.error('[INFO] Tables created.');
    }

    // Step 2: Create indexes
    await client.query(INDEXES_SQL);
    result.indexesCreated = true;
    if (verbose) {
      console.error('[INFO] Indexes created.');
    }

    // Step 3: Enable RLS (optional)
    if (includeRls) {
      await client.query(RLS_SQL);
      result.rlsEnabled = true;
      if (verbose) {
        console.error('[INFO] RLS policies enabled.');
      }
    }

    // Step 4: Create views (optional)
    if (includeViews) {
      await client.query(VIEWS_SQL);
      result.viewsCreated = true;
      if (verbose) {
        console.error('[INFO] Views created.');
      }
    }

    result.success = true;
    if (verbose) {
      console.error('[INFO] Migration completed successfully!');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(message);

    // Provide helpful error messages
    if (message.includes('password authentication failed')) {
      result.errors.push('Hint: Check your database password in Supabase Dashboard > Settings > Database');
    } else if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
      result.errors.push('Hint: Check your SUPABASE_URL is correct');
    }
  } finally {
    if (client !== null) {
      await client.end();
    }
  }

  return result;
}

/**
 * Check if auto-migration is possible (all required env vars are set).
 */
export function canAutoMigrate(): {
  possible: boolean;
  missing: string[];
} {
  const missing: string[] = [];

  if (process.env['SUPABASE_URL'] === undefined || process.env['SUPABASE_URL'] === '') {
    missing.push('SUPABASE_URL');
  }
  if (process.env['SUPABASE_DB_PASSWORD'] === undefined || process.env['SUPABASE_DB_PASSWORD'] === '') {
    missing.push('SUPABASE_DB_PASSWORD');
  }

  return {
    possible: missing.length === 0,
    missing,
  };
}
