/**
 * Reconciliation tooling for comparing PDF-derived statements against Plaid data.
 * Matches transactions by amount, date, and merchant similarity.
 */

import type { PlaidTransaction } from './types.js';

/**
 * Minimal transaction interface for reconciliation.
 * Works with both full Transaction type and parsed statement transactions.
 */
export interface ReconcilableTransaction {
  transactionId?: string;
  date: string;
  amount: number;
  description: string;
  merchant?: string | { name: string | null } | null;
}

export interface ReconciliationMatch {
  pdfTransaction: ReconcilableTransaction;
  plaidTransaction: PlaidTransaction;
  confidence: number;
  matchType: 'exact' | 'fuzzy' | 'amount_date' | 'amount_only';
  differences: string[];
}

export interface ReconciliationResult {
  matched: ReconciliationMatch[];
  unmatchedPdf: ReconcilableTransaction[];
  unmatchedPlaid: PlaidTransaction[];
  summary: {
    totalPdf: number;
    totalPlaid: number;
    matchedCount: number;
    unmatchedPdfCount: number;
    unmatchedPlaidCount: number;
    matchRate: number;
    totalPdfAmount: number;
    totalPlaidAmount: number;
    amountDifference: number;
  };
}

export interface ReconcileOptions {
  dateToleranceDays?: number;
  amountTolerancePercent?: number;
  merchantSimilarityThreshold?: number;
}

const DEFAULT_OPTIONS: Required<ReconcileOptions> = {
  dateToleranceDays: 3,
  amountTolerancePercent: 0.01, // 1%
  merchantSimilarityThreshold: 0.6,
};

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    const row = matrix[0];
    if (row !== undefined) {
      row[j] = j;
    }
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const currentRow = matrix[i];
      const prevRow = matrix[i - 1];
      if (currentRow === undefined || prevRow === undefined) continue;

      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        currentRow[j] = prevRow[j - 1] ?? 0;
      } else {
        const diag = prevRow[j - 1] ?? 0;
        const left = currentRow[j - 1] ?? 0;
        const up = prevRow[j] ?? 0;
        currentRow[j] = Math.min(diag + 1, left + 1, up + 1);
      }
    }
  }

  const lastRow = matrix[b.length];
  return lastRow !== undefined ? (lastRow[a.length] ?? 0) : 0;
}

/**
 * Calculate string similarity (0-1) using Levenshtein distance.
 */
function stringSimilarity(a: string, b: string): number {
  const normalizedA = a.toLowerCase().trim();
  const normalizedB = b.toLowerCase().trim();

  if (normalizedA === normalizedB) return 1;
  if (normalizedA.length === 0 || normalizedB.length === 0) return 0;

  const distance = levenshteinDistance(normalizedA, normalizedB);
  const maxLength = Math.max(normalizedA.length, normalizedB.length);

  return 1 - distance / maxLength;
}

/**
 * Check if two dates are within tolerance.
 */
function datesMatch(date1: string, date2: string, toleranceDays: number): boolean {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffMs = Math.abs(d1.getTime() - d2.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= toleranceDays;
}

/**
 * Check if two amounts are within tolerance.
 */
function amountsMatch(
  amount1: number,
  amount2: number,
  tolerancePercent: number
): boolean {
  if (amount1 === amount2) return true;
  if (amount1 === 0 || amount2 === 0) return amount1 === amount2;

  const diff = Math.abs(amount1 - amount2);
  const avg = (Math.abs(amount1) + Math.abs(amount2)) / 2;
  return diff / avg <= tolerancePercent;
}

/**
 * Get merchant name from PDF transaction.
 */
function getPdfMerchant(tx: ReconcilableTransaction): string {
  if (tx.merchant === undefined || tx.merchant === null) {
    return tx.description;
  }
  if (typeof tx.merchant === 'string') {
    return tx.merchant;
  }
  return tx.merchant.name ?? tx.description;
}

/**
 * Get merchant name from Plaid transaction.
 */
function getPlaidMerchant(tx: PlaidTransaction): string {
  return tx.merchantName ?? tx.name;
}

/**
 * Calculate match confidence between PDF and Plaid transactions.
 */
function calculateMatchConfidence(
  pdfTx: ReconcilableTransaction,
  plaidTx: PlaidTransaction,
  options: Required<ReconcileOptions>
): { confidence: number; matchType: ReconciliationMatch['matchType']; differences: string[] } {
  const differences: string[] = [];
  let confidence = 0;

  // Amount comparison (Plaid amounts are positive for debits)
  const pdfAmount = pdfTx.amount;
  const plaidAmount = Math.abs(plaidTx.amount);

  const exactAmountMatch = pdfAmount === plaidAmount;
  const fuzzyAmountMatch = amountsMatch(pdfAmount, plaidAmount, options.amountTolerancePercent);

  if (exactAmountMatch) {
    confidence += 0.4;
  } else if (fuzzyAmountMatch) {
    confidence += 0.3;
    differences.push(`Amount: PDF=$${pdfAmount.toFixed(2)}, Plaid=$${plaidAmount.toFixed(2)}`);
  } else {
    differences.push(`Amount mismatch: PDF=$${pdfAmount.toFixed(2)}, Plaid=$${plaidAmount.toFixed(2)}`);
  }

  // Date comparison
  const exactDateMatch = pdfTx.date === plaidTx.date;
  const fuzzyDateMatch = datesMatch(pdfTx.date, plaidTx.date, options.dateToleranceDays);

  if (exactDateMatch) {
    confidence += 0.3;
  } else if (fuzzyDateMatch) {
    confidence += 0.2;
    differences.push(`Date: PDF=${pdfTx.date}, Plaid=${plaidTx.date}`);
  } else {
    differences.push(`Date mismatch: PDF=${pdfTx.date}, Plaid=${plaidTx.date}`);
  }

  // Merchant comparison
  const pdfMerchant = getPdfMerchant(pdfTx);
  const plaidMerchant = getPlaidMerchant(plaidTx);
  const merchantSimilarity = stringSimilarity(pdfMerchant, plaidMerchant);

  if (merchantSimilarity >= 0.9) {
    confidence += 0.3;
  } else if (merchantSimilarity >= options.merchantSimilarityThreshold) {
    confidence += 0.2;
    differences.push(`Merchant: PDF="${pdfMerchant}", Plaid="${plaidMerchant}"`);
  } else {
    differences.push(`Merchant mismatch: PDF="${pdfMerchant}", Plaid="${plaidMerchant}"`);
  }

  // Determine match type
  let matchType: ReconciliationMatch['matchType'];
  if (exactAmountMatch && exactDateMatch && merchantSimilarity >= 0.9) {
    matchType = 'exact';
  } else if (fuzzyAmountMatch && fuzzyDateMatch && merchantSimilarity >= options.merchantSimilarityThreshold) {
    matchType = 'fuzzy';
  } else if (fuzzyAmountMatch && fuzzyDateMatch) {
    matchType = 'amount_date';
  } else {
    matchType = 'amount_only';
  }

  return { confidence, matchType, differences };
}

/**
 * Find the best Plaid match for a PDF transaction.
 */
function findBestMatch(
  pdfTx: ReconcilableTransaction,
  plaidTransactions: PlaidTransaction[],
  usedPlaidIds: Set<string>,
  options: Required<ReconcileOptions>
): ReconciliationMatch | null {
  let bestMatch: ReconciliationMatch | null = null;
  let bestConfidence = 0;

  for (const plaidTx of plaidTransactions) {
    if (usedPlaidIds.has(plaidTx.transactionId)) continue;

    const { confidence, matchType, differences } = calculateMatchConfidence(pdfTx, plaidTx, options);

    // Minimum threshold for a match
    if (confidence >= 0.5 && confidence > bestConfidence) {
      bestConfidence = confidence;
      bestMatch = {
        pdfTransaction: pdfTx,
        plaidTransaction: plaidTx,
        confidence,
        matchType,
        differences,
      };
    }
  }

  return bestMatch;
}

/**
 * Reconcile PDF transactions against Plaid transactions.
 */
export function reconcileTransactions(
  pdfTransactions: ReconcilableTransaction[],
  plaidTransactions: PlaidTransaction[],
  options: ReconcileOptions = {}
): ReconciliationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const matched: ReconciliationMatch[] = [];
  const usedPlaidIds = new Set<string>();
  const unmatchedPdf: ReconcilableTransaction[] = [];

  // Sort by date for better matching
  const sortedPdf = [...pdfTransactions].sort((a, b) => a.date.localeCompare(b.date));
  const sortedPlaid = [...plaidTransactions].sort((a, b) => a.date.localeCompare(b.date));

  // First pass: find exact matches
  for (const pdfTx of sortedPdf) {
    const match = findBestMatch(pdfTx, sortedPlaid, usedPlaidIds, opts);

    if (match !== null && match.matchType === 'exact') {
      matched.push(match);
      usedPlaidIds.add(match.plaidTransaction.transactionId);
    }
  }

  // Second pass: find fuzzy matches for remaining
  const matchedPdfIds = new Set(matched.map((m) => m.pdfTransaction.transactionId));

  for (const pdfTx of sortedPdf) {
    if (matchedPdfIds.has(pdfTx.transactionId)) continue;

    const match = findBestMatch(pdfTx, sortedPlaid, usedPlaidIds, opts);

    if (match !== null) {
      matched.push(match);
      usedPlaidIds.add(match.plaidTransaction.transactionId);
      matchedPdfIds.add(pdfTx.transactionId);
    } else {
      unmatchedPdf.push(pdfTx);
    }
  }

  // Find unmatched Plaid transactions
  const unmatchedPlaid = sortedPlaid.filter((tx) => !usedPlaidIds.has(tx.transactionId));

  // Calculate summary
  const totalPdfAmount = pdfTransactions.reduce((sum, tx) => sum + tx.amount, 0);
  const totalPlaidAmount = plaidTransactions.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  return {
    matched,
    unmatchedPdf,
    unmatchedPlaid,
    summary: {
      totalPdf: pdfTransactions.length,
      totalPlaid: plaidTransactions.length,
      matchedCount: matched.length,
      unmatchedPdfCount: unmatchedPdf.length,
      unmatchedPlaidCount: unmatchedPlaid.length,
      matchRate: pdfTransactions.length > 0 ? matched.length / pdfTransactions.length : 0,
      totalPdfAmount,
      totalPlaidAmount,
      amountDifference: totalPdfAmount - totalPlaidAmount,
    },
  };
}

/**
 * Format reconciliation result as a human-readable report.
 */
export function formatReconciliationReport(result: ReconciliationResult): string {
  const lines: string[] = [];

  lines.push('=== Reconciliation Report ===');
  lines.push('');
  lines.push('Summary:');
  lines.push(`  PDF Transactions:     ${result.summary.totalPdf}`);
  lines.push(`  Plaid Transactions:   ${result.summary.totalPlaid}`);
  lines.push(`  Matched:              ${result.summary.matchedCount}`);
  lines.push(`  Unmatched (PDF):      ${result.summary.unmatchedPdfCount}`);
  lines.push(`  Unmatched (Plaid):    ${result.summary.unmatchedPlaidCount}`);
  lines.push(`  Match Rate:           ${(result.summary.matchRate * 100).toFixed(1)}%`);
  lines.push('');
  lines.push('Amounts:');
  lines.push(`  PDF Total:            $${result.summary.totalPdfAmount.toFixed(2)}`);
  lines.push(`  Plaid Total:          $${result.summary.totalPlaidAmount.toFixed(2)}`);
  lines.push(`  Difference:           $${result.summary.amountDifference.toFixed(2)}`);

  if (result.matched.length > 0) {
    lines.push('');
    lines.push('Matched Transactions:');
    for (const match of result.matched.slice(0, 10)) {
      lines.push(`  [${match.matchType}] ${match.confidence.toFixed(2)} - $${match.pdfTransaction.amount.toFixed(2)} ${getPdfMerchant(match.pdfTransaction)}`);
      if (match.differences.length > 0) {
        lines.push(`    Differences: ${match.differences.join('; ')}`);
      }
    }
    if (result.matched.length > 10) {
      lines.push(`  ... and ${result.matched.length - 10} more`);
    }
  }

  if (result.unmatchedPdf.length > 0) {
    lines.push('');
    lines.push('Unmatched PDF Transactions:');
    for (const tx of result.unmatchedPdf.slice(0, 10)) {
      lines.push(`  ${tx.date} $${tx.amount.toFixed(2)} ${getPdfMerchant(tx)}`);
    }
    if (result.unmatchedPdf.length > 10) {
      lines.push(`  ... and ${result.unmatchedPdf.length - 10} more`);
    }
  }

  if (result.unmatchedPlaid.length > 0) {
    lines.push('');
    lines.push('Unmatched Plaid Transactions:');
    for (const tx of result.unmatchedPlaid.slice(0, 10)) {
      lines.push(`  ${tx.date} $${Math.abs(tx.amount).toFixed(2)} ${getPlaidMerchant(tx)}`);
    }
    if (result.unmatchedPlaid.length > 10) {
      lines.push(`  ... and ${result.unmatchedPlaid.length - 10} more`);
    }
  }

  return lines.join('\n');
}
