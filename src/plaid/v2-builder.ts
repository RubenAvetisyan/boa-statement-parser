/**
 * Build a schema-valid v2 result from transaction-details PDF + Plaid data.
 *
 * This module bridges the gap when only a "Print Transaction Details" PDF is available
 * (no monthly statements). It synthesizes the missing fields (balances, analytics,
 * integrity) from the PDF data + Plaid account metadata, producing output that
 * validates against final_result.v2.schema.json.
 */

import type { ParsedStatement, Transaction } from '../schemas/index.js';
import type { RawTransaction, AccountInfo, BalanceInfo } from '../parsers/boa/types.js';
import type { PlaidTransaction, PlaidAccount } from './types.js';
import type { ReconciliationResult, ReconciliationMatch } from './reconcile.js';
import type { FinalResultV2 } from '../output/adapters.js';
import { toFinalResultV2, type CanonicalOutput } from '../output/adapters.js';
import { categorizeTransaction } from '../categorization/categorizer.js';

const PARSER_VERSION = '1.4.1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseAmountValue(raw: string): number {
  return Math.abs(parseFloat(raw.replace(/[,$]/g, '')));
}

function inferDirection(section: string | undefined, amountStr: string): 'debit' | 'credit' {
  const isNegative = amountStr.includes('-');
  if (section === 'deposits') return 'credit';
  if (section === 'withdrawals' || section === 'checks' || section === 'fees') return 'debit';
  return isNegative ? 'debit' : 'credit';
}

function extractMerchantFromDescription(description: string): string {
  // Strip date patterns like "01/28" and common prefixes
  let merchant = description
    .replace(/\d{2}\/\d{2}\s*/g, '')
    .replace(/^(PURCHASE|CHECKCARD|ATM|ACH|ONLINE\s+BANKING)\s*/i, '')
    .replace(/\s+(PURCHASE|WITHDRAWAL|DEPOSIT)\s*/gi, ' ')
    .replace(/\s+[A-Z]{2}\s+XXXXX\d+X+\d+.*$/i, '') // card number suffix
    .replace(/\s+Conf#\s+\S+/i, '') // Zelle confirmation
    .replace(/\s+RECURRING$/i, '')
    .trim();

  // Take first meaningful segment
  const parts = merchant.split(/\s{2,}/);
  merchant = parts[0] ?? merchant;

  return merchant || 'Unknown';
}

// ─── Core: RawTransaction[] → ParsedStatement ────────────────────────────────

/**
 * Convert transaction-details parser output into a canonical ParsedStatement
 * that can be fed through the existing v2 pipeline.
 */
export function transactionDetailsToParsedStatement(
  accountInfo: AccountInfo,
  balanceInfo: BalanceInfo,
  rawTransactions: RawTransaction[],
  warnings: string[]
): ParsedStatement {
  let totalCredits = 0;
  let totalDebits = 0;

  const transactions: Transaction[] = rawTransactions.map((raw) => {
    const amount = parseAmountValue(raw.amount);
    const direction = inferDirection(raw.section, raw.amount);

    if (direction === 'credit') {
      totalCredits += amount;
    } else {
      totalDebits += amount;
    }

    const signedAmount = direction === 'debit' ? -amount : amount;

    const catResult = categorizeTransaction(raw.description);

    return {
      date: raw.date,
      postedDate: raw.date,
      description: raw.description,
      merchant: extractMerchantFromDescription(raw.description),
      amount: signedAmount,
      direction,
      category: catResult.category,
      subcategory: catResult.subcategory,
      confidence: catResult.confidence,
      raw: {
        originalText: raw.originalLine,
        page: raw.page,
      },
    };
  });

  // Compute starting balance: endingBalance - totalCredits + totalDebits
  const startingBalance = balanceInfo.endingBalance > 0
    ? balanceInfo.endingBalance - totalCredits + totalDebits
    : 0;

  return {
    account: {
      institution: 'Bank of America',
      accountType: accountInfo.accountType,
      accountNumberMasked: accountInfo.accountNumberMasked,
      statementPeriod: {
        start: accountInfo.statementPeriodStart,
        end: accountInfo.statementPeriodEnd,
      },
      currency: 'USD',
    },
    summary: {
      startingBalance,
      endingBalance: balanceInfo.endingBalance,
      totalCredits,
      totalDebits,
    },
    transactions,
    metadata: {
      parserVersion: PARSER_VERSION,
      parsedAt: new Date().toISOString(),
      warnings,
    },
  };
}

// ─── Plaid Match Enrichment ──────────────────────────────────────────────────

interface PlaidMatchInfo {
  plaidTransactionId: string;
  matchConfidence: number;
  matchType: 'exact' | 'fuzzy' | 'amount_date' | 'amount_only';
  merchantName?: string;
  location?: {
    city?: string;
    state?: string;
    country?: string;
  };
  personalFinanceCategory?: {
    primary: string;
    detailed: string;
  };
  differences: string[];
}

function buildPlaidMatch(match: ReconciliationMatch): PlaidMatchInfo {
  const plaidTx = match.plaidTransaction;
  const result: PlaidMatchInfo = {
    plaidTransactionId: plaidTx.transactionId,
    matchConfidence: match.confidence,
    matchType: match.matchType as PlaidMatchInfo['matchType'],
    differences: match.differences,
  };

  if (plaidTx.merchantName !== undefined && plaidTx.merchantName !== null) {
    result.merchantName = plaidTx.merchantName;
  }

  if (plaidTx.location !== undefined) {
    const loc: { city?: string; state?: string; country?: string } = {};
    if (plaidTx.location.city) loc.city = plaidTx.location.city;
    if (plaidTx.location.region) loc.state = plaidTx.location.region;
    if (plaidTx.location.country) loc.country = plaidTx.location.country;
    if (Object.keys(loc).length > 0) result.location = loc;
  }

  if (plaidTx.personalFinanceCategory !== undefined) {
    result.personalFinanceCategory = {
      primary: plaidTx.personalFinanceCategory.primary,
      detailed: plaidTx.personalFinanceCategory.detailed,
    };
  }

  return result;
}

// ─── Reconciliation Summary ──────────────────────────────────────────────────

interface ReconciliationSummary {
  matched: number;
  unmatchedPdf: number;
  unmatchedPlaid: number;
  matchRate: number;
  totalPdfAmount: number;
  totalPlaidAmount: number;
  amountDifference: number;
  matchBreakdown: {
    exact: number;
    fuzzy: number;
    amountDate: number;
    amountOnly: number;
  };
}

function buildReconciliationSummary(reconciliation: ReconciliationResult): ReconciliationSummary {
  const breakdown = { exact: 0, fuzzy: 0, amountDate: 0, amountOnly: 0 };
  for (const m of reconciliation.matched) {
    switch (m.matchType) {
      case 'exact': breakdown.exact++; break;
      case 'fuzzy': breakdown.fuzzy++; break;
      case 'amount_date': breakdown.amountDate++; break;
      case 'amount_only': breakdown.amountOnly++; break;
    }
  }

  return {
    matched: reconciliation.summary.matchedCount,
    unmatchedPdf: reconciliation.summary.unmatchedPdfCount,
    unmatchedPlaid: reconciliation.summary.unmatchedPlaidCount,
    matchRate: reconciliation.summary.matchRate,
    totalPdfAmount: reconciliation.summary.totalPdfAmount,
    totalPlaidAmount: reconciliation.summary.totalPlaidAmount,
    amountDifference: reconciliation.summary.amountDifference,
    matchBreakdown: breakdown,
  };
}

// ─── Data Sources ────────────────────────────────────────────────────────────

interface DataSources {
  pdf: {
    files: string[];
    transactionCount: number;
    parseDate: string;
  };
  plaid: {
    itemId: string;
    institutionName: string;
    transactionCount: number;
    syncDate: string;
  };
}

// ─── Main Builder ────────────────────────────────────────────────────────────

export interface BuildV2Options {
  pdfPath: string;
  itemId: string;
  institutionName: string;
}

/**
 * Build a complete schema-valid v2 result from:
 * - Transaction-details PDF parse output
 * - Plaid reconciliation result
 * - Plaid account metadata
 */
export function buildV2FromTransactionDetails(
  parsedStatement: ParsedStatement,
  reconciliation: ReconciliationResult,
  plaidAccounts: PlaidAccount[],
  plaidTransactions: PlaidTransaction[],
  opts: BuildV2Options
): Record<string, unknown> {
  // Step 1: Build canonical output and run through existing v2 pipeline
  const canonical: CanonicalOutput = {
    statements: [parsedStatement],
    totalStatements: 1,
    totalTransactions: parsedStatement.transactions.length,
  };

  const v2Base: FinalResultV2 = toFinalResultV2(canonical);

  // Step 2: Build a match index: PDF description+date+amount → PlaidMatch
  const matchIndex = new Map<string, ReconciliationMatch>();
  for (const m of reconciliation.matched) {
    const key = `${m.pdfTransaction.date}|${m.pdfTransaction.amount.toFixed(2)}|${m.pdfTransaction.description}`;
    matchIndex.set(key, m);
  }

  // Step 3: Enrich transactions with plaidMatch
  const enrichedAccounts = v2Base.accounts.map((account) => ({
    ...account,
    transactions: account.transactions.map((tx) => {
      const key = `${tx.date}|${Math.abs(tx.amount).toFixed(2)}|${tx.description}`;
      const match = matchIndex.get(key);
      if (match !== undefined) {
        return {
          ...tx,
          plaidMatch: buildPlaidMatch(match),
        };
      }
      return tx;
    }),
  }));

  // Step 4: Build dataSources
  const dataSources: DataSources = {
    pdf: {
      files: [opts.pdfPath],
      transactionCount: parsedStatement.transactions.length,
      parseDate: new Date().toISOString(),
    },
    plaid: {
      itemId: opts.itemId,
      institutionName: opts.institutionName,
      transactionCount: plaidTransactions.length,
      syncDate: new Date().toISOString(),
    },
  };

  // Step 5: Build reconciliation summary
  const reconciliationSummary = buildReconciliationSummary(reconciliation);

  // Step 6: Assemble final v2 output
  return {
    schemaVersion: 'v2',
    startingBalance: v2Base.startingBalance,
    endingBalance: v2Base.endingBalance,
    totalStatements: v2Base.totalStatements,
    totalTransactions: v2Base.totalTransactions,
    accounts: enrichedAccounts,
    analytics: v2Base.analytics,
    integrity: v2Base.integrity,
    dataSources,
    reconciliation: reconciliationSummary,
  };
}
