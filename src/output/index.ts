/**
 * Output module - handles conversion of parsed data to various output formats.
 */

export {
  toFinalResultV1,
  toFinalResultV2,
  toFinalResult,
  type CanonicalOutput,
  type FinalResultV1,
  type FinalResultV2,
} from './adapters.js';

export {
  generateAnalytics,
  calculateQuarterlyCashFlow,
  calculateIncomeVsExpenses,
  calculateLenderSummary,
  calculateTaxPreparation,
  type AnalyticsResult,
  type QuarterlyCashFlow,
  type IncomeVsExpenses,
  type LenderSummary,
  type TaxPreparation,
  type TaxCategorySummary,
} from './analytics.js';

export {
  checkIntegrity,
  checkStatementIntegrity,
  addTraceability,
  DEFAULT_EPSILON,
  type IntegrityCheckResult,
  type StatementIntegrityResult,
  type BalanceDiscrepancy,
} from './integrity.js';

export {
  exportOfx,
  exportAccountOfx,
  exportOfxByAccount,
  type OfxExportOptions,
  type SplitOfxResult,
} from './ofx-exporter.js';

export {
  exportCsv,
  exportAccountCsv,
  exportCsvByAccount,
  type CsvExportOptions,
  type SplitCsvResult,
} from './csv-exporter.js';
