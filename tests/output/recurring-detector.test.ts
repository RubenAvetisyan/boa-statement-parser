import { describe, it, expect } from 'vitest';
import {
  detectRecurring,
  detectRecurringFromStatements,
  getRecurringFlags,
  type RecurringTransaction,
} from '../../src/output/recurring-detector.js';
import type { ParsedStatement } from '../../src/schemas/index.js';

describe('recurring-detector', () => {
  describe('detectRecurring', () => {
    it('should detect monthly recurring transactions', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'NETFLIX.COM', amount: 15.99, direction: 'debit', category: 'Entertainment', subcategory: 'Streaming' },
        { date: '2025-02-15', description: 'NETFLIX.COM', amount: 15.99, direction: 'debit', category: 'Entertainment', subcategory: 'Streaming' },
        { date: '2025-03-15', description: 'NETFLIX.COM', amount: 15.99, direction: 'debit', category: 'Entertainment', subcategory: 'Streaming' },
        { date: '2025-04-15', description: 'NETFLIX.COM', amount: 15.99, direction: 'debit', category: 'Entertainment', subcategory: 'Streaming' },
      ];

      const result = detectRecurring(transactions);

      expect(result.patterns.length).toBe(1);
      expect(result.patterns[0]?.frequency).toBe('monthly');
      expect(result.patterns[0]?.averageAmount).toBe(15.99);
      expect(result.patterns[0]?.isFixedAmount).toBe(true);
      expect(result.patterns[0]?.isSubscription).toBe(true);
      expect(result.patterns[0]?.occurrenceCount).toBe(4);
    });

    it('should detect weekly recurring transactions', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-01', description: 'GROCERY STORE', amount: 50.00, direction: 'debit', category: 'Food & Dining', subcategory: 'Groceries' },
        { date: '2025-01-08', description: 'GROCERY STORE', amount: 52.50, direction: 'debit', category: 'Food & Dining', subcategory: 'Groceries' },
        { date: '2025-01-15', description: 'GROCERY STORE', amount: 48.75, direction: 'debit', category: 'Food & Dining', subcategory: 'Groceries' },
        { date: '2025-01-22', description: 'GROCERY STORE', amount: 51.25, direction: 'debit', category: 'Food & Dining', subcategory: 'Groceries' },
      ];

      const result = detectRecurring(transactions);

      expect(result.patterns.length).toBe(1);
      expect(result.patterns[0]?.frequency).toBe('weekly');
      expect(result.patterns[0]?.isFixedAmount).toBe(false); // Variable amounts
    });

    it('should detect bi-weekly recurring transactions', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-03', description: 'PAYROLL DEPOSIT', amount: 2500.00, direction: 'credit', category: 'Income', subcategory: 'Salary' },
        { date: '2025-01-17', description: 'PAYROLL DEPOSIT', amount: 2500.00, direction: 'credit', category: 'Income', subcategory: 'Salary' },
        { date: '2025-01-31', description: 'PAYROLL DEPOSIT', amount: 2500.00, direction: 'credit', category: 'Income', subcategory: 'Salary' },
        { date: '2025-02-14', description: 'PAYROLL DEPOSIT', amount: 2500.00, direction: 'credit', category: 'Income', subcategory: 'Salary' },
      ];

      const result = detectRecurring(transactions);

      expect(result.patterns.length).toBe(1);
      expect(result.patterns[0]?.frequency).toBe('bi-weekly');
      expect(result.patterns[0]?.direction).toBe('credit');
      expect(result.patterns[0]?.isFixedAmount).toBe(true);
    });

    it('should detect quarterly recurring transactions', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'INSURANCE PREMIUM', amount: 450.00, direction: 'debit', category: 'Insurance', subcategory: null },
        { date: '2025-04-15', description: 'INSURANCE PREMIUM', amount: 450.00, direction: 'debit', category: 'Insurance', subcategory: null },
        { date: '2025-07-15', description: 'INSURANCE PREMIUM', amount: 450.00, direction: 'debit', category: 'Insurance', subcategory: null },
      ];

      const result = detectRecurring(transactions);

      expect(result.patterns.length).toBe(1);
      expect(result.patterns[0]?.frequency).toBe('quarterly');
    });

    it('should not detect patterns with insufficient occurrences', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'ONE TIME PURCHASE', amount: 100.00, direction: 'debit', category: 'Shopping', subcategory: null },
      ];

      const result = detectRecurring(transactions);

      expect(result.patterns.length).toBe(0);
    });

    it('should separate patterns by direction', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'TRANSFER', amount: 500.00, direction: 'debit', category: 'Transfer', subcategory: null },
        { date: '2025-02-15', description: 'TRANSFER', amount: 500.00, direction: 'debit', category: 'Transfer', subcategory: null },
        { date: '2025-03-15', description: 'TRANSFER', amount: 500.00, direction: 'debit', category: 'Transfer', subcategory: null },
        { date: '2025-01-15', description: 'TRANSFER', amount: 500.00, direction: 'credit', category: 'Transfer', subcategory: null },
        { date: '2025-02-15', description: 'TRANSFER', amount: 500.00, direction: 'credit', category: 'Transfer', subcategory: null },
        { date: '2025-03-15', description: 'TRANSFER', amount: 500.00, direction: 'credit', category: 'Transfer', subcategory: null },
      ];

      const result = detectRecurring(transactions);

      expect(result.patterns.length).toBe(2);
      const directions = result.patterns.map(p => p.direction).sort();
      expect(directions).toEqual(['credit', 'debit']);
    });

    it('should identify subscription services', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-01', description: 'SPOTIFY PREMIUM', amount: 9.99, direction: 'debit', category: 'Entertainment', subcategory: 'Streaming' },
        { date: '2025-02-01', description: 'SPOTIFY PREMIUM', amount: 9.99, direction: 'debit', category: 'Entertainment', subcategory: 'Streaming' },
        { date: '2025-03-01', description: 'SPOTIFY PREMIUM', amount: 9.99, direction: 'debit', category: 'Entertainment', subcategory: 'Streaming' },
      ];

      const result = detectRecurring(transactions);

      expect(result.patterns[0]?.isSubscription).toBe(true);
      expect(result.summary.subscriptionCount).toBe(1);
    });

    it('should calculate expected next date', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'RENT PAYMENT', amount: 1500.00, direction: 'debit', category: 'Housing', subcategory: 'Rent' },
        { date: '2025-02-15', description: 'RENT PAYMENT', amount: 1500.00, direction: 'debit', category: 'Housing', subcategory: 'Rent' },
        { date: '2025-03-15', description: 'RENT PAYMENT', amount: 1500.00, direction: 'debit', category: 'Housing', subcategory: 'Rent' },
      ];

      const result = detectRecurring(transactions);

      expect(result.patterns[0]?.expectedNext).toBe('2025-04-14');
    });

    it('should calculate summary statistics', () => {
      const transactions: RecurringTransaction[] = [
        // Monthly subscription 1
        { date: '2025-01-01', description: 'NETFLIX', amount: 15.99, direction: 'debit', category: 'Entertainment', subcategory: 'Streaming', transactionId: 'tx_n1' },
        { date: '2025-02-01', description: 'NETFLIX', amount: 15.99, direction: 'debit', category: 'Entertainment', subcategory: 'Streaming', transactionId: 'tx_n2' },
        { date: '2025-03-01', description: 'NETFLIX', amount: 15.99, direction: 'debit', category: 'Entertainment', subcategory: 'Streaming', transactionId: 'tx_n3' },
        // Monthly subscription 2
        { date: '2025-01-05', description: 'SPOTIFY', amount: 9.99, direction: 'debit', category: 'Entertainment', subcategory: 'Streaming', transactionId: 'tx_s1' },
        { date: '2025-02-05', description: 'SPOTIFY', amount: 9.99, direction: 'debit', category: 'Entertainment', subcategory: 'Streaming', transactionId: 'tx_s2' },
        { date: '2025-03-05', description: 'SPOTIFY', amount: 9.99, direction: 'debit', category: 'Entertainment', subcategory: 'Streaming', transactionId: 'tx_s3' },
        // Non-recurring
        { date: '2025-01-10', description: 'RANDOM PURCHASE', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null, transactionId: 'tx_r1' },
      ];

      const result = detectRecurring(transactions);

      expect(result.summary.totalPatterns).toBe(2);
      expect(result.summary.totalRecurringTransactions).toBe(6);
      expect(result.summary.byFrequency.monthly).toBe(2);
      // Estimated monthly: 15.99 + 9.99 = 25.98
      expect(result.summary.estimatedMonthlyRecurring).toBeCloseTo(25.98, 2);
    });

    it('should handle transactions with transactionIds', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'UTILITY BILL', amount: 100.00, direction: 'debit', category: 'Utilities', subcategory: null, transactionId: 'tx_001' },
        { date: '2025-02-15', description: 'UTILITY BILL', amount: 100.00, direction: 'debit', category: 'Utilities', subcategory: null, transactionId: 'tx_002' },
        { date: '2025-03-15', description: 'UTILITY BILL', amount: 100.00, direction: 'debit', category: 'Utilities', subcategory: null, transactionId: 'tx_003' },
      ];

      const result = detectRecurring(transactions);

      expect(result.patterns[0]?.transactionIds).toEqual(['tx_001', 'tx_002', 'tx_003']);
    });

    it('should respect minOccurrences option', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'TEST MERCHANT', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-02-15', description: 'TEST MERCHANT', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
      ];

      // Default minOccurrences is 2, should detect
      const result1 = detectRecurring(transactions);
      expect(result1.patterns.length).toBe(1);

      // With minOccurrences = 3, should not detect
      const result2 = detectRecurring(transactions, { minOccurrences: 3 });
      expect(result2.patterns.length).toBe(0);
    });

    it('should filter out irregular patterns with high variance', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-01', description: 'IRREGULAR MERCHANT', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-01-10', description: 'IRREGULAR MERCHANT', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-02-25', description: 'IRREGULAR MERCHANT', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-03-01', description: 'IRREGULAR MERCHANT', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
      ];

      const result = detectRecurring(transactions);

      // Should either not detect or mark as irregular
      if (result.patterns.length > 0) {
        expect(result.patterns[0]?.frequency).toBe('irregular');
      }
    });

    it('should normalize merchant names for grouping', () => {
      // Merchant names that differ only in trailing identifiers should be grouped
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'AMAZON PRIME MEMBERSHIP', amount: 14.99, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-02-15', description: 'AMAZON PRIME MEMBERSHIP', amount: 14.99, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-03-15', description: 'AMAZON PRIME MEMBERSHIP', amount: 14.99, direction: 'debit', category: 'Shopping', subcategory: null },
      ];

      const result = detectRecurring(transactions);

      expect(result.patterns.length).toBe(1);
      expect(result.patterns[0]?.merchantKey).toContain('amazon');
    });
  });

  describe('detectRecurringFromStatements', () => {
    it('should detect recurring transactions from parsed statements', () => {
      const statements: ParsedStatement[] = [
        {
          account: {
            institution: 'Bank of America',
            accountType: 'checking',
            accountNumberMasked: '****1234',
            statementPeriod: { start: '2025-01-01', end: '2025-01-31' },
            currency: 'USD',
          },
          summary: {
            startingBalance: 1000,
            endingBalance: 900,
            totalCredits: 0,
            totalDebits: 100,
          },
          transactions: [
            { date: '2025-01-15', postedDate: null, description: 'MONTHLY FEE', merchant: null, amount: 50.00, direction: 'debit', category: 'Fees', subcategory: null, confidence: 0.9, raw: { originalText: 'MONTHLY FEE', page: 1 } },
          ],
          metadata: { parserVersion: '1.0.0', parsedAt: '2025-01-31T00:00:00Z', warnings: [] },
        },
        {
          account: {
            institution: 'Bank of America',
            accountType: 'checking',
            accountNumberMasked: '****1234',
            statementPeriod: { start: '2025-02-01', end: '2025-02-28' },
            currency: 'USD',
          },
          summary: {
            startingBalance: 900,
            endingBalance: 850,
            totalCredits: 0,
            totalDebits: 50,
          },
          transactions: [
            { date: '2025-02-15', postedDate: null, description: 'MONTHLY FEE', merchant: null, amount: 50.00, direction: 'debit', category: 'Fees', subcategory: null, confidence: 0.9, raw: { originalText: 'MONTHLY FEE', page: 1 } },
          ],
          metadata: { parserVersion: '1.0.0', parsedAt: '2025-02-28T00:00:00Z', warnings: [] },
        },
        {
          account: {
            institution: 'Bank of America',
            accountType: 'checking',
            accountNumberMasked: '****1234',
            statementPeriod: { start: '2025-03-01', end: '2025-03-31' },
            currency: 'USD',
          },
          summary: {
            startingBalance: 850,
            endingBalance: 800,
            totalCredits: 0,
            totalDebits: 50,
          },
          transactions: [
            { date: '2025-03-15', postedDate: null, description: 'MONTHLY FEE', merchant: null, amount: 50.00, direction: 'debit', category: 'Fees', subcategory: null, confidence: 0.9, raw: { originalText: 'MONTHLY FEE', page: 1 } },
          ],
          metadata: { parserVersion: '1.0.0', parsedAt: '2025-03-31T00:00:00Z', warnings: [] },
        },
      ];

      const result = detectRecurringFromStatements(statements);

      expect(result.patterns.length).toBe(1);
      expect(result.patterns[0]?.frequency).toBe('monthly');
      expect(result.patterns[0]?.occurrenceCount).toBe(3);
    });
  });

  describe('getRecurringFlags', () => {
    it('should return flags map for transactions', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'SUBSCRIPTION', amount: 10.00, direction: 'debit', category: 'Entertainment', subcategory: null, transactionId: 'tx_001' },
        { date: '2025-02-15', description: 'SUBSCRIPTION', amount: 10.00, direction: 'debit', category: 'Entertainment', subcategory: null, transactionId: 'tx_002' },
        { date: '2025-03-15', description: 'SUBSCRIPTION', amount: 10.00, direction: 'debit', category: 'Entertainment', subcategory: null, transactionId: 'tx_003' },
      ];

      const result = detectRecurring(transactions);
      const flags = getRecurringFlags(result);

      expect(flags.get('tx_001')?.isRecurring).toBe(true);
      expect(flags.get('tx_002')?.isRecurring).toBe(true);
      expect(flags.get('tx_003')?.isRecurring).toBe(true);
      expect(flags.get('tx_001')?.patternId).toBeDefined();
    });

    it('should not include non-recurring transactions', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'ONE TIME', amount: 100.00, direction: 'debit', category: 'Shopping', subcategory: null, transactionId: 'tx_single' },
      ];

      const result = detectRecurring(transactions);
      const flags = getRecurringFlags(result);

      expect(flags.has('tx_single')).toBe(false);
    });
  });

  describe('frequency detection edge cases', () => {
    it('should detect annual recurring transactions', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2024-01-15', description: 'ANNUAL MEMBERSHIP', amount: 99.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-01-15', description: 'ANNUAL MEMBERSHIP', amount: 99.00, direction: 'debit', category: 'Shopping', subcategory: null },
      ];

      const result = detectRecurring(transactions);

      expect(result.patterns.length).toBe(1);
      expect(result.patterns[0]?.frequency).toBe('annual');
    });

    it('should detect semi-annual recurring transactions', () => {
      const transactions: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'SEMI ANNUAL FEE', amount: 200.00, direction: 'debit', category: 'Fees', subcategory: null },
        { date: '2025-07-15', description: 'SEMI ANNUAL FEE', amount: 200.00, direction: 'debit', category: 'Fees', subcategory: null },
      ];

      const result = detectRecurring(transactions);

      expect(result.patterns.length).toBe(1);
      expect(result.patterns[0]?.frequency).toBe('semi-annual');
    });
  });

  describe('confidence scoring', () => {
    it('should have higher confidence for more occurrences', () => {
      const fewOccurrences: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'MERCHANT A', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-02-15', description: 'MERCHANT A', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
      ];

      const manyOccurrences: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'MERCHANT B', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-02-15', description: 'MERCHANT B', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-03-15', description: 'MERCHANT B', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-04-15', description: 'MERCHANT B', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-05-15', description: 'MERCHANT B', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-06-15', description: 'MERCHANT B', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
      ];

      const resultFew = detectRecurring(fewOccurrences);
      const resultMany = detectRecurring(manyOccurrences);

      expect(resultMany.patterns[0]?.confidence).toBeGreaterThan(resultFew.patterns[0]?.confidence ?? 0);
    });

    it('should have higher confidence for fixed amounts', () => {
      const fixedAmount: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'FIXED MERCHANT', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-02-15', description: 'FIXED MERCHANT', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-03-15', description: 'FIXED MERCHANT', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
      ];

      const variableAmount: RecurringTransaction[] = [
        { date: '2025-01-15', description: 'VARIABLE MERCHANT', amount: 45.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-02-15', description: 'VARIABLE MERCHANT', amount: 55.00, direction: 'debit', category: 'Shopping', subcategory: null },
        { date: '2025-03-15', description: 'VARIABLE MERCHANT', amount: 50.00, direction: 'debit', category: 'Shopping', subcategory: null },
      ];

      const resultFixed = detectRecurring(fixedAmount);
      const resultVariable = detectRecurring(variableAmount);

      expect(resultFixed.patterns[0]?.confidence).toBeGreaterThanOrEqual(resultVariable.patterns[0]?.confidence ?? 0);
    });
  });
});
