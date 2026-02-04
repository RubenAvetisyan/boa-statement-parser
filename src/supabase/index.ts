/**
 * Supabase integration module for boa-statement-parser.
 * Provides database storage, querying, and override functionality.
 */

// Client
export {
  createSupabaseClient,
  getSupabaseClient,
  getSupabaseConfig,
  resetSupabaseClient,
  isSupabaseConfigured,
  testConnection,
  type SupabaseConfig,
  type SupabaseClient,
} from './client.js';

// Types
export type {
  Database,
  Json,
  Tables,
  InsertTables,
  UpdateTables,
  Views,
} from './types.js';

// Import functions
export {
  importSource,
  importParseRun,
  upsertAccount,
  upsertStatement,
  upsertTransactions,
  linkStatementSource,
  importV2Result,
  computeFileSha256,
  type ImportSourceInput,
  type ImportSourceResult,
  type ImportParseRunInput,
  type ImportParseRunResult,
  type UpsertAccountInput,
  type UpsertAccountResult,
  type UpsertStatementInput,
  type UpsertStatementResult,
  type TransactionInput,
  type UpsertTransactionsInput,
  type UpsertTransactionsResult,
  type ImportV2ResultInput,
  type ImportV2ResultOutput,
} from './import.js';

// Query functions
export {
  getTransactions,
  getStatements,
  getAccountSummary,
  getMonthlyCategoryTotals,
  getMerchantSpending,
  getTransactionsNeedingReview,
  getAccounts,
  getTransactionByTransactionId,
  getDailyBalance,
  type TransactionFilter,
  type TransactionRow,
  type StatementFilter,
  type StatementRow,
  type AccountSummaryRow,
  type MonthlyCategoryTotalsFilter,
  type MonthlyCategoryTotalsRow,
  type MerchantSpendingFilter,
  type MerchantSpendingRow,
  type TransactionNeedingReviewRow,
  type AccountRow,
} from './queries.js';

// Override functions
export {
  setTransactionOverride,
  getTransactionOverride,
  deleteTransactionOverride,
  setTransactionOverridesBatch,
  getAllOverrides,
  getOverridesBySource,
  type SetTransactionOverrideInput,
  type TransactionOverrideRow,
} from './overrides.js';
