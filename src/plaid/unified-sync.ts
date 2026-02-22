/**
 * Unified sync pipeline: multi-PDF + Supabase + Plaid → combined v2 result.
 *
 * Architecture: DATABASE IS THE SOURCE OF TRUTH.
 *
 * Pipeline stages:
 *   1. Scan folder for PDFs, parse each → upload to DB (upsert, dedup by transactionId)
 *   2. Query DB for date ranges per account (now includes freshly uploaded PDF data)
 *   3. Compute coverage gaps (DB ranges vs requested date range)
 *   4. Fill gaps from Plaid → upload to DB (upsert, dedup by transactionId)
 *   5. Read ALL transactions from DB for requested range → build v2 output
 */

import { readdirSync, existsSync } from 'fs';
import { join, resolve, basename } from 'path';
import type { ParsedStatement, Transaction } from '../schemas/index.js';
import type { PlaidTransaction, PlaidAccount, PlaidItem } from './types.js';
import type { ReconciliationResult } from './reconcile.js';
import type { FinalResultV2 } from '../output/adapters.js';
import { type FilePlaidItemStore, PlaidGapCache } from './file-store.js';
import { toFinalResultV2, type CanonicalOutput } from '../output/adapters.js';
import { transactionDetailsToParsedStatement } from './v2-builder.js';
import { reconcileTransactions, formatReconciliationReport } from './reconcile.js';
import { extractPDF } from '../extractors/index.js';
import { isTransactionDetailsPDF, parseTransactionDetails, parseBoaMultipleStatements } from '../parsers/boa/index.js';
import { syncItemTransactions, getAccounts as getPlaidAccounts, getTransactionsByDateRange, getEarliestTransactionDates } from './transactions.js';
import { normalizeTransaction, mapAccountType, generatePlaidStatementId } from './normalizer.js';
import { computeTransactionId, computeStatementId, computePeriodLabel } from '../utils/id-generator.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AccountKey {
  institution: string;
  accountType: string;
  accountNumberMasked: string;
}

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

export interface AccountCoverage {
  key: AccountKey;
  pdfRange: DateRange | null;
  supabaseRange: DateRange | null;
  plaidRange: DateRange | null;
  gaps: DateRange[];
  pdfTransactionCount: number;
  supabaseTransactionCount: number;
}

export interface ParsedPdfFile {
  filePath: string;
  fileName: string;
  accountKey: AccountKey;
  statement: ParsedStatement;
  transactionCount: number;
}

export interface UnifiedSyncOptions {
  inputDir?: string | undefined;
  store: FilePlaidItemStore;
  supabaseClient?: unknown | undefined; // SupabaseClient — optional
  userId?: string | undefined;
  startDate?: string | undefined; // YYYY-MM-DD — start of requested range
  endDate?: string | undefined;   // YYYY-MM-DD — end of requested range (defaults to today)
  verbose?: boolean | undefined;
  log?: ((msg: string) => void) | undefined;
}

export interface UnifiedSyncResult {
  v2Output: Record<string, unknown>;
  stats: {
    pdfFiles: number;
    accounts: number;
    pdfTransactions: number;
    plaidTransactions: number;
    plaidOnlyAdded: number;
    supabaseTransactions: number;
    matchedTransactions: number;
    totalTransactions: number;
    coverage: AccountCoverage[];
  };
  reconciliations: Map<string, ReconciliationResult>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function accountKeyStr(k: AccountKey): string {
  return `${k.institution}|${k.accountType}|${k.accountNumberMasked}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function log(opts: UnifiedSyncOptions, msg: string): void {
  const fn = opts.log ?? ((m: string) => console.error(m));
  fn(msg);
}

// ─── Stage 1: Scan & Parse PDFs ──────────────────────────────────────────────

export async function scanAndParsePdfs(inputDir: string, opts: UnifiedSyncOptions): Promise<ParsedPdfFile[]> {
  const dirPath = resolve(inputDir);
  if (!existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const files = readdirSync(dirPath)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => join(dirPath, f));

  if (files.length === 0) {
    throw new Error(`No PDF files found in: ${dirPath}`);
  }

  log(opts, `[1/5] Scanning ${files.length} PDF file(s) in ${dirPath}`);

  const results: ParsedPdfFile[] = [];

  for (const filePath of files) {
    const fileName = basename(filePath);
    log(opts, `  Parsing: ${fileName}`);

    try {
      const pdf = await extractPDF(filePath);

      if (isTransactionDetailsPDF(pdf)) {
        // "Print Transaction Details" format
        const parseResult = parseTransactionDetails(pdf);

        if (parseResult.warnings.length > 0 && opts.verbose) {
          for (const w of parseResult.warnings) {
            log(opts, `    [WARN] ${w}`);
          }
        }

        const statement = transactionDetailsToParsedStatement(
          parseResult.accountInfo,
          parseResult.balanceInfo,
          parseResult.transactions,
          parseResult.warnings
        );

        const accountKey: AccountKey = {
          institution: 'Bank of America',
          accountType: parseResult.accountInfo.accountType,
          accountNumberMasked: parseResult.accountInfo.accountNumberMasked,
        };

        log(opts, `    → ${accountKey.accountType} ${accountKey.accountNumberMasked}: ${statement.transactions.length} transactions`);

        results.push({
          filePath,
          fileName,
          accountKey,
          statement,
          transactionCount: statement.transactions.length,
        });
      } else {
        // Monthly statement format
        const parseResult = parseBoaMultipleStatements(pdf);

        if (parseResult.statements.length === 0) {
          log(opts, `    [WARN] No statements found, skipping`);
          continue;
        }

        for (const stmt of parseResult.statements) {
          const accountKey: AccountKey = {
            institution: stmt.account.institution,
            accountType: stmt.account.accountType,
            accountNumberMasked: stmt.account.accountNumberMasked,
          };

          log(opts, `    → ${accountKey.accountType} ${accountKey.accountNumberMasked}: ${stmt.transactions.length} transactions`);

          results.push({
            filePath,
            fileName,
            accountKey,
            statement: stmt,
            transactionCount: stmt.transactions.length,
          });
        }
      }
    } catch (err) {
      log(opts, `    [ERROR] Failed to parse ${fileName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return results;
}

// ─── Stage 2: Query Supabase Date Ranges ─────────────────────────────────────

interface SupabaseDateRange {
  accountKey: AccountKey;
  minDate: string;
  maxDate: string;
  transactionCount: number;
}

async function getSupabaseDateRanges(opts: UnifiedSyncOptions): Promise<SupabaseDateRange[]> {
  if (opts.supabaseClient === undefined || opts.userId === undefined) {
    return [];
  }

  log(opts, `[2/5] Querying Supabase for existing data ranges...`);

  try {
    const { getAccountDateRanges } = await import('../supabase/queries.js');
    const ranges = await getAccountDateRanges(opts.supabaseClient as any, opts.userId);

    for (const r of ranges) {
      log(opts, `  ${r.accountType} ${r.accountNumberMasked}: ${r.minDate} → ${r.maxDate} (${r.transactionCount} txns)`);
    }

    return ranges.map((r) => ({
      accountKey: {
        institution: r.institution,
        accountType: r.accountType,
        accountNumberMasked: r.accountNumberMasked,
      },
      minDate: r.minDate,
      maxDate: r.maxDate,
      transactionCount: r.transactionCount,
    }));
  } catch (err) {
    log(opts, `  [WARN] Supabase query failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ─── Stage 3: Gap Analysis ───────────────────────────────────────────────────

function computeDateRange(transactions: Transaction[]): DateRange | null {
  if (transactions.length === 0) return null;
  const dates = transactions.map((t) => t.date).sort();
  return { start: dates[0]!, end: dates[dates.length - 1]! };
}

/**
 * Merge overlapping/adjacent date ranges into a sorted, non-overlapping list.
 */
function mergeRanges(ranges: DateRange[]): DateRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
  const merged: DateRange[] = [{ ...sorted[0]! }];

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = merged[merged.length - 1]!;
    // Overlapping or adjacent (next day)?
    if (cur.start <= nextDay(last.end)) {
      last.end = cur.end > last.end ? cur.end : last.end;
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/**
 * Subtract covered ranges from a requested window to produce gap ranges.
 * requestedRange defines the overall window we care about.
 * coveredRanges are the date spans already covered by PDF + Supabase data.
 * Returns the portions of requestedRange NOT covered.
 */
function subtractRanges(requestedRange: DateRange, coveredRanges: DateRange[]): DateRange[] {
  const merged = mergeRanges(coveredRanges);
  if (merged.length === 0) return [requestedRange];

  const gaps: DateRange[] = [];
  let cursor = requestedRange.start;

  for (const covered of merged) {
    // If covered range starts after our cursor, there's a gap
    if (covered.start > cursor && cursor <= requestedRange.end) {
      const gapEnd = covered.start < requestedRange.end ? prevDay(covered.start) : requestedRange.end;
      if (cursor <= gapEnd) {
        gaps.push({ start: cursor, end: gapEnd });
      }
    }
    // Advance cursor past this covered range
    const afterCovered = nextDay(covered.end);
    if (afterCovered > cursor) {
      cursor = afterCovered;
    }
  }

  // Gap after last covered range to end of requested window
  if (cursor <= requestedRange.end) {
    gaps.push({ start: cursor, end: requestedRange.end });
  }

  return gaps;
}

function computeGaps(
  pdfRange: DateRange | null,
  supabaseRange: DateRange | null,
  requestedRange: DateRange
): DateRange[] {
  const coveredRanges: DateRange[] = [];
  if (pdfRange !== null) coveredRanges.push(pdfRange);
  if (supabaseRange !== null) coveredRanges.push(supabaseRange);

  return subtractRanges(requestedRange, coveredRanges);
}

function nextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0]!;
}

function prevDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0]!;
}

function buildCoverage(
  pdfsByAccount: Map<string, ParsedPdfFile[]>,
  supabaseRanges: SupabaseDateRange[],
  requestedRange: DateRange,
  gapCache?: PlaidGapCache
): AccountCoverage[] {
  // Collect all known account keys
  const allKeys = new Map<string, AccountKey>();
  for (const [keyStr, files] of pdfsByAccount) {
    if (files[0] !== undefined) {
      allKeys.set(keyStr, files[0].accountKey);
    }
  }
  for (const r of supabaseRanges) {
    const keyStr = accountKeyStr(r.accountKey);
    if (!allKeys.has(keyStr)) {
      allKeys.set(keyStr, r.accountKey);
    }
  }

  const coverage: AccountCoverage[] = [];

  for (const [keyStr, key] of allKeys) {
    const pdfFiles = pdfsByAccount.get(keyStr) ?? [];
    const allPdfTxns = pdfFiles.flatMap((f) => f.statement.transactions);
    const pdfRange = computeDateRange(allPdfTxns);

    const sbRange = supabaseRanges.find((r) => accountKeyStr(r.accountKey) === keyStr);
    const supabaseRange = sbRange !== undefined ? { start: sbRange.minDate, end: sbRange.maxDate } : null;

    // Include previously-checked empty gaps as additional covered ranges
    const cachedEmptyRanges = gapCache?.getCheckedRanges(keyStr) ?? [];
    const gaps = computeGapsWithCache(pdfRange, supabaseRange, cachedEmptyRanges, requestedRange);

    coverage.push({
      key,
      pdfRange,
      supabaseRange,
      plaidRange: null, // filled later
      gaps,
      pdfTransactionCount: allPdfTxns.length,
      supabaseTransactionCount: sbRange?.transactionCount ?? 0,
    });
  }

  return coverage;
}

function computeGapsWithCache(
  pdfRange: DateRange | null,
  supabaseRange: DateRange | null,
  cachedEmptyRanges: DateRange[],
  requestedRange: DateRange
): DateRange[] {
  const coveredRanges: DateRange[] = [];
  if (pdfRange !== null) coveredRanges.push(pdfRange);
  if (supabaseRange !== null) coveredRanges.push(supabaseRange);
  for (const cached of cachedEmptyRanges) coveredRanges.push(cached);

  return subtractRanges(requestedRange, coveredRanges);
}

// ─── Stage 4: Fill Gaps from Plaid ───────────────────────────────────────────

interface PlaidAccountMatch {
  item: PlaidItem;
  plaidAccount: PlaidAccount;
  accountKey: AccountKey;
}

async function matchPlaidAccounts(
  store: FilePlaidItemStore,
  accountKeys: AccountKey[]
): Promise<PlaidAccountMatch[]> {
  const allItems = await store.getAllItems();
  const matches: PlaidAccountMatch[] = [];

  for (const item of allItems) {
    try {
      const plaidAccounts = await getPlaidAccounts(item.accessToken);

      for (const pa of plaidAccounts) {
        const { mapAccountType } = await import('./normalizer.js');
        const plaidType = mapAccountType(pa.type, pa.subtype);
        const plaidMask = pa.mask ?? '';

        // Match against known account keys
        for (const key of accountKeys) {
          const pdfMask = key.accountNumberMasked.replace(/\*/g, '');
          if (plaidType === key.accountType && pdfMask === plaidMask) {
            matches.push({ item, plaidAccount: pa, accountKey: key });
          }
        }
      }
    } catch (err) {
      // Skip items that fail (e.g. expired tokens)
      continue;
    }
  }

  return matches;
}

interface PlaidFillResult {
  accountKeyStr: string;
  transactions: PlaidTransaction[];
  plaidAccounts: PlaidAccount[];
  item: PlaidItem;
}

async function fillGapsFromPlaid(
  coverage: AccountCoverage[],
  store: FilePlaidItemStore,
  requestedRange: DateRange,
  opts: UnifiedSyncOptions,
  gapCache?: PlaidGapCache
): Promise<PlaidFillResult[]> {
  const accountsWithGaps = coverage.filter((c) => c.gaps.length > 0);

  if (accountsWithGaps.length === 0) {
    log(opts, `[4/5] No gaps to fill — all data covered by PDF + DB`);
    return [];
  }

  log(opts, `[4/5] Filling gaps from Plaid for ${accountsWithGaps.length} account(s)...`);

  const accountKeys = coverage.map((c) => c.key);
  const plaidMatches = await matchPlaidAccounts(store, accountKeys);

  if (plaidMatches.length === 0) {
    log(opts, `  [WARN] No Plaid accounts matched any PDF accounts`);
    // Fallback: fetch all items for the requested range
    const allItems = await store.getAllItems();
    const results: PlaidFillResult[] = [];

    for (const item of allItems) {
      try {
        log(opts, `  Fetching: ${item.institutionName} (${item.itemId.slice(0, 8)}...) ${requestedRange.start} → ${requestedRange.end}`);
        const transactions = await getTransactionsByDateRange(
          item.accessToken,
          requestedRange.start,
          requestedRange.end
        );
        const plaidAccounts = await getPlaidAccounts(item.accessToken);

        log(opts, `    → ${transactions.length} transactions`);

        results.push({
          accountKeyStr: `${item.institutionName}|all`,
          transactions,
          plaidAccounts,
          item,
        });
      } catch (err) {
        log(opts, `    [ERROR] Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return results;
  }

  const results: PlaidFillResult[] = [];
  const fetchedItems = new Set<string>();

  for (const match of plaidMatches) {
    const keyStr = accountKeyStr(match.accountKey);
    const acctCoverage = coverage.find((c) => accountKeyStr(c.key) === keyStr);
    const gaps = acctCoverage?.gaps ?? [];

    if (gaps.length === 0) {
      log(opts, `  ${match.accountKey.accountType} ${match.accountKey.accountNumberMasked}: fully covered, skipping Plaid`);
      // Still need plaidAccounts for reconciliation — fetch once per item
      if (!fetchedItems.has(match.item.itemId)) {
        fetchedItems.add(match.item.itemId);
        try {
          const plaidAccounts = await getPlaidAccounts(match.item.accessToken);
          results.push({
            accountKeyStr: keyStr,
            transactions: [],
            plaidAccounts,
            item: match.item,
          });
        } catch { /* skip */ }
      }
      continue;
    }

    // Only fetch each item once — use the widest gap range to cover all gaps
    if (fetchedItems.has(match.item.itemId)) {
      continue;
    }
    fetchedItems.add(match.item.itemId);

    try {
      // Determine the earliest Plaid transaction date for this account
      // so we can skip gaps that fall before Plaid's data boundary.
      const pdfMask = match.accountKey.accountNumberMasked.replace(/\*/g, '');
      let earliestPlaidDate: string | null = gapCache?.getEarliestDate(match.plaidAccount.accountId) ?? null;

      if (earliestPlaidDate === null) {
        log(opts, `  Querying Plaid for earliest transaction dates...`);
        const earliestDates = await getEarliestTransactionDates(match.item.accessToken);
        const acctEarliest = earliestDates.get(match.plaidAccount.accountId);
        if (acctEarliest !== undefined) {
          earliestPlaidDate = acctEarliest;
          gapCache?.setEarliestDate(match.plaidAccount.accountId, acctEarliest);
          log(opts, `    ${match.accountKey.accountType} ****${pdfMask}: earliest Plaid transaction = ${acctEarliest}`);
        } else {
          log(opts, `    ${match.accountKey.accountType} ****${pdfMask}: no Plaid transactions found`);
        }
      } else {
        log(opts, `  ${match.accountKey.accountType} ****${pdfMask}: earliest Plaid date (cached) = ${earliestPlaidDate}`);
      }

      // Clamp gaps to Plaid's data boundary
      const effectiveGaps: DateRange[] = [];
      for (const gap of gaps) {
        if (earliestPlaidDate !== null && gap.end < earliestPlaidDate) {
          // Entire gap is before Plaid's earliest — skip and cache
          log(opts, `  Skipping gap ${gap.start}..${gap.end} (before Plaid earliest ${earliestPlaidDate})`);
          gapCache?.markChecked(keyStr, gap.start, gap.end);
          continue;
        }
        if (earliestPlaidDate !== null && gap.start < earliestPlaidDate) {
          // Clamp start to Plaid's earliest
          const clamped = { start: earliestPlaidDate, end: gap.end };
          log(opts, `  Clamping gap ${gap.start}..${gap.end} → ${clamped.start}..${clamped.end}`);
          gapCache?.markChecked(keyStr, gap.start, prevDay(earliestPlaidDate));
          effectiveGaps.push(clamped);
        } else {
          effectiveGaps.push(gap);
        }
      }

      // Fetch only the effective gap ranges from Plaid
      let allGapTxns: PlaidTransaction[] = [];
      const hasDb = opts.supabaseClient !== undefined && opts.userId !== undefined;

      for (const gap of effectiveGaps) {
        log(opts, `  Fetching: ${match.item.institutionName} ${match.accountKey.accountType} ${match.accountKey.accountNumberMasked} gap ${gap.start} → ${gap.end}`);
        const gapTxns = await getTransactionsByDateRange(
          match.item.accessToken,
          gap.start,
          gap.end
        );
        log(opts, `    → ${gapTxns.length} transactions for gap`);
        allGapTxns = allGapTxns.concat(gapTxns);

        // Cache empty gaps so we don't re-fetch them on subsequent runs
        if (gapTxns.length === 0 && gapCache !== undefined) {
          gapCache.markChecked(keyStr, gap.start, gap.end);
        }
      }

      // When DB is source of truth, skip the full-range reconciliation fetch —
      // the DB already has all data and reconciliation is not needed.
      let finalTxns: PlaidTransaction[];
      if (hasDb) {
        finalTxns = allGapTxns;
      } else {
        // Fetch the full range for reconciliation purposes (in-memory path)
        const overlapStart = requestedRange.start;
        const overlapEnd = requestedRange.end;
        log(opts, `  Fetching full range for reconciliation: ${overlapStart} → ${overlapEnd}`);
        finalTxns = await getTransactionsByDateRange(
          match.item.accessToken,
          overlapStart,
          overlapEnd
        );
        log(opts, `    → ${finalTxns.length} total Plaid transactions in range`);
      }

      const plaidAccounts = await getPlaidAccounts(match.item.accessToken);

      results.push({
        accountKeyStr: keyStr,
        transactions: finalTxns,
        plaidAccounts,
        item: match.item,
      });
    } catch (err) {
      log(opts, `    [ERROR] Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return results;
}

// ─── Stage 5: Reconcile & Combine ────────────────────────────────────────────

function buildReconciliationSummary(reconciliation: ReconciliationResult): Record<string, unknown> {
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

function buildPlaidMatchInfo(match: { plaidTransaction: PlaidTransaction; confidence: number; matchType: string; differences: string[] }): Record<string, unknown> {
  const plaidTx = match.plaidTransaction;
  const result: Record<string, unknown> = {
    plaidTransactionId: plaidTx.transactionId,
    matchConfidence: match.confidence,
    matchType: match.matchType,
    differences: match.differences,
  };

  if (plaidTx.merchantName !== undefined && plaidTx.merchantName !== null) {
    result['merchantName'] = plaidTx.merchantName;
  }

  if (plaidTx.location !== undefined) {
    const loc: Record<string, string> = {};
    if (plaidTx.location.city) loc['city'] = plaidTx.location.city;
    if (plaidTx.location.region) loc['state'] = plaidTx.location.region;
    if (plaidTx.location.country) loc['country'] = plaidTx.location.country;
    if (Object.keys(loc).length > 0) result['location'] = loc;
  }

  if (plaidTx.personalFinanceCategory !== undefined) {
    result['personalFinanceCategory'] = {
      primary: plaidTx.personalFinanceCategory.primary,
      detailed: plaidTx.personalFinanceCategory.detailed,
    };
  }

  return result;
}

// ─── Stage 1b: Upload parsed PDF data to DB ─────────────────────────────────

async function uploadPdfDataToDb(
  parsedFiles: ParsedPdfFile[],
  opts: UnifiedSyncOptions
): Promise<{ inserted: number; skipped: number }> {
  if (opts.supabaseClient === undefined || opts.userId === undefined) {
    return { inserted: 0, skipped: 0 };
  }

  const { importV2Result } = await import('../supabase/import.js');

  // Build a minimal v2 from parsed PDFs for the import function
  const allStatements: ParsedStatement[] = parsedFiles.map((pf) => pf.statement);
  const totalPdfTx = allStatements.reduce((sum, s) => sum + s.transactions.length, 0);
  const canonical: CanonicalOutput = {
    statements: allStatements,
    totalStatements: allStatements.length,
    totalTransactions: totalPdfTx,
  };
  const v2ForUpload: FinalResultV2 = toFinalResultV2(canonical);

  const result = await importV2Result(opts.supabaseClient as any, opts.userId, {
    result: v2ForUpload,
  });

  return {
    inserted: result.transactionsInserted,
    skipped: result.transactionsSkipped,
  };
}

// ─── Stage 4b: Upload Plaid gap-fill transactions to DB ─────────────────────

async function uploadPlaidGapDataToDb(
  plaidTxns: PlaidTransaction[],
  plaidAccounts: PlaidAccount[],
  opts: UnifiedSyncOptions
): Promise<{ inserted: number; skipped: number }> {
  if (opts.supabaseClient === undefined || opts.userId === undefined) {
    return { inserted: 0, skipped: 0 };
  }

  const { upsertAccount, upsertTransactions } = await import('../supabase/import.js');

  let totalInserted = 0;
  let totalSkipped = 0;

  // Group Plaid transactions by account
  const txnsByAccount = new Map<string, PlaidTransaction[]>();
  for (const tx of plaidTxns) {
    const existing = txnsByAccount.get(tx.accountId) ?? [];
    existing.push(tx);
    txnsByAccount.set(tx.accountId, existing);
  }

  for (const [plaidAccountId, txns] of txnsByAccount) {
    const pa = plaidAccounts.find((a) => a.accountId === plaidAccountId);
    if (pa === undefined) continue;

    const acctType = mapAccountType(pa.type, pa.subtype);
    const acctMask = pa.mask ?? '';

    // Upsert account
    const acctResult = await upsertAccount(opts.supabaseClient as any, opts.userId, {
      institution: 'Bank of America',
      accountType: acctType,
      accountNumberMasked: `****${acctMask}`,
      currency: pa.balances.isoCurrencyCode ?? 'USD',
    });

    // Convert Plaid transactions to TransactionInput format
    const transactionInputs = txns.map((pt) => {
      const canonicalTx = normalizeTransaction(pt, pa, generatePlaidStatementId(acctType, acctMask, pt.date));
      const stmtId = generatePlaidStatementId(acctType, acctMask, pt.date);
      const txId = computeTransactionId(
        {
          date: canonicalTx.date,
          postedDate: canonicalTx.postedDate,
          direction: canonicalTx.direction,
          amount: canonicalTx.amount,
          description: canonicalTx.description,
          merchant: typeof canonicalTx.merchant === 'object' ? canonicalTx.merchant?.name ?? null : canonicalTx.merchant,
          raw: canonicalTx.raw,
        },
        stmtId
      );

      return {
        transactionId: txId,
        date: canonicalTx.date,
        postedDate: canonicalTx.postedDate,
        amount: canonicalTx.direction === 'debit' ? -canonicalTx.amount : canonicalTx.amount,
        direction: canonicalTx.direction,
        description: canonicalTx.description,
        merchant: typeof canonicalTx.merchant === 'object' ? canonicalTx.merchant : { name: canonicalTx.merchant },
        category: canonicalTx.categorization.category,
        subcategory: canonicalTx.categorization.subcategory,
        confidence: canonicalTx.categorization.confidence,
        raw: canonicalTx.raw,
      };
    });

    const result = await upsertTransactions(opts.supabaseClient as any, opts.userId, {
      accountId: acctResult.accountId,
      transactions: transactionInputs,
    });

    totalInserted += result.inserted;
    totalSkipped += result.skipped;
  }

  return { inserted: totalInserted, skipped: totalSkipped };
}

// ─── Stage 5: Build v2 output from DB ───────────────────────────────────────

interface DbAccountBlock {
  account: {
    institution: string;
    accountType: string;
    accountNumberMasked: string;
    statementPeriod: { start: string; end: string };
    currency: string;
  };
  summary: {
    startingBalance: number;
    endingBalance: number;
    totalCredits: number;
    totalDebits: number;
  };
  transactions: Array<Record<string, unknown>>;
  totalStatements: number;
  totalTransactions: number;
}

async function buildV2FromDb(
  requestedRange: DateRange,
  opts: UnifiedSyncOptions
): Promise<{ accounts: DbAccountBlock[]; totalTransactions: number } | null> {
  if (opts.supabaseClient === undefined || opts.userId === undefined) {
    return null;
  }

  const { getAccounts, getTransactions } = await import('../supabase/queries.js');

  const accounts = await getAccounts(opts.supabaseClient as any, opts.userId);
  if (accounts.length === 0) return null;

  const result: DbAccountBlock[] = [];
  let grandTotal = 0;

  for (const acct of accounts) {
    // Get all transactions for this account in the requested range
    const txns = await getTransactions(opts.supabaseClient as any, opts.userId, {
      accountId: acct.id,
      startDate: requestedRange.start,
      endDate: requestedRange.end,
    });

    if (txns.length === 0) continue;

    // Deduplicate: same date|amount|direction|description within an account
    // Keep the most recently created record (last inserted wins)
    const deduped = new Map<string, typeof txns[0]>();
    // Sort by created_at ascending so later entries overwrite earlier ones
    txns.sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const tx of txns) {
      const key = `${tx.date}|${tx.amount}|${tx.direction}|${tx.description}`;
      deduped.set(key, tx);
    }
    const uniqueTxns = Array.from(deduped.values());

    // Sort by date ascending
    uniqueTxns.sort((a, b) => a.date.localeCompare(b.date));

    // Compute totals from deduplicated transactions
    let totalCredits = 0;
    let totalDebits = 0;
    for (const tx of uniqueTxns) {
      if (tx.direction === 'credit') {
        totalCredits += Math.abs(tx.amount);
      } else {
        totalDebits += Math.abs(tx.amount);
      }
    }
    totalCredits = round2(totalCredits);
    totalDebits = round2(totalDebits);

    // Derive balances: use the latest statement's ending balance as anchor,
    // then adjust for transactions after the statement period.
    const { getStatements } = await import('../supabase/queries.js');
    const statements = await getStatements(opts.supabaseClient as any, opts.userId, {
      accountId: acct.id,
    });

    // Find the latest statement with an ending balance
    const statementsWithBalance = statements
      .filter((s) => s.ending_balance !== null)
      .sort((a, b) => b.period_end.localeCompare(a.period_end));
    const latestStmt = statementsWithBalance[0];

    let endingBalance: number;
    if (latestStmt?.ending_balance !== null && latestStmt?.ending_balance !== undefined) {
      // Adjust for transactions after the statement period
      const stmtEndDate = latestStmt.period_end;
      const postStmtNet = round2(uniqueTxns
        .filter((tx) => tx.date > stmtEndDate)
        .reduce((sum, tx) => {
          return sum + (tx.direction === 'credit' ? Math.abs(tx.amount) : -Math.abs(tx.amount));
        }, 0));
      endingBalance = round2(latestStmt.ending_balance + postStmtNet);
    } else {
      // No statement balance available — derive from totals (starting from 0)
      endingBalance = round2(totalCredits - totalDebits);
    }

    // Derive startingBalance from the balance equation so it always holds
    const startingBalance = round2(endingBalance - totalCredits + totalDebits);

    const periodStart = uniqueTxns[0]!.date;
    const periodEnd = uniqueTxns[uniqueTxns.length - 1]!.date;

    // Convert deduplicated DB rows to v2 transaction format
    const v2Txns = uniqueTxns.map((tx) => {
      const merchantObj = tx.merchant as Record<string, unknown> | null;
      const merchantName = (merchantObj?.['name'] as string) ?? tx.description;
      const [year, month] = tx.date.split('-');

      // Sanitize raw: schema only allows { originalText, page } with page >= 1
      const rawObj = tx.raw as Record<string, unknown> | null;
      const rawOriginalText = (rawObj?.['originalText'] as string) ?? tx.description;
      const rawPage = Math.max(1, Number(rawObj?.['page'] ?? 1));

      return {
        date: tx.date,
        postedDate: tx.posted_date,
        description: tx.description,
        merchant: merchantName,
        amount: tx.amount,
        direction: tx.direction,
        category: tx.category ?? 'Uncategorized',
        subcategory: tx.subcategory ?? null,
        confidence: tx.confidence ?? 0.5,
        statementId: tx.statement_db_id ?? `${acct.account_type.toUpperCase()}-${acct.account_number_masked.replace(/\*/g, '')}-${year}${month}`,
        periodLabel: `${year}-${month}`,
        transactionId: tx.transaction_id,
        raw: { originalText: rawOriginalText, page: rawPage },
      };
    });

    grandTotal += v2Txns.length;

    result.push({
      account: {
        institution: acct.institution,
        accountType: acct.account_type,
        accountNumberMasked: acct.account_number_masked,
        statementPeriod: { start: periodStart, end: periodEnd },
        currency: acct.currency,
      },
      summary: {
        startingBalance,
        endingBalance,
        totalCredits,
        totalDebits,
      },
      transactions: v2Txns,
      totalStatements: statements.length,
      totalTransactions: v2Txns.length,
    });
  }

  return { accounts: result, totalTransactions: grandTotal };
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

export async function runUnifiedSync(opts: UnifiedSyncOptions): Promise<UnifiedSyncResult> {
  const today = new Date().toISOString().split('T')[0]!;
  const hasDb = opts.supabaseClient !== undefined && opts.userId !== undefined;

  // Initialize gap cache to avoid re-fetching empty Plaid ranges
  const gapCache = new PlaidGapCache();

  // Stage 1: Scan & parse PDFs (optional — skipped if no inputDir and DB is available)
  let parsedFiles: ParsedPdfFile[] = [];
  const pdfsByAccount = new Map<string, ParsedPdfFile[]>();

  if (opts.inputDir !== undefined && opts.inputDir !== '') {
    parsedFiles = await scanAndParsePdfs(opts.inputDir, opts);

    for (const pf of parsedFiles) {
      const keyStr = accountKeyStr(pf.accountKey);
      const existing = pdfsByAccount.get(keyStr) ?? [];
      existing.push(pf);
      pdfsByAccount.set(keyStr, existing);
    }

    log(opts, `  Found ${parsedFiles.length} parsed file(s) across ${pdfsByAccount.size} account(s)`);
  } else if (hasDb) {
    log(opts, `[1/6] No inputDir — will use database as sole data source`);
  } else {
    throw new Error('Either --inputDir or a configured database is required');
  }

  // Compute the requested date range
  const allPdfDates = parsedFiles.flatMap((pf) => pf.statement.transactions.map((t) => t.date)).sort();
  const fallbackStart = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 2);
    return d.toISOString().split('T')[0]!;
  })();
  const requestedRange: DateRange = {
    start: opts.startDate ?? allPdfDates[0] ?? fallbackStart,
    end: opts.endDate ?? today,
  };
  log(opts, `  Requested range: ${requestedRange.start} → ${requestedRange.end}`);

  // Stage 1b: Upload parsed PDF data to DB (if DB available and we have PDFs)
  let pdfUploadStats = { inserted: 0, skipped: 0 };
  if (hasDb && parsedFiles.length > 0) {
    log(opts, `[1b/6] Uploading parsed PDF data to database...`);
    pdfUploadStats = await uploadPdfDataToDb(parsedFiles, opts);
    log(opts, `  DB upload: ${pdfUploadStats.inserted} inserted, ${pdfUploadStats.skipped} skipped (already in DB)`);
  }

  // Stage 2: Query DB for date ranges (now includes freshly uploaded PDF data)
  const supabaseRanges = await getSupabaseDateRanges(opts);
  if (supabaseRanges.length === 0) {
    log(opts, `[2/6] Supabase: no existing data (not configured or empty)`);
  }

  // Stage 3: Gap analysis (DB ranges vs requested range)
  log(opts, `[3/6] Analyzing coverage gaps...`);
  let coverage = buildCoverage(pdfsByAccount, supabaseRanges, requestedRange, gapCache);

  // If no accounts are known (empty DB + no PDFs), discover from Plaid so the
  // entire requested range becomes a gap that will be filled in Stage 4.
  if (coverage.length === 0) {
    log(opts, `  No known accounts — discovering from Plaid...`);
    const allItems = await opts.store.getAllItems();
    for (const item of allItems) {
      try {
        const plaidAccounts = await getPlaidAccounts(item.accessToken);
        const { mapAccountType } = await import('./normalizer.js');
        for (const pa of plaidAccounts) {
          const plaidType = mapAccountType(pa.type, pa.subtype);
          const plaidMask = pa.mask ?? '';
          const key: AccountKey = {
            institution: item.institutionName ?? 'Bank of America',
            accountType: plaidType,
            accountNumberMasked: `****${plaidMask}`,
          };
          coverage.push({
            key,
            pdfRange: null,
            supabaseRange: null,
            plaidRange: null,
            gaps: [requestedRange],
            pdfTransactionCount: 0,
            supabaseTransactionCount: 0,
          });
        }
      } catch {
        // Skip items with expired tokens
      }
    }
    if (coverage.length > 0) {
      log(opts, `  Discovered ${coverage.length} account(s) from Plaid`);
    }
  }

  for (const c of coverage) {
    const pdfLabel = c.pdfRange !== null ? `${c.pdfRange.start} → ${c.pdfRange.end}` : 'none';
    const sbLabel = c.supabaseRange !== null ? `${c.supabaseRange.start} → ${c.supabaseRange.end}` : 'none';
    const gapLabel = c.gaps.length > 0 ? c.gaps.map((g) => `${g.start}..${g.end}`).join(', ') : 'none';
    log(opts, `  ${c.key.accountType} ${c.key.accountNumberMasked}: PDF=${pdfLabel}, DB=${sbLabel}, gaps=${gapLabel}`);
  }

  // Stage 4: Fill gaps from Plaid
  const plaidResults = await fillGapsFromPlaid(coverage, opts.store, requestedRange, opts, gapCache);

  const allPlaidTransactions: PlaidTransaction[] = plaidResults.flatMap((r) => r.transactions);
  const allPlaidAccounts: PlaidAccount[] = plaidResults.flatMap((r) => r.plaidAccounts);
  const totalPlaidTxns = allPlaidTransactions.length;

  // Stage 4b: Upload Plaid gap-fill transactions to DB (if DB available)
  let plaidUploadStats = { inserted: 0, skipped: 0 };
  if (hasDb && allPlaidTransactions.length > 0) {
    // Only upload transactions that fall within gap ranges (not the full reconciliation range)
    const gapTxns = allPlaidTransactions.filter((pt) => {
      const gaps = coverage.flatMap((c) => c.gaps);
      return gaps.some((g) => pt.date >= g.start && pt.date <= g.end);
    });

    if (gapTxns.length > 0) {
      log(opts, `[4b/6] Uploading ${gapTxns.length} Plaid gap-fill transactions to database...`);
      plaidUploadStats = await uploadPlaidGapDataToDb(gapTxns, allPlaidAccounts, opts);
      log(opts, `  DB upload: ${plaidUploadStats.inserted} inserted, ${plaidUploadStats.skipped} skipped`);
    }
  }

  // Stage 5: Build v2 output
  // If DB is available, read ALL data from DB (the source of truth)
  // Otherwise, fall back to in-memory merge
  log(opts, `[5/6] Building combined v2 output...`);

  let v2Output: Record<string, unknown>;
  let combinedTotalTransactions: number;
  let totalPlaidOnlyAdded = 0;
  const totalPdfTransactions = parsedFiles.reduce((sum, pf) => sum + pf.statement.transactions.length, 0);
  const reconciliations = new Map<string, ReconciliationResult>();
  let totalMatched = 0;

  const { generateAnalytics } = await import('../output/analytics.js');
  const { checkIntegrity } = await import('../output/integrity.js');

  if (hasDb) {
    // ── DB-first path: read everything from DB ──
    log(opts, `  Reading all transactions from database (source of truth)...`);
    const dbResult = await buildV2FromDb(requestedRange, opts);

    if (dbResult !== null && dbResult.accounts.length > 0) {
      combinedTotalTransactions = dbResult.totalTransactions;
      totalPlaidOnlyAdded = plaidUploadStats.inserted;

      const topStartingBalance = round2(dbResult.accounts.reduce((sum, a) => sum + a.summary.startingBalance, 0));
      const topEndingBalance = round2(dbResult.accounts.reduce((sum, a) => sum + a.summary.endingBalance, 0));

      // Generate analytics/integrity: prefer PDF statements, fall back to synthetic from DB
      let allStatements: ParsedStatement[];
      if (parsedFiles.length > 0) {
        allStatements = parsedFiles.map((pf) => pf.statement);
      } else {
        // Build synthetic ParsedStatement[] from DB accounts for analytics
        allStatements = dbResult.accounts.map((acct) => {
          const txns = acct.transactions.map((t) => {
            const tr = t as Record<string, unknown>;
            return {
              date: tr['date'] as string,
              description: tr['description'] as string,
              amount: tr['amount'] as number,
              direction: tr['direction'] as 'credit' | 'debit',
              category: (tr['category'] as string) ?? 'Uncategorized',
              subcategory: (tr['subcategory'] as string | null) ?? null,
              confidence: (tr['confidence'] as number) ?? 0.5,
              postedDate: (tr['postedDate'] as string | null) ?? null,
              merchant: (tr['merchant'] as string | null) ?? null,
              raw: (tr['raw'] as { originalText: string; page: number }) ?? { originalText: tr['description'] as string, page: 1 },
            };
          }) as Transaction[];
          return {
            account: {
              institution: acct.account.institution as 'Bank of America',
              accountType: acct.account.accountType as 'checking' | 'savings' | 'credit',
              accountNumberMasked: acct.account.accountNumberMasked,
              statementPeriod: acct.account.statementPeriod,
              currency: (acct.account.currency ?? 'USD') as 'USD',
            },
            summary: {
              startingBalance: acct.summary.startingBalance,
              endingBalance: acct.summary.endingBalance,
              totalCredits: acct.summary.totalCredits,
              totalDebits: acct.summary.totalDebits,
            },
            transactions: txns,
            metadata: {
              parserVersion: '1.4.1',
              parsedAt: new Date().toISOString(),
              warnings: ['Synthetic statement constructed from database data'],
            },
          } as unknown as ParsedStatement;
        });
      }
      const analytics = generateAnalytics(allStatements);
      const integrity = checkIntegrity(allStatements);

      v2Output = {
        schemaVersion: 'v2',
        startingBalance: topStartingBalance,
        endingBalance: topEndingBalance,
        totalStatements: allStatements.length,
        totalTransactions: combinedTotalTransactions,
        accounts: dbResult.accounts,
        analytics,
        integrity,
      };

      log(opts, `  DB output: ${dbResult.accounts.length} account(s), ${combinedTotalTransactions} transactions`);
    } else {
      // DB returned nothing — fall back to in-memory
      log(opts, `  [WARN] DB returned no data, falling back to in-memory merge`);
      const fallback = buildV2InMemory(parsedFiles, pdfsByAccount, plaidResults, allPlaidTransactions, allPlaidAccounts, coverage, requestedRange, opts);
      v2Output = fallback.v2Output;
      combinedTotalTransactions = fallback.combinedTotalTransactions;
      totalPlaidOnlyAdded = fallback.totalPlaidOnlyAdded;
      totalMatched = fallback.totalMatched;
      for (const [k, v] of fallback.reconciliations) reconciliations.set(k, v);
    }
  } else {
    // ── In-memory path (no DB) ──
    const fallback = buildV2InMemory(parsedFiles, pdfsByAccount, plaidResults, allPlaidTransactions, allPlaidAccounts, coverage, requestedRange, opts);
    v2Output = fallback.v2Output;
    combinedTotalTransactions = fallback.combinedTotalTransactions;
    totalPlaidOnlyAdded = fallback.totalPlaidOnlyAdded;
    totalMatched = fallback.totalMatched;
    for (const [k, v] of fallback.reconciliations) reconciliations.set(k, v);
  }

  // Stage 6: Add metadata
  log(opts, `[6/6] Adding metadata...`);

  const dataSources: Record<string, unknown> = {
    requestedRange: {
      start: requestedRange.start,
      end: requestedRange.end,
    },
    pdf: {
      files: parsedFiles.map((f) => f.filePath),
      transactionCount: totalPdfTransactions,
      parseDate: new Date().toISOString(),
    },
  };

  if (hasDb) {
    dataSources['database'] = {
      pdfUploaded: pdfUploadStats.inserted,
      pdfSkipped: pdfUploadStats.skipped,
      plaidUploaded: plaidUploadStats.inserted,
      plaidSkipped: plaidUploadStats.skipped,
      sourceOfTruth: true,
    };
  }

  if (plaidResults.length > 0) {
    const firstItem = plaidResults[0]!;
    const gapRanges = coverage.flatMap((c) => c.gaps);
    dataSources['plaid'] = {
      itemId: firstItem.item.itemId,
      institutionName: firstItem.item.institutionName,
      transactionCount: totalPlaidTxns,
      fetchedGaps: gapRanges.length > 0 ? gapRanges : 'none (fully covered)',
      syncDate: new Date().toISOString(),
    };
  }

  v2Output['dataSources'] = dataSources;

  // Account count: prefer PDF accounts, then DB ranges, then coverage (Plaid-discovered)
  const accountCount = pdfsByAccount.size > 0
    ? pdfsByAccount.size
    : supabaseRanges.length > 0
      ? supabaseRanges.length
      : coverage.length;

  return {
    v2Output,
    stats: {
      pdfFiles: parsedFiles.length,
      accounts: accountCount,
      pdfTransactions: totalPdfTransactions,
      plaidTransactions: totalPlaidTxns,
      plaidOnlyAdded: totalPlaidOnlyAdded,
      supabaseTransactions: combinedTotalTransactions,
      matchedTransactions: totalMatched,
      totalTransactions: combinedTotalTransactions,
      coverage,
    },
    reconciliations,
  };
}

// ─── In-memory fallback (no DB available) ────────────────────────────────────

function buildV2InMemory(
  parsedFiles: ParsedPdfFile[],
  pdfsByAccount: Map<string, ParsedPdfFile[]>,
  plaidResults: PlaidFillResult[],
  allPlaidTransactions: PlaidTransaction[],
  allPlaidAccounts: PlaidAccount[],
  coverage: AccountCoverage[],
  requestedRange: DateRange,
  opts: UnifiedSyncOptions
): {
  v2Output: Record<string, unknown>;
  combinedTotalTransactions: number;
  totalPlaidOnlyAdded: number;
  totalMatched: number;
  reconciliations: Map<string, ReconciliationResult>;
} {
  const allStatements: ParsedStatement[] = parsedFiles.map((pf) => pf.statement);
  const totalPdfTransactions = allStatements.reduce((sum, s) => sum + s.transactions.length, 0);
  const canonical: CanonicalOutput = {
    statements: allStatements,
    totalStatements: allStatements.length,
    totalTransactions: totalPdfTransactions,
  };

  const v2Base: FinalResultV2 = toFinalResultV2(canonical);

  // Reconcile
  const reconciliations = new Map<string, ReconciliationResult>();
  let totalMatched = 0;

  for (const [keyStr, pdfFiles] of pdfsByAccount) {
    const pdfTxFlat = pdfFiles.flatMap((f) =>
      f.statement.transactions.map((t) => ({
        date: t.date,
        amount: Math.abs(t.amount),
        description: t.description,
        merchant: t.merchant as string | null,
      }))
    );

    if (pdfTxFlat.length === 0) continue;

    const accountKey = pdfFiles[0]!.accountKey;
    const pdfMask = accountKey.accountNumberMasked.replace(/\*/g, '');

    const matchingPlaidTxns = allPlaidTransactions.filter((pt) => {
      const pa = allPlaidAccounts.find((a) => a.accountId === pt.accountId);
      if (pa === undefined) return false;
      const plaidType = mapAccountType(pa.type, pa.subtype);
      const plaidMask = pa.mask ?? '';
      return plaidType === accountKey.accountType && plaidMask === pdfMask;
    });

    if (matchingPlaidTxns.length > 0) {
      const reconcileResult = reconcileTransactions(pdfTxFlat, matchingPlaidTxns);
      reconciliations.set(keyStr, reconcileResult);
      totalMatched += reconcileResult.summary.matchedCount;
    }
  }

  // Build match index
  const matchIndex = new Map<string, Record<string, unknown>>();
  for (const [, recon] of reconciliations) {
    for (const m of recon.matched) {
      const key = `${m.pdfTransaction.date}|${m.pdfTransaction.amount.toFixed(2)}|${m.pdfTransaction.description}`;
      matchIndex.set(key, buildPlaidMatchInfo(m));
    }
  }

  // Collect unmatched Plaid gap transactions
  const plaidOnlyByAccount = new Map<string, PlaidTransaction[]>();
  let totalPlaidOnlyAdded = 0;

  for (const [keyStr, pdfFiles] of pdfsByAccount) {
    const accountKey = pdfFiles[0]!.accountKey;
    const pdfMask = accountKey.accountNumberMasked.replace(/\*/g, '');
    const acctCoverage = coverage.find((c) => accountKeyStr(c.key) === keyStr);
    const gaps = acctCoverage?.gaps ?? [];
    if (gaps.length === 0) continue;

    const recon = reconciliations.get(keyStr);
    if (recon === undefined) continue;

    const unmatchedInGaps = recon.unmatchedPlaid.filter((pt) => {
      const pa = allPlaidAccounts.find((a) => a.accountId === pt.accountId);
      if (pa === undefined) return false;
      const plaidType = mapAccountType(pa.type, pa.subtype);
      const plaidMask = pa.mask ?? '';
      if (plaidType !== accountKey.accountType || plaidMask !== pdfMask) return false;
      return gaps.some((g) => pt.date >= g.start && pt.date <= g.end);
    });

    if (unmatchedInGaps.length > 0) {
      plaidOnlyByAccount.set(keyStr, unmatchedInGaps);
    }
  }

  // Enrich accounts
  const enrichedAccounts = v2Base.accounts.map((account) => {
    const acctType = account.account.accountType;
    const acctMask = account.account.accountNumberMasked;
    const keyStr = `${account.account.institution}|${acctType}|${acctMask}`;
    const pdfMask = acctMask.replace(/\*/g, '');

    const enrichedTxns = account.transactions.map((tx) => {
      const key = `${tx.date}|${Math.abs(tx.amount).toFixed(2)}|${tx.description}`;
      const plaidMatch = matchIndex.get(key);
      if (plaidMatch !== undefined) return { ...tx, plaidMatch };
      return tx;
    });

    const plaidOnlyTxns = plaidOnlyByAccount.get(keyStr) ?? [];
    const plaidAccount = allPlaidAccounts.find((pa) => {
      const pt = mapAccountType(pa.type, pa.subtype);
      const pm = pa.mask ?? '';
      return pt === acctType && pm === pdfMask;
    });

    for (const pt of plaidOnlyTxns) {
      const pa = plaidAccount ?? allPlaidAccounts.find((a) => a.accountId === pt.accountId);
      if (pa === undefined) continue;

      const canonicalTx = normalizeTransaction(pt, pa, generatePlaidStatementId(acctType, pdfMask, pt.date));
      const statementId = generatePlaidStatementId(acctType, pdfMask, pt.date);
      const [year, month] = pt.date.split('-');
      const periodLabel = `${year}-${month}`;
      const transactionId = computeTransactionId(
        {
          date: canonicalTx.date,
          postedDate: canonicalTx.postedDate,
          direction: canonicalTx.direction,
          amount: canonicalTx.amount,
          description: canonicalTx.description,
          merchant: typeof canonicalTx.merchant === 'object' ? canonicalTx.merchant?.name ?? null : canonicalTx.merchant,
          raw: canonicalTx.raw,
        },
        statementId
      );

      const merchantName = typeof canonicalTx.merchant === 'object'
        ? canonicalTx.merchant?.name ?? pt.merchantName ?? pt.name
        : canonicalTx.merchant ?? pt.merchantName ?? pt.name;

      enrichedTxns.push({
        date: canonicalTx.date,
        postedDate: canonicalTx.postedDate,
        description: canonicalTx.description,
        merchant: merchantName,
        amount: canonicalTx.direction === 'debit' ? -canonicalTx.amount : canonicalTx.amount,
        direction: canonicalTx.direction,
        category: canonicalTx.categorization.category,
        subcategory: canonicalTx.categorization.subcategory,
        confidence: canonicalTx.categorization.confidence,
        statementId,
        periodLabel,
        transactionId,
        raw: { originalText: pt.name, page: 1 },
        plaidMatch: {
          plaidTransactionId: pt.transactionId,
          matchConfidence: 1.0,
          matchType: 'plaid_only',
          differences: [],
          source: 'gap_fill',
          ...(pt.merchantName !== undefined && pt.merchantName !== null ? { merchantName: pt.merchantName } : {}),
          ...(pt.personalFinanceCategory !== undefined ? {
            personalFinanceCategory: {
              primary: pt.personalFinanceCategory.primary,
              detailed: pt.personalFinanceCategory.detailed,
            },
          } : {}),
        },
      });
      totalPlaidOnlyAdded++;
    }

    enrichedTxns.sort((a, b) => a.date.localeCompare(b.date));

    const newTotalCredits = round2(enrichedTxns.filter((t) => t.direction === 'credit').reduce((sum, t) => sum + Math.abs(t.amount), 0));
    const newTotalDebits = round2(enrichedTxns.filter((t) => t.direction === 'debit').reduce((sum, t) => sum + Math.abs(t.amount), 0));

    const pdfPeriodEnd = account.account.statementPeriod.end;
    const pdfEndingBalance = round2(account.summary.endingBalance);
    const postPdfNet = round2(plaidOnlyTxns.filter((pt) => pt.date > pdfPeriodEnd).reduce((sum, pt) => sum - pt.amount, 0));
    const newEndingBalance = round2(pdfEndingBalance + postPdfNet);
    const newStartingBalance = round2(newEndingBalance - newTotalCredits + newTotalDebits);

    const firstTxDate = enrichedTxns[0]?.date ?? account.account.statementPeriod.start;
    const lastTxDate = enrichedTxns[enrichedTxns.length - 1]?.date ?? account.account.statementPeriod.end;
    const periodStart = firstTxDate < account.account.statementPeriod.start ? firstTxDate : account.account.statementPeriod.start;
    const periodEnd = lastTxDate > account.account.statementPeriod.end ? lastTxDate : account.account.statementPeriod.end;

    return {
      ...account,
      account: { ...account.account, statementPeriod: { start: periodStart, end: periodEnd } },
      summary: { startingBalance: newStartingBalance, endingBalance: newEndingBalance, totalCredits: newTotalCredits, totalDebits: newTotalDebits },
      transactions: enrichedTxns,
      totalTransactions: enrichedTxns.length,
    };
  });

  const combinedTotalTransactions = enrichedAccounts.reduce((sum, a) => sum + a.totalTransactions, 0);
  const topStartingBalance = round2(enrichedAccounts.reduce((sum, a) => sum + a.summary.startingBalance, 0));
  const topEndingBalance = round2(enrichedAccounts.reduce((sum, a) => sum + a.summary.endingBalance, 0));

  const v2Output: Record<string, unknown> = {
    schemaVersion: 'v2',
    startingBalance: topStartingBalance,
    endingBalance: topEndingBalance,
    totalStatements: v2Base.totalStatements,
    totalTransactions: combinedTotalTransactions,
    accounts: enrichedAccounts,
    analytics: v2Base.analytics,
    integrity: v2Base.integrity,
  };

  return { v2Output, combinedTotalTransactions, totalPlaidOnlyAdded, totalMatched, reconciliations };
}
