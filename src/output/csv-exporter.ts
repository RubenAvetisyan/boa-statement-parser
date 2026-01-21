/**
 * CSV Exporter Module
 * 
 * Converts v2 rollup output to CSV format for spreadsheet import.
 */

import type { FinalResultV2 } from './adapters.js';

/**
 * Options for CSV export
 */
export interface CsvExportOptions {
  /** Include header row (default: true) */
  includeHeader?: boolean;
  /** Field delimiter (default: ',') */
  delimiter?: string;
  /** Include account info columns (default: true) */
  includeAccountInfo?: boolean;
  /** Include category columns (default: true) */
  includeCategories?: boolean;
  /** Include raw/debug columns (default: false) */
  includeRaw?: boolean;
  /** Date format: 'iso' (YYYY-MM-DD) or 'us' (MM/DD/YYYY) (default: 'iso') */
  dateFormat?: 'iso' | 'us';
}

/**
 * CSV column definitions
 */
const BASE_COLUMNS = [
  'Date',
  'Posted Date',
  'Description',
  'Merchant',
  'Amount',
  'Direction',
  'Type',
] as const;

const ACCOUNT_COLUMNS = [
  'Account Type',
  'Account Number',
] as const;

const CATEGORY_COLUMNS = [
  'Category',
  'Subcategory',
  'Confidence',
] as const;

const RAW_COLUMNS = [
  'Transaction ID',
  'Statement ID',
  'Period Label',
  'Original Text',
  'Page',
] as const;

/**
 * Escape a value for CSV (handles quotes and delimiters)
 */
function escapeCsvValue(value: string | number | null | undefined, delimiter: string): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  const str = String(value);
  
  // Check if escaping is needed
  const needsQuoting = str.includes(delimiter) || 
                       str.includes('"') || 
                       str.includes('\n') || 
                       str.includes('\r');
  
  if (needsQuoting) {
    // Escape quotes by doubling them and wrap in quotes
    return `"${str.replace(/"/g, '""')}"`;
  }
  
  return str;
}

/**
 * Format a date string based on format option
 */
function formatDate(isoDate: string | null, format: 'iso' | 'us'): string {
  if (isoDate === null || isoDate === '') {
    return '';
  }
  
  if (format === 'us') {
    // Convert YYYY-MM-DD to MM/DD/YYYY
    const parts = isoDate.split('-');
    if (parts.length === 3) {
      return `${parts[1]}/${parts[2]}/${parts[0]}`;
    }
  }
  
  return isoDate;
}

/**
 * Format amount with sign based on direction
 */
function formatAmount(amount: number, direction: 'credit' | 'debit'): string {
  const absAmount = Math.abs(amount);
  const signedAmount = direction === 'credit' ? absAmount : -absAmount;
  return signedAmount.toFixed(2);
}

/**
 * Determine transaction type from description
 */
function getTransactionType(description: string, direction: 'credit' | 'debit'): string {
  const desc = description.toUpperCase();
  
  if (desc.includes('CHECK') && desc.match(/\d+/)) {
    return 'Check';
  }
  if (desc.includes('ATM')) {
    return 'ATM';
  }
  if (desc.includes('ZELLE') || desc.includes('TRANSFER') || desc.includes('XFER') || desc.includes('WIRE')) {
    return 'Transfer';
  }
  if (desc.includes('DEPOSIT') || desc.includes('DIRECT DEP') || desc.includes('PAYROLL')) {
    return 'Deposit';
  }
  if (desc.includes('FEE') || desc.includes('SERVICE CHARGE')) {
    return 'Fee';
  }
  if (desc.includes('INTEREST')) {
    return 'Interest';
  }
  if (desc.includes('CHECKCARD') || desc.includes('PURCHASE') || desc.includes('POS')) {
    return 'Purchase';
  }
  if (desc.includes('PAYMENT') || desc.includes('BILL PAY') || desc.includes('ACH')) {
    return 'Payment';
  }
  
  return direction === 'credit' ? 'Credit' : 'Debit';
}

/**
 * Build header row based on options
 */
function buildHeaderRow(options: Required<CsvExportOptions>): string[] {
  const headers: string[] = [...BASE_COLUMNS];
  
  if (options.includeAccountInfo) {
    headers.push(...ACCOUNT_COLUMNS);
  }
  
  if (options.includeCategories) {
    headers.push(...CATEGORY_COLUMNS);
  }
  
  if (options.includeRaw) {
    headers.push(...RAW_COLUMNS);
  }
  
  return headers;
}

/**
 * Build a data row for a transaction
 */
function buildDataRow(
  txn: FinalResultV2['accounts'][number]['transactions'][number],
  account: FinalResultV2['accounts'][number]['account'],
  options: Required<CsvExportOptions>
): string[] {
  const row: string[] = [
    formatDate(txn.date, options.dateFormat),
    formatDate(txn.postedDate, options.dateFormat),
    txn.description,
    txn.merchant,
    formatAmount(txn.amount, txn.direction),
    txn.direction,
    getTransactionType(txn.description, txn.direction),
  ];
  
  if (options.includeAccountInfo) {
    row.push(
      account.accountType,
      account.accountNumberMasked,
    );
  }
  
  if (options.includeCategories) {
    row.push(
      txn.category,
      txn.subcategory ?? '',
      txn.confidence.toFixed(2),
    );
  }
  
  if (options.includeRaw) {
    row.push(
      txn.transactionId,
      txn.statementId,
      txn.periodLabel,
      txn.raw.originalText,
      String(txn.raw.page),
    );
  }
  
  return row;
}

/**
 * Convert a row array to CSV line
 */
function rowToCsvLine(row: string[], delimiter: string): string {
  return row.map(value => escapeCsvValue(value, delimiter)).join(delimiter);
}

/**
 * Export v2 rollup to CSV format.
 * 
 * @param v2Result - The v2 rollup result to export
 * @param options - Export options
 * @returns CSV text string
 */
export function exportCsv(
  v2Result: FinalResultV2,
  options: CsvExportOptions = {}
): string {
  const opts: Required<CsvExportOptions> = {
    includeHeader: options.includeHeader ?? true,
    delimiter: options.delimiter ?? ',',
    includeAccountInfo: options.includeAccountInfo ?? true,
    includeCategories: options.includeCategories ?? true,
    includeRaw: options.includeRaw ?? false,
    dateFormat: options.dateFormat ?? 'iso',
  };
  
  const lines: string[] = [];
  
  // Add header row
  if (opts.includeHeader) {
    const headers = buildHeaderRow(opts);
    lines.push(rowToCsvLine(headers, opts.delimiter));
  }
  
  // Collect all transactions from all accounts, sorted by date
  const allTransactions: Array<{
    txn: FinalResultV2['accounts'][number]['transactions'][number];
    account: FinalResultV2['accounts'][number]['account'];
  }> = [];
  
  for (const accountBlock of v2Result.accounts) {
    for (const txn of accountBlock.transactions) {
      allTransactions.push({
        txn,
        account: accountBlock.account,
      });
    }
  }
  
  // Sort by date, then by transaction ID for stability
  allTransactions.sort((a, b) => {
    const dateCompare = a.txn.date.localeCompare(b.txn.date);
    if (dateCompare !== 0) return dateCompare;
    return a.txn.transactionId.localeCompare(b.txn.transactionId);
  });
  
  // Add data rows
  for (const { txn, account } of allTransactions) {
    const row = buildDataRow(txn, account, opts);
    lines.push(rowToCsvLine(row, opts.delimiter));
  }
  
  return lines.join('\n');
}

/**
 * Export a single account block to CSV format.
 * 
 * @param accountBlock - Single account block from v2 result
 * @param options - Export options
 * @returns CSV text string
 */
export function exportAccountCsv(
  accountBlock: FinalResultV2['accounts'][number],
  options: CsvExportOptions = {}
): string {
  const opts: Required<CsvExportOptions> = {
    includeHeader: options.includeHeader ?? true,
    delimiter: options.delimiter ?? ',',
    includeAccountInfo: options.includeAccountInfo ?? true,
    includeCategories: options.includeCategories ?? true,
    includeRaw: options.includeRaw ?? false,
    dateFormat: options.dateFormat ?? 'iso',
  };
  
  const lines: string[] = [];
  
  // Add header row
  if (opts.includeHeader) {
    const headers = buildHeaderRow(opts);
    lines.push(rowToCsvLine(headers, opts.delimiter));
  }
  
  // Sort transactions by date
  const sortedTransactions = [...accountBlock.transactions].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.transactionId.localeCompare(b.transactionId);
  });
  
  // Add data rows
  for (const txn of sortedTransactions) {
    const row = buildDataRow(txn, accountBlock.account, opts);
    lines.push(rowToCsvLine(row, opts.delimiter));
  }
  
  return lines.join('\n');
}

/**
 * Result of split-by-account export
 */
export interface SplitCsvResult {
  /** Account type (e.g., 'checking', 'savings') */
  accountType: string;
  /** Last 4 digits of account number */
  accountLast4: string;
  /** Suggested filename (e.g., 'boa_checking_3529.csv') */
  filename: string;
  /** CSV content for this account */
  content: string;
}

/**
 * Export v2 rollup to separate CSV files per account.
 * 
 * @param v2Result - The v2 rollup result to export
 * @param options - Export options
 * @returns Array of split results, one per account
 */
export function exportCsvByAccount(
  v2Result: FinalResultV2,
  options: CsvExportOptions = {}
): SplitCsvResult[] {
  const results: SplitCsvResult[] = [];
  
  for (const account of v2Result.accounts) {
    const accountType = account.account.accountType.toLowerCase();
    const last4 = account.account.accountNumberMasked.replace(/\*/g, '').slice(-4);
    const filename = `boa_${accountType}_${last4}.csv`;
    const content = exportAccountCsv(account, options);
    
    results.push({
      accountType,
      accountLast4: last4,
      filename,
      content,
    });
  }
  
  return results;
}
