/**
 * Recurring transaction detection module.
 * Identifies recurring payments, subscriptions, and regular transactions
 * by analyzing transaction patterns across time.
 */

import type { ParsedStatement } from '../schemas/index.js';

/**
 * Minimal transaction interface for recurring detection.
 * Works with both schema Transaction and output Transaction types.
 */
export interface RecurringTransaction {
  date: string;
  description: string;
  amount: number;
  direction: 'debit' | 'credit';
  category: string;
  subcategory: string | null;
  merchant?: string | null;
  transactionId?: string;
}

/**
 * Detected frequency of recurring transactions
 */
export type RecurringFrequency =
  | 'weekly'
  | 'bi-weekly'
  | 'monthly'
  | 'quarterly'
  | 'semi-annual'
  | 'annual'
  | 'irregular';

/**
 * A detected recurring transaction pattern
 */
export interface RecurringPattern {
  /** Unique identifier for this pattern */
  patternId: string;
  /** Normalized merchant name used for grouping */
  merchantKey: string;
  /** Display name for the merchant */
  merchantName: string;
  /** Detected frequency */
  frequency: RecurringFrequency;
  /** Average interval in days between transactions */
  averageIntervalDays: number;
  /** Standard deviation of interval (lower = more regular) */
  intervalStdDev: number;
  /** Average transaction amount */
  averageAmount: number;
  /** Amount variance (coefficient of variation) */
  amountVariance: number;
  /** Whether amounts are fixed (variance < 1%) */
  isFixedAmount: boolean;
  /** Category of the transactions */
  category: string;
  /** Subcategory of the transactions */
  subcategory: string | null;
  /** Transaction direction */
  direction: 'debit' | 'credit';
  /** Number of occurrences detected */
  occurrenceCount: number;
  /** First occurrence date */
  firstSeen: string;
  /** Last occurrence date */
  lastSeen: string;
  /** Expected next occurrence date (if pattern continues) */
  expectedNext: string | null;
  /** Confidence score (0-1) */
  confidence: number;
  /** Whether this appears to be a subscription service */
  isSubscription: boolean;
  /** Transaction IDs that match this pattern */
  transactionIds: string[];
}

/**
 * Summary of recurring transaction analysis
 */
export interface RecurringSummary {
  /** Total number of recurring patterns detected */
  totalPatterns: number;
  /** Total number of transactions identified as recurring */
  totalRecurringTransactions: number;
  /** Percentage of all transactions that are recurring */
  recurringPercentage: number;
  /** Total monthly recurring expenses (estimated) */
  estimatedMonthlyRecurring: number;
  /** Total annual recurring expenses (estimated) */
  estimatedAnnualRecurring: number;
  /** Breakdown by frequency */
  byFrequency: Record<RecurringFrequency, number>;
  /** Number of detected subscriptions */
  subscriptionCount: number;
}

/**
 * Full result of recurring transaction detection
 */
export interface RecurringDetectionResult {
  patterns: RecurringPattern[];
  summary: RecurringSummary;
}

/**
 * Options for recurring detection
 */
export interface RecurringDetectionOptions {
  /** Minimum occurrences to consider a pattern (default: 2) */
  minOccurrences?: number;
  /** Maximum interval variance to consider regular (default: 0.3 = 30%) */
  maxIntervalVariance?: number;
  /** Maximum amount variance to consider fixed (default: 0.01 = 1%) */
  fixedAmountThreshold?: number;
  /** Amount tolerance for grouping (default: 0.1 = 10%) */
  amountTolerance?: number;
}

const DEFAULT_OPTIONS: Required<RecurringDetectionOptions> = {
  minOccurrences: 2,
  maxIntervalVariance: 0.3,
  fixedAmountThreshold: 0.01,
  amountTolerance: 0.1,
};

// Known subscription services for enhanced detection
const SUBSCRIPTION_KEYWORDS = [
  'netflix', 'spotify', 'hulu', 'disney', 'hbo', 'amazon prime', 'apple',
  'google', 'microsoft', 'adobe', 'dropbox', 'icloud', 'youtube',
  'audible', 'kindle', 'paramount', 'peacock', 'crunchyroll',
  'gym', 'fitness', 'planet fitness', 'la fitness', 'ymca',
  'insurance', 'geico', 'progressive', 'state farm', 'allstate',
  'att', 'verizon', 'tmobile', 't-mobile', 'comcast', 'xfinity', 'spectrum',
  'openai', 'chatgpt', 'github', 'notion', 'slack', 'zoom',
  'patreon', 'substack', 'medium',
];

/**
 * Normalize merchant name for grouping
 */
function normalizeMerchantKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3) // Take first 3 words
    .join(' ');
}

/**
 * Calculate days between two ISO date strings
 */
function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.abs(Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * Calculate standard deviation
 */
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Detect frequency from average interval
 */
function detectFrequency(avgInterval: number, stdDev: number): RecurringFrequency {
  const cv = avgInterval > 0 ? stdDev / avgInterval : 1;
  
  // If too irregular, mark as irregular
  if (cv > 0.4) return 'irregular';
  
  // Weekly: 5-9 days
  if (avgInterval >= 5 && avgInterval <= 9) return 'weekly';
  
  // Bi-weekly: 12-16 days
  if (avgInterval >= 12 && avgInterval <= 16) return 'bi-weekly';
  
  // Monthly: 26-35 days
  if (avgInterval >= 26 && avgInterval <= 35) return 'monthly';
  
  // Quarterly: 85-100 days
  if (avgInterval >= 85 && avgInterval <= 100) return 'quarterly';
  
  // Semi-annual: 170-200 days
  if (avgInterval >= 170 && avgInterval <= 200) return 'semi-annual';
  
  // Annual: 350-380 days
  if (avgInterval >= 350 && avgInterval <= 380) return 'annual';
  
  return 'irregular';
}

/**
 * Calculate expected next date
 */
function calculateExpectedNext(lastDate: string, frequency: RecurringFrequency, avgInterval: number): string | null {
  if (frequency === 'irregular') return null;
  
  const last = new Date(lastDate);
  let daysToAdd: number;
  
  switch (frequency) {
    case 'weekly':
      daysToAdd = 7;
      break;
    case 'bi-weekly':
      daysToAdd = 14;
      break;
    case 'monthly':
      daysToAdd = 30;
      break;
    case 'quarterly':
      daysToAdd = 91;
      break;
    case 'semi-annual':
      daysToAdd = 182;
      break;
    case 'annual':
      daysToAdd = 365;
      break;
    default:
      daysToAdd = Math.round(avgInterval);
  }
  
  const next = new Date(last.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  return next.toISOString().split('T')[0] ?? null;
}

/**
 * Check if description matches subscription keywords
 */
function isLikelySubscription(description: string, category: string): boolean {
  const lower = description.toLowerCase();
  
  // Check keywords
  if (SUBSCRIPTION_KEYWORDS.some(kw => lower.includes(kw))) {
    return true;
  }
  
  // Check category hints
  if (category === 'Entertainment' || category === 'Utilities') {
    return true;
  }
  
  return false;
}

/**
 * Calculate confidence score for a pattern
 */
function calculateConfidence(
  occurrences: number,
  intervalCV: number,
  amountCV: number,
  frequency: RecurringFrequency
): number {
  let score = 0.5; // Base score
  
  // More occurrences = higher confidence
  if (occurrences >= 3) score += 0.1;
  if (occurrences >= 6) score += 0.1;
  if (occurrences >= 12) score += 0.1;
  
  // Lower interval variance = higher confidence
  if (intervalCV < 0.1) score += 0.1;
  else if (intervalCV < 0.2) score += 0.05;
  
  // Lower amount variance = higher confidence
  if (amountCV < 0.01) score += 0.1;
  else if (amountCV < 0.05) score += 0.05;
  
  // Regular frequency = higher confidence
  if (frequency !== 'irregular') score += 0.05;
  
  return Math.min(1, Math.round(score * 100) / 100);
}

/**
 * Convert frequency to monthly multiplier for cost estimation
 */
function frequencyToMonthlyMultiplier(frequency: RecurringFrequency): number {
  switch (frequency) {
    case 'weekly':
      return 4.33;
    case 'bi-weekly':
      return 2.17;
    case 'monthly':
      return 1;
    case 'quarterly':
      return 1 / 3;
    case 'semi-annual':
      return 1 / 6;
    case 'annual':
      return 1 / 12;
    case 'irregular':
      return 1; // Assume monthly for estimation
  }
}

/**
 * Generate a pattern ID
 */
function generatePatternId(merchantKey: string, direction: string): string {
  const hash = merchantKey
    .split('')
    .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0);
  return `rec_${direction}_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

/**
 * Detect recurring transactions from a list of transactions
 */
export function detectRecurring(
  transactions: RecurringTransaction[],
  options: RecurringDetectionOptions = {}
): RecurringDetectionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Group transactions by merchant key + direction + approximate amount
  const groups = new Map<string, RecurringTransaction[]>();
  
  for (const txn of transactions) {
    const merchantKey = normalizeMerchantKey(txn.description);
    if (merchantKey.length < 3) continue; // Skip very short keys
    
    // Create group key with direction
    const groupKey = `${merchantKey}|${txn.direction}`;
    
    const existing = groups.get(groupKey) ?? [];
    existing.push(txn);
    groups.set(groupKey, existing);
  }
  
  const patterns: RecurringPattern[] = [];
  const recurringTxnIds = new Set<string>();
  
  for (const [groupKey, txns] of Array.from(groups.entries())) {
    // Need minimum occurrences
    if (txns.length < opts.minOccurrences) continue;
    
    // Sort by date
    const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
    
    // Calculate intervals
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev && curr) {
        intervals.push(daysBetween(prev.date, curr.date));
      }
    }
    
    if (intervals.length === 0) continue;
    
    // Calculate statistics
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const intervalStdDev = standardDeviation(intervals);
    const intervalCV = avgInterval > 0 ? intervalStdDev / avgInterval : 1;
    
    // Skip if intervals are too irregular (unless we have many occurrences)
    if (intervalCV > opts.maxIntervalVariance && txns.length < 6) continue;
    
    // Calculate amount statistics
    const amounts = sorted.map(t => Math.abs(t.amount));
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const amountStdDev = standardDeviation(amounts);
    const amountCV = avgAmount > 0 ? amountStdDev / avgAmount : 0;
    
    // Detect frequency
    const frequency = detectFrequency(avgInterval, intervalStdDev);
    
    // Get merchant info
    const [merchantKey, direction] = groupKey.split('|') as [string, 'debit' | 'credit'];
    const firstTxn = sorted[0]!;
    const lastTxn = sorted[sorted.length - 1]!;
    
    // Determine merchant display name
    const merchantName = firstTxn.merchant ?? firstTxn.description.split(/\s+/).slice(0, 3).join(' ');
    
    // Check if subscription
    const isSubscription = isLikelySubscription(firstTxn.description, firstTxn.category) &&
      amountCV < 0.05 && // Fixed or near-fixed amount
      frequency !== 'irregular';
    
    // Calculate confidence
    const confidence = calculateConfidence(txns.length, intervalCV, amountCV, frequency);
    
    // Only include patterns with reasonable confidence
    if (confidence < 0.5) continue;
    
    // Collect transaction IDs
    const transactionIds = sorted.map(t => t.transactionId).filter((id): id is string => id !== undefined);
    transactionIds.forEach(id => recurringTxnIds.add(id));
    
    patterns.push({
      patternId: generatePatternId(merchantKey, direction),
      merchantKey,
      merchantName,
      frequency,
      averageIntervalDays: Math.round(avgInterval * 10) / 10,
      intervalStdDev: Math.round(intervalStdDev * 10) / 10,
      averageAmount: Math.round(avgAmount * 100) / 100,
      amountVariance: Math.round(amountCV * 10000) / 10000,
      isFixedAmount: amountCV < opts.fixedAmountThreshold,
      category: firstTxn.category,
      subcategory: firstTxn.subcategory,
      direction,
      occurrenceCount: txns.length,
      firstSeen: firstTxn.date,
      lastSeen: lastTxn.date,
      expectedNext: calculateExpectedNext(lastTxn.date, frequency, avgInterval),
      confidence,
      isSubscription,
      transactionIds,
    });
  }
  
  // Sort patterns by confidence (descending) then by occurrence count
  patterns.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.occurrenceCount - a.occurrenceCount;
  });
  
  // Calculate summary
  const byFrequency: Record<RecurringFrequency, number> = {
    weekly: 0,
    'bi-weekly': 0,
    monthly: 0,
    quarterly: 0,
    'semi-annual': 0,
    annual: 0,
    irregular: 0,
  };
  
  let estimatedMonthlyRecurring = 0;
  let subscriptionCount = 0;
  
  for (const pattern of patterns) {
    byFrequency[pattern.frequency]++;
    
    if (pattern.direction === 'debit') {
      const monthlyMultiplier = frequencyToMonthlyMultiplier(pattern.frequency);
      estimatedMonthlyRecurring += pattern.averageAmount * monthlyMultiplier;
    }
    
    if (pattern.isSubscription) {
      subscriptionCount++;
    }
  }
  
  const summary: RecurringSummary = {
    totalPatterns: patterns.length,
    totalRecurringTransactions: recurringTxnIds.size,
    recurringPercentage: transactions.length > 0
      ? Math.round((recurringTxnIds.size / transactions.length) * 10000) / 100
      : 0,
    estimatedMonthlyRecurring: Math.round(estimatedMonthlyRecurring * 100) / 100,
    estimatedAnnualRecurring: Math.round(estimatedMonthlyRecurring * 12 * 100) / 100,
    byFrequency,
    subscriptionCount,
  };
  
  return { patterns, summary };
}

/**
 * Detect recurring transactions from parsed statements
 */
export function detectRecurringFromStatements(
  statements: ParsedStatement[],
  options?: RecurringDetectionOptions
): RecurringDetectionResult {
  // Map ParsedStatement transactions to RecurringTransaction interface
  const allTransactions: RecurringTransaction[] = statements.flatMap(s =>
    s.transactions.map(t => ({
      date: t.date,
      description: t.description,
      amount: t.amount,
      direction: t.direction,
      category: t.category,
      subcategory: t.subcategory,
      merchant: t.merchant,
    }))
  );
  return detectRecurring(allTransactions, options);
}

/**
 * Mark transactions with recurring flags
 * Returns a map of transactionId -> pattern info
 */
export function getRecurringFlags(
  result: RecurringDetectionResult
): Map<string, { isRecurring: boolean; isSubscription: boolean; patternId: string }> {
  const flags = new Map<string, { isRecurring: boolean; isSubscription: boolean; patternId: string }>();
  
  for (const pattern of result.patterns) {
    for (const txnId of pattern.transactionIds) {
      flags.set(txnId, {
        isRecurring: true,
        isSubscription: pattern.isSubscription,
        patternId: pattern.patternId,
      });
    }
  }
  
  return flags;
}
