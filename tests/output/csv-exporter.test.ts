import { describe, it, expect } from 'vitest';
import { exportCsv, exportAccountCsv, exportCsvByAccount } from '../../src/output/csv-exporter.js';
import type { FinalResultV2 } from '../../src/output/adapters.js';

const createMockV2Result = (): FinalResultV2 => ({
  schemaVersion: 'v2',
  startingBalance: 1000,
  endingBalance: 1150,
  totalStatements: 1,
  totalTransactions: 2,
  analytics: {
    quarterlyCashFlow: [],
    incomeVsExpenses: {
      totalIncome: 200,
      totalExpenses: 50,
      netIncome: 150,
      incomeByCategory: {},
      expensesByCategory: {},
      excludedTransfers: 0,
      periodStart: '2025-01-01',
      periodEnd: '2025-01-31',
    },
    lenderSummary: {
      averageMonthlyIncome: 200,
      averageMonthlyExpenses: 50,
      monthlyIncomeVariance: 0,
      incomeStabilityScore: 100,
      consecutiveMonthsWithIncome: 1,
      totalMonthsAnalyzed: 1,
      monthlyBreakdown: [],
      incomeSourceDiversity: 1,
      regularIncomeDetected: true,
      estimatedAnnualIncome: 2400,
    },
    taxPreparation: {
      taxYear: 2025,
      totalTaxableIncome: 200,
      totalDeductibleExpenses: 0,
      potentialDeductions: [],
      incomeCategories: [],
      reviewRequired: [],
      summary: {
        businessExpenses: 0,
        medicalExpenses: 0,
        charitableContributions: 0,
        homeOffice: 0,
        professionalServices: 0,
        otherDeductible: 0,
      },
    },
  },
  integrity: {
    overallValid: true,
    statementsChecked: 1,
    statementsWithIssues: 0,
    statementResults: [],
    summary: {
      totalDiscrepancies: 0,
      totalDelta: 0,
      warnings: [],
      epsilon: 0.01,
    },
  },
  accounts: [
    {
      account: {
        institution: 'Bank of America',
        accountType: 'checking',
        accountNumberMasked: '****3529',
        statementPeriod: {
          start: '2025-01-01',
          end: '2025-01-31',
        },
        currency: 'USD',
      },
      summary: {
        startingBalance: 1000,
        endingBalance: 1150,
        totalCredits: 200,
        totalDebits: 50,
      },
      transactions: [
        {
          date: '2025-01-15',
          postedDate: '2025-01-16',
          description: 'Direct Deposit ACME Corp',
          merchant: 'ACME Corp',
          amount: 200,
          direction: 'credit',
          category: 'Income',
          subcategory: 'Salary',
          confidence: 0.95,
          statementId: 'BOA-checking-****3529-2025-01-01-2025-01-31',
          periodLabel: '2025-01 BOA Checking',
          transactionId: 'tx_abcdef1234567890abcdef12',
          raw: {
            originalText: '01/15 01/16 Direct Deposit ACME Corp 200.00',
            page: 1,
          },
        },
        {
          date: '2025-01-20',
          postedDate: null,
          description: 'CHECKCARD 0120 AMAZON MKTPLACE',
          merchant: 'Amazon',
          amount: -50,
          direction: 'debit',
          category: 'Shopping',
          subcategory: 'Online',
          confidence: 0.9,
          statementId: 'BOA-checking-****3529-2025-01-01-2025-01-31',
          periodLabel: '2025-01 BOA Checking',
          transactionId: 'tx_123456789012345678901234',
          raw: {
            originalText: '01/20 CHECKCARD 0120 AMAZON MKTPLACE -50.00',
            page: 2,
          },
        },
      ],
      totalStatements: 1,
      totalTransactions: 2,
    },
  ],
});

describe('csv-exporter', () => {
  describe('exportCsv', () => {
    it('should generate CSV with header row by default', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result);
      const lines = csv.split('\n');

      expect(lines[0]).toContain('Date');
      expect(lines[0]).toContain('Description');
      expect(lines[0]).toContain('Amount');
      expect(lines[0]).toContain('Direction');
    });

    it('should include all base columns', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result);
      const header = csv.split('\n')[0]!;

      expect(header).toContain('Date');
      expect(header).toContain('Posted Date');
      expect(header).toContain('Description');
      expect(header).toContain('Merchant');
      expect(header).toContain('Amount');
      expect(header).toContain('Direction');
      expect(header).toContain('Type');
    });

    it('should include account columns by default', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result);
      const header = csv.split('\n')[0]!;

      expect(header).toContain('Account Type');
      expect(header).toContain('Account Number');
    });

    it('should include category columns by default', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result);
      const header = csv.split('\n')[0]!;

      expect(header).toContain('Category');
      expect(header).toContain('Subcategory');
      expect(header).toContain('Confidence');
    });

    it('should not include raw columns by default', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result);
      const header = csv.split('\n')[0]!;

      expect(header).not.toContain('Transaction ID');
      expect(header).not.toContain('Statement ID');
      expect(header).not.toContain('Original Text');
    });

    it('should include raw columns when requested', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result, { includeRaw: true });
      const header = csv.split('\n')[0]!;

      expect(header).toContain('Transaction ID');
      expect(header).toContain('Statement ID');
      expect(header).toContain('Period Label');
      expect(header).toContain('Original Text');
      expect(header).toContain('Page');
    });

    it('should generate correct number of data rows', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result);
      const lines = csv.split('\n');

      // 1 header + 2 transactions
      expect(lines).toHaveLength(3);
    });

    it('should exclude header when requested', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result, { includeHeader: false });
      const lines = csv.split('\n');

      // Only 2 data rows
      expect(lines).toHaveLength(2);
      expect(lines[0]).not.toContain('Date,');
    });

    it('should format credit amounts as positive', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result);

      expect(csv).toContain('200.00');
    });

    it('should format debit amounts as negative', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result);

      expect(csv).toContain('-50.00');
    });

    it('should use ISO date format by default', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result);

      expect(csv).toContain('2025-01-15');
      expect(csv).toContain('2025-01-16');
    });

    it('should use US date format when requested', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result, { dateFormat: 'us' });

      expect(csv).toContain('01/15/2025');
      expect(csv).toContain('01/16/2025');
    });

    it('should handle null postedDate', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result);
      const lines = csv.split('\n');

      // Second transaction has null postedDate
      const secondTxn = lines[2]!;
      // Should have empty field for posted date
      expect(secondTxn).toContain('2025-01-20,,');
    });

    it('should escape values with commas', () => {
      const v2Result = createMockV2Result();
      v2Result.accounts[0]!.transactions[0]!.description = 'Payment to John, Jane';
      const csv = exportCsv(v2Result);

      expect(csv).toContain('"Payment to John, Jane"');
    });

    it('should escape values with quotes', () => {
      const v2Result = createMockV2Result();
      v2Result.accounts[0]!.transactions[0]!.description = 'Payment for "Services"';
      const csv = exportCsv(v2Result);

      expect(csv).toContain('"Payment for ""Services"""');
    });

    it('should escape values with newlines', () => {
      const v2Result = createMockV2Result();
      v2Result.accounts[0]!.transactions[0]!.description = 'Line1\nLine2';
      const csv = exportCsv(v2Result);

      expect(csv).toContain('"Line1\nLine2"');
    });

    it('should use custom delimiter', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result, { delimiter: ';' });

      expect(csv).toContain('Date;');
      expect(csv).not.toContain('Date,');
    });

    it('should sort transactions by date', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result);
      const lines = csv.split('\n');

      // First data row should be 2025-01-15
      expect(lines[1]).toContain('2025-01-15');
      // Second data row should be 2025-01-20
      expect(lines[2]).toContain('2025-01-20');
    });

    it('should be deterministic (same input = same output)', () => {
      const v2Result = createMockV2Result();
      const csv1 = exportCsv(v2Result);
      const csv2 = exportCsv(v2Result);

      expect(csv1).toBe(csv2);
    });
  });

  describe('transaction type detection', () => {
    it('should detect Deposit type', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result);

      // "Direct Deposit" should map to Deposit
      expect(csv).toContain('Deposit');
    });

    it('should detect Purchase type for CHECKCARD', () => {
      const v2Result = createMockV2Result();
      v2Result.accounts[0]!.transactions[1]!.description = 'CHECKCARD PURCHASE WALMART';
      const csv = exportCsv(v2Result);

      // "CHECKCARD" should map to Purchase
      expect(csv).toContain(',Purchase,');
    });

    it('should detect ATM type', () => {
      const v2Result = createMockV2Result();
      v2Result.accounts[0]!.transactions[0]!.description = 'ATM WITHDRAWAL';
      const csv = exportCsv(v2Result);

      expect(csv).toContain(',ATM,');
    });

    it('should detect Transfer type for Zelle', () => {
      const v2Result = createMockV2Result();
      v2Result.accounts[0]!.transactions[0]!.description = 'ZELLE PAYMENT TO JOHN';
      const csv = exportCsv(v2Result);

      expect(csv).toContain(',Transfer,');
    });

    it('should detect Fee type', () => {
      const v2Result = createMockV2Result();
      v2Result.accounts[0]!.transactions[1]!.description = 'Monthly Maintenance Fee';
      const csv = exportCsv(v2Result);

      expect(csv).toContain(',Fee,');
    });

    it('should detect Check type', () => {
      const v2Result = createMockV2Result();
      v2Result.accounts[0]!.transactions[1]!.description = 'CHECK #1234';
      const csv = exportCsv(v2Result);

      expect(csv).toContain(',Check,');
    });

    it('should detect Payment type for ACH', () => {
      const v2Result = createMockV2Result();
      v2Result.accounts[0]!.transactions[1]!.description = 'ACH PAYMENT TO UTILITY';
      const csv = exportCsv(v2Result);

      expect(csv).toContain(',Payment,');
    });

    it('should detect Interest type', () => {
      const v2Result = createMockV2Result();
      v2Result.accounts[0]!.transactions[0]!.description = 'INTEREST PAYMENT';
      const csv = exportCsv(v2Result);

      expect(csv).toContain(',Interest,');
    });
  });

  describe('exportAccountCsv', () => {
    it('should export single account', () => {
      const v2Result = createMockV2Result();
      const accountBlock = v2Result.accounts[0];

      if (accountBlock === undefined) {
        throw new Error('Test setup error: no account block');
      }

      const csv = exportAccountCsv(accountBlock);
      const lines = csv.split('\n');

      // 1 header + 2 transactions
      expect(lines).toHaveLength(3);
    });

    it('should include header by default', () => {
      const v2Result = createMockV2Result();
      const accountBlock = v2Result.accounts[0]!;
      const csv = exportAccountCsv(accountBlock);

      expect(csv.split('\n')[0]).toContain('Date');
    });
  });

  describe('exportCsvByAccount', () => {
    it('should split accounts into separate results', () => {
      const v2Result = createMockV2Result();
      // Add a second account
      v2Result.accounts.push({
        ...v2Result.accounts[0]!,
        account: {
          ...v2Result.accounts[0]!.account,
          accountType: 'savings',
          accountNumberMasked: '****4971',
        },
      });

      const results = exportCsvByAccount(v2Result);

      expect(results).toHaveLength(2);
      expect(results[0]!.accountType).toBe('checking');
      expect(results[0]!.accountLast4).toBe('3529');
      expect(results[0]!.filename).toBe('boa_checking_3529.csv');
      expect(results[1]!.accountType).toBe('savings');
      expect(results[1]!.accountLast4).toBe('4971');
      expect(results[1]!.filename).toBe('boa_savings_4971.csv');
    });

    it('should generate valid CSV content for each account', () => {
      const v2Result = createMockV2Result();
      const results = exportCsvByAccount(v2Result);

      expect(results[0]!.content).toContain('Date');
      expect(results[0]!.content).toContain('checking');
    });
  });

  describe('column exclusion options', () => {
    it('should exclude account columns when requested', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result, { includeAccountInfo: false });
      const header = csv.split('\n')[0]!;

      expect(header).not.toContain('Account Type');
      expect(header).not.toContain('Account Number');
    });

    it('should exclude category columns when requested', () => {
      const v2Result = createMockV2Result();
      const csv = exportCsv(v2Result, { includeCategories: false });
      const header = csv.split('\n')[0]!;

      expect(header).not.toContain('Category');
      expect(header).not.toContain('Subcategory');
      expect(header).not.toContain('Confidence');
    });
  });
});
