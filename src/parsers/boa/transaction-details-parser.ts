import type { ExtractedPDF, ExtractedPage } from '../../extractors/index.js';
import { parseUSDate } from '../../utils/date.js';
import { parseAmount } from '../../utils/money.js';
import type { RawTransaction, AccountInfo, BalanceInfo, TransactionSection } from './types.js';
import type { AccountType } from '../../schemas/index.js';

/**
 * Parser for BOA "Print Transaction Details" PDFs exported from Online Banking.
 * These are different from monthly statements - they are web page prints of account activity.
 * 
 * Format characteristics:
 * - Header: "Bank of America | Online Banking | Deposit | Print Transaction Details"
 * - Account line: "Adv Plus Banking - 3529 : Account Activity" or "Advantage Savings - 4971 : Account Activity"
 * - Balance line: "Balance Summary: $X,XXX.XX (available balance as of today MM/DD/YYYY)"
 * - Date range: "Showing results for "All Transactions, MM/DD/YYYY To MM/DD/YYYY""
 * - Transaction lines: "MM/DD/YYYY Description Type Amount"
 * - Continuation lines for location, confirmation numbers, etc.
 */

const TRANSACTION_DETAILS_PATTERNS = {
  // Detect this document type
  documentType: /Bank of America \| Online Banking \| Deposit \| Print Transaction Details/i,
  
  // Account info extraction (no ^ anchor since we search in full text)
  accountLine: /(Adv(?:antage)?\s+(?:Plus\s+Banking|Savings))\s*-\s*(\d{4})\s*:\s*Account Activity/i,
  balanceSummary: /Balance Summary:\s*\$?([\d,]+\.\d{2})\s*\(available balance as of today\s+(\d{2}\/\d{2}\/\d{4})\)/i,
  dateRange: /Showing results for "All Transactions,\s*(\d{2}\/\d{2}\/\d{4})\s*To\s*(\d{2}\/\d{2}\/\d{4})"/i,
  
  // Transaction line patterns
  // Format: MM/DD/YYYY Description Type Amount
  transactionLine: /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(Debit Card|Transfer|Other|Check|Deposit|Virtual Card|Bank Charge|Credit)\s+(-?\$?[\d,]+\.\d{2})$/i,
  
  // Alternative: some lines have Type embedded in description
  transactionLineAlt: /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?\$?[\d,]+\.\d{2})$/,
  
  // Lines to skip
  skipPatterns: [
    /^Cleared$/i,
    /^Pending$/i,
    /^Posting date/i,
    /^Transactions$/i,
    /^View:/i,
    /^https:\/\//i,
    /^\d+\/\d+$/,  // Page numbers like "1/5"
    /^\d{1,2}\/\d{1,2}\/\d{2},\s+\d{1,2}:\d{2}\s+[AP]M/i,  // Timestamp headers
  ],
  
  // Continuation line indicators (location, confirmation, etc.)
  continuationPatterns: [
    /^[A-Z]{2,}(?:\s+[A-Z]{2})?$/,  // "GLENDALE CA" or just "CA"
    /^Conf#\s+\S+/i,
    /^Confirmation#\s+\S+/i,
    /^ID:\S+/i,
    /^INDN:/i,
    /^DEPOSIT\s+/i,
    /^PURCHASE\s+/i,
    /^Payment$/i,
    /^Charge$/i,
    /^Card$/i,
  ],
};

/**
 * Detect if a PDF is a "Print Transaction Details" export.
 */
export function isTransactionDetailsPDF(pdf: ExtractedPDF): boolean {
  return TRANSACTION_DETAILS_PATTERNS.documentType.test(pdf.fullText);
}

/**
 * Parse a BOA "Print Transaction Details" PDF.
 */
export function parseTransactionDetails(pdf: ExtractedPDF): {
  accountInfo: AccountInfo;
  balanceInfo: BalanceInfo;
  transactions: RawTransaction[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const fullText = pdf.fullText;
  
  const accountInfo = extractAccountInfo(fullText, warnings);
  const balanceInfo = extractBalanceInfo(fullText, warnings);
  const transactions = extractTransactions(pdf.pages, warnings);
  
  return { accountInfo, balanceInfo, transactions, warnings };
}

function extractAccountInfo(text: string, warnings: string[]): AccountInfo {
  let accountType: AccountType = 'checking';
  let accountNumberMasked = '****0000';
  let statementPeriodStart = '';
  let statementPeriodEnd = '';
  
  // Extract account type and number from "Adv Plus Banking - 3529 : Account Activity"
  const accountMatch = TRANSACTION_DETAILS_PATTERNS.accountLine.exec(text);
  if (accountMatch?.[1] !== undefined && accountMatch[2] !== undefined) {
    const accountName = accountMatch[1].toLowerCase();
    if (accountName.includes('savings')) {
      accountType = 'savings';
    } else {
      accountType = 'checking';
    }
    accountNumberMasked = `****${accountMatch[2]}`;
  } else {
    warnings.push('Could not extract account info from transaction details PDF');
  }
  
  // Extract date range from "Showing results for "All Transactions, 02/01/2025 To 01/30/2026""
  const dateRangeMatch = TRANSACTION_DETAILS_PATTERNS.dateRange.exec(text);
  if (dateRangeMatch?.[1] !== undefined && dateRangeMatch[2] !== undefined) {
    statementPeriodStart = parseUSDate(dateRangeMatch[1]);
    statementPeriodEnd = parseUSDate(dateRangeMatch[2]);
  } else {
    warnings.push('Could not extract date range from transaction details PDF');
    // Default to current date
    const now = new Date();
    statementPeriodEnd = now.toISOString().split('T')[0] ?? '';
    const lastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    statementPeriodStart = lastYear.toISOString().split('T')[0] ?? '';
  }
  
  return {
    accountType,
    accountNumberMasked,
    statementPeriodStart,
    statementPeriodEnd,
  };
}

function extractBalanceInfo(text: string, warnings: string[]): BalanceInfo {
  let endingBalance = 0;
  
  // Extract current balance from "Balance Summary: $2,293.87 (available balance as of today 01/30/2026)"
  const balanceMatch = TRANSACTION_DETAILS_PATTERNS.balanceSummary.exec(text);
  if (balanceMatch?.[1] !== undefined) {
    endingBalance = parseAmount(balanceMatch[1]);
  } else {
    warnings.push('Could not extract balance from transaction details PDF');
  }
  
  // We don't have starting balance in this format - will calculate from transactions
  return {
    startingBalance: 0,
    endingBalance,
    totalCredits: 0,
    totalDebits: 0,
  };
}

function extractTransactions(pages: ExtractedPage[], warnings: string[]): RawTransaction[] {
  const transactions: RawTransaction[] = [];
  let pendingTransaction: RawTransaction | null = null;
  
  for (const page of pages) {
    for (let lineIndex = 0; lineIndex < page.lines.length; lineIndex++) {
      const line = page.lines[lineIndex]?.trim() ?? '';
      
      if (line === '') continue;
      
      // Skip known non-transaction lines
      if (shouldSkipLine(line)) continue;
      
      // Try to parse as a transaction line
      const txn = parseTransactionLine(line, page.pageNumber, lineIndex);
      
      if (txn !== null) {
        // Save any pending transaction
        if (pendingTransaction !== null) {
          transactions.push(pendingTransaction);
        }
        pendingTransaction = txn;
      } else if (pendingTransaction !== null && isContinuationLine(line)) {
        // Append continuation info to pending transaction
        pendingTransaction.description += ' ' + line;
        pendingTransaction.originalLine += ' | ' + line;
      }
    }
  }
  
  // Don't forget the last transaction
  if (pendingTransaction !== null) {
    transactions.push(pendingTransaction);
  }
  
  if (transactions.length === 0) {
    warnings.push('No transactions found in transaction details PDF');
  }
  
  return transactions;
}

function shouldSkipLine(line: string): boolean {
  for (const pattern of TRANSACTION_DETAILS_PATTERNS.skipPatterns) {
    if (pattern.test(line)) {
      return true;
    }
  }
  return false;
}

function isContinuationLine(line: string): boolean {
  // Check if this looks like a continuation of the previous transaction
  // (location, confirmation number, etc.)
  for (const pattern of TRANSACTION_DETAILS_PATTERNS.continuationPatterns) {
    if (pattern.test(line)) {
      return true;
    }
  }
  
  // Also check for lines that are just location (CITY STATE format)
  if (/^[A-Z][A-Za-z\s]+\s+[A-Z]{2}$/.test(line)) {
    return true;
  }
  
  // Lines that look like partial descriptions (no date, no amount)
  if (!/^\d{2}\/\d{2}\/\d{4}/.test(line) && !/\$[\d,]+\.\d{2}/.test(line)) {
    // Could be continuation if it's short and doesn't look like a header
    if (line.length < 50 && !/^(Posting|Transactions|View|Balance|Showing)/i.test(line)) {
      return true;
    }
  }
  
  return false;
}

function parseTransactionLine(
  line: string,
  pageNumber: number,
  lineIndex: number
): RawTransaction | null {
  // Try primary pattern: MM/DD/YYYY Description Type Amount
  let match = TRANSACTION_DETAILS_PATTERNS.transactionLine.exec(line);
  if (match !== null) {
    const [, dateStr, description, type, amountStr] = match;
    if (dateStr !== undefined && dateStr !== '' && 
        description !== undefined && description !== '' && 
        amountStr !== undefined && amountStr !== '') {
      return {
        date: parseUSDate(dateStr),
        description: cleanDescription(description, type ?? ''),
        amount: amountStr.replace('$', ''),
        page: pageNumber,
        lineIndex,
        originalLine: line,
        section: inferSection(type ?? '', amountStr),
      };
    }
  }
  
  // Try alternative pattern: MM/DD/YYYY Description Amount (type embedded in description)
  match = TRANSACTION_DETAILS_PATTERNS.transactionLineAlt.exec(line);
  if (match !== null) {
    const [, dateStr, description, amountStr] = match;
    if (dateStr !== undefined && dateStr !== '' && 
        description !== undefined && description !== '' && 
        amountStr !== undefined && amountStr !== '') {
      const inferredType = inferTypeFromDescription(description);
      return {
        date: parseUSDate(dateStr),
        description: cleanDescription(description, inferredType),
        amount: amountStr.replace('$', ''),
        page: pageNumber,
        lineIndex,
        originalLine: line,
        section: inferSection(inferredType, amountStr),
      };
    }
  }
  
  return null;
}

function cleanDescription(description: string, _type: string): string {
  // Remove redundant type info from description if present
  let cleaned = description.trim();
  
  // Remove trailing type indicators that might be in description
  cleaned = cleaned.replace(/\s+(Debit Card|Transfer|Other|Check|Deposit|Virtual Card|Bank Charge|Credit)\s*$/i, '');
  
  // Clean up common patterns
  cleaned = cleaned.replace(/\s+/g, ' ');
  
  return cleaned;
}

function inferTypeFromDescription(description: string): string {
  const desc = description.toLowerCase();
  
  if (desc.includes('debit card') || desc.includes('purchase')) {
    return 'Debit Card';
  }
  if (desc.includes('transfer') || desc.includes('zelle')) {
    return 'Transfer';
  }
  if (desc.includes('check ') || /check\s+\d+/i.test(description)) {
    return 'Check';
  }
  if (desc.includes('deposit') || desc.includes('atm')) {
    return 'Deposit';
  }
  if (desc.includes('fee') || desc.includes('charge')) {
    return 'Bank Charge';
  }
  if (desc.includes('virtual card')) {
    return 'Virtual Card';
  }
  
  return 'Other';
}

function inferSection(type: string, amountStr: string): TransactionSection {
  const isNegative = amountStr.includes('-');
  const typeLower = type.toLowerCase();
  
  if (typeLower.includes('fee') || typeLower.includes('charge')) {
    return 'fees';
  }
  if (typeLower === 'check') {
    return 'checks';
  }
  if (typeLower === 'deposit' || (!isNegative && typeLower === 'transfer')) {
    return 'deposits';
  }
  if (isNegative) {
    return 'withdrawals';
  }
  
  return 'other';
}
