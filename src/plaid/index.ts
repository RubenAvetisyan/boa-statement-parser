/**
 * Plaid integration module for boa-statement-parser.
 * Provides live banking data ingestion via Plaid API.
 */

// Client
export {
  createPlaidClient,
  getPlaidClient,
  getPlaidConfig,
  resetPlaidClient,
  isPlaidConfigured,
  testPlaidConnection,
  type PlaidApi,
} from './client.js';

// Types
export type {
  PlaidConfig,
  PlaidEnvironment,
  PlaidItem,
  PlaidItemStatus,
  PlaidAccount,
  PlaidTransaction,
  PlaidSyncResult,
  CreateLinkTokenOptions,
  CreateLinkTokenResult,
  ExchangePublicTokenResult,
  PlaidError,
} from './types.js';

export { isPlaidError } from './types.js';

// Link
export {
  createLinkToken,
  createUpdateLinkToken,
  exchangePublicToken,
  getItem,
  removeItem,
  getInstitution,
  createSandboxPublicToken,
} from './link.js';

// Store
export {
  getPlaidItemStore,
  setPlaidItemStore,
  resetPlaidItemStore,
  InMemoryPlaidItemStore,
  SupabasePlaidItemStore,
  type PlaidItemStore,
} from './store.js';

// File Store (for CLI persistence)
export {
  FilePlaidItemStore,
  getFilePlaidItemStore,
  resetFilePlaidItemStore,
} from './file-store.js';

// Transactions
export {
  syncTransactions,
  syncAllTransactions,
  syncItemTransactions,
  getAccounts,
  getAccountBalances,
  getTransactionsByDateRange,
} from './transactions.js';

// Normalizer
export {
  normalizeTransaction,
  normalizeTransactions,
  mapAccountType,
  generatePlaidStatementId,
  generatePeriodLabel,
} from './normalizer.js';

// Category Mapper
export {
  mapPlaidCategory,
  getAllCategoryMappings,
  isCategoryMapped,
  type PlaidCategoryMapping,
} from './category-mapper.js';

// Retry and Rate Limiting
export {
  withRetry,
  withRateLimitAndRetry,
  createPlaidRetry,
  isRetryableError,
  calculateDelay,
  RateLimiter,
  getPlaidRateLimiter,
  resetPlaidRateLimiter,
  type RetryOptions,
} from './retry.js';

// Webhooks
export {
  handleWebhook,
  createWebhookHandler,
  verifyWebhookSignature,
  type WebhookType,
  type TransactionWebhookCode,
  type ItemWebhookCode,
  type PlaidWebhookPayload,
  type WebhookHandlerResult,
  type WebhookHandlers,
} from './webhooks.js';

// Reconciliation
export {
  reconcileTransactions,
  formatReconciliationReport,
  type ReconciliationMatch,
  type ReconciliationResult,
  type ReconcileOptions,
} from './reconcile.js';

// Identity (account owner verification)
export {
  getIdentity,
  formatIdentityReport,
  type IdentityAddress,
  type IdentityEmail,
  type IdentityPhone,
  type IdentityOwner,
  type AccountIdentity,
  type IdentityResult,
} from './identity.js';

// Auth (ACH routing/account numbers)
export {
  getAuth,
  formatAuthReport,
  type ACHNumbers,
  type EFTNumbers,
  type InternationalNumbers,
  type BACSNumbers,
  type AuthAccount,
  type AuthResult,
} from './auth.js';

// Liabilities (credit card/loan balances)
export {
  getLiabilities,
  formatLiabilitiesReport,
  type CreditCardLiability,
  type MortgageLiability,
  type StudentLoanLiability,
  type LiabilitiesAccount,
  type LiabilitiesResult,
} from './liabilities.js';

// Investments (portfolio tracking)
export {
  getHoldings,
  getInvestmentTransactions,
  formatHoldingsReport,
  type Security,
  type Holding,
  type InvestmentTransaction,
  type InvestmentAccount,
  type HoldingsResult,
  type InvestmentTransactionsResult,
} from './investments.js';

// Link Server (browser-based OAuth flow for production)
export {
  startLinkServer,
  type LinkServerOptions,
  type LinkServerResult,
} from './link-server.js';

// Merge (Plaid → result.json enrichment)
export {
  mergePlaidData,
  formatMergeReport,
  type ResultJson,
  type ResultAccount,
  type ResultTransaction,
  type PlaidEnrichment,
  type MergeResult,
  type MergeStats,
} from './merge.js';

// Unified Sync Service
export {
  PlaidSyncService,
  createSyncService,
  type SyncServiceConfig,
  type ScheduledSyncConfig,
  type ScheduledSyncStatus,
  type SyncPhase,
  type SyncProgressEvent,
  type SyncResult,
  type SyncStatus,
} from './sync-service.js';

// Unified Sync Pipeline (multi-PDF + Supabase + Plaid → v2)
export {
  runUnifiedSync,
  scanAndParsePdfs,
  type UnifiedSyncOptions,
  type UnifiedSyncResult,
  type AccountKey,
  type DateRange,
  type AccountCoverage,
  type ParsedPdfFile,
} from './unified-sync.js';
