/**
 * Unit tests for the Plaid enricher adapter.
 */

import { describe, it, expect } from 'vitest';
import {
  enrichWithPlaid,
  isPlaidEnriched,
  getPlaidMatchStats,
  type EnrichOptions,
} from '../../src/output/plaid-enricher.js';
import type { FinalResultV2 } from '../../src/output/adapters.js';
import type { PlaidTransaction, PlaidAccount, PlaidItem } from '../../src/plaid/types.js';

// Helper to create a minimal FinalResultV2 for testing
function createMockV2Output(transactions: Array<{
  date: string;
  amount: number;
  description: string;
  merchant: string;
  transactionId: string;
}>): FinalResultV2 {
  return {
    schemaVersion: 'v2',
    startingBalance: 1000,
    endingBalance: 900,
    totalStatements: 1,
    totalTransactions: transactions.length,
    analytics: {
      quarterlyCashFlow: [],
      incomeVsExpenses: {
        totalIncome: 0,
        totalExpenses: 100,
        netIncome: -100,
        incomeByCategory: {},
        expensesByCategory: {},
        excludedTransfers: 0,
        periodStart: '2025-01-01',
        periodEnd: '2025-01-31',
      },
      lenderSummary: {
        averageMonthlyIncome: 0,
        averageMonthlyExpenses: 100,
        monthlyIncomeVariance: 0,
        incomeStabilityScore: 50,
        consecutiveMonthsWithIncome: 0,
        totalMonthsAnalyzed: 1,
        monthlyBreakdown: [],
        incomeSourceDiversity: 0,
        regularIncomeDetected: false,
        estimatedAnnualIncome: 0,
      },
      taxPreparation: {
        taxYear: 2025,
        totalTaxableIncome: 0,
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
      },
    },
    accounts: [
      {
        account: {
          institution: 'Bank of America',
          accountType: 'checking',
          accountNumberMasked: '****1234',
          statementPeriod: {
            start: '2025-01-01',
            end: '2025-01-31',
          },
          currency: 'USD',
        },
        summary: {
          startingBalance: 1000,
          endingBalance: 900,
          totalCredits: 0,
          totalDebits: 100,
        },
        transactions: transactions.map((tx) => ({
          date: tx.date,
          postedDate: tx.date,
          description: tx.description,
          merchant: tx.merchant,
          amount: tx.amount,
          direction: 'debit' as const,
          category: 'Shopping',
          subcategory: null,
          confidence: 0.8,
          statementId: 'CHECKING-1234-20250101-20250131',
          periodLabel: '2025-01 BOA Checking',
          transactionId: tx.transactionId,
          raw: {
            originalText: tx.description,
            page: 1,
          },
        })),
        totalStatements: 1,
        totalTransactions: transactions.length,
      },
    ],
  };
}

// Helper to create mock Plaid transactions
function createMockPlaidTransaction(overrides: Partial<PlaidTransaction> = {}): PlaidTransaction {
  return {
    transactionId: 'plaid_tx_123',
    accountId: 'plaid_acc_456',
    amount: 25.00,
    date: '2025-01-15',
    name: 'AMAZON.COM',
    merchantName: 'Amazon',
    paymentChannel: 'online',
    pending: false,
    personalFinanceCategory: {
      primary: 'GENERAL_MERCHANDISE',
      detailed: 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES',
    },
    location: {
      city: 'Seattle',
      region: 'WA',
      country: 'US',
    },
    ...overrides,
  };
}

// Helper to create mock Plaid accounts
function createMockPlaidAccount(overrides: Partial<PlaidAccount> = {}): PlaidAccount {
  return {
    accountId: 'plaid_acc_456',
    itemId: 'plaid_item_789',
    name: 'Checking Account',
    type: 'depository',
    subtype: 'checking',
    mask: '1234',
    balances: {
      available: 900,
      current: 900,
      isoCurrencyCode: 'USD',
    },
    ...overrides,
  };
}

// Helper to create mock Plaid item
function createMockPlaidItem(overrides: Partial<PlaidItem> = {}): PlaidItem {
  return {
    itemId: 'plaid_item_789',
    accessToken: 'access-sandbox-xxx',
    institutionId: 'ins_123',
    institutionName: 'Sandbox Bank',
    userId: 'user_123',
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-15T00:00:00Z',
    lastSyncAt: '2025-01-15T12:00:00Z',
    syncCursor: 'cursor_abc',
    ...overrides,
  };
}

describe('enrichWithPlaid', () => {
  it('should enrich PDF output with matching Plaid transactions', () => {
    const pdfOutput = createMockV2Output([
      {
        date: '2025-01-15',
        amount: 25.00,
        description: 'AMAZON.COM AMZN.COM/BILL',
        merchant: 'Amazon',
        transactionId: 'tx_abc123def456789012345678',
      },
    ]);

    const plaidTransactions = [
      createMockPlaidTransaction({
        transactionId: 'plaid_tx_123',
        date: '2025-01-15',
        amount: 25.00,
        name: 'AMAZON.COM',
        merchantName: 'Amazon',
      }),
    ];

    const plaidAccounts = [createMockPlaidAccount()];
    const plaidItem = createMockPlaidItem();

    const result = enrichWithPlaid(pdfOutput, plaidTransactions, plaidAccounts, plaidItem);

    expect(result.reconciliation.matched).toBe(1);
    expect(result.reconciliation.unmatchedPdf).toBe(0);
    expect(result.reconciliation.unmatchedPlaid).toBe(0);
    expect(result.reconciliation.matchRate).toBe(1);
    expect(result.enrichedOutput.dataSources).toBeDefined();
    expect(result.enrichedOutput.dataSources?.plaid?.itemId).toBe('plaid_item_789');
    expect(result.enrichedOutput.reconciliation).toBeDefined();
  });

  it('should handle unmatched PDF transactions', () => {
    const pdfOutput = createMockV2Output([
      {
        date: '2025-01-15',
        amount: 25.00,
        description: 'AMAZON.COM',
        merchant: 'Amazon',
        transactionId: 'tx_abc123def456789012345678',
      },
      {
        date: '2025-01-20',
        amount: 50.00,
        description: 'WALMART',
        merchant: 'Walmart',
        transactionId: 'tx_def456789012345678901234',
      },
    ]);

    const plaidTransactions = [
      createMockPlaidTransaction({
        transactionId: 'plaid_tx_123',
        date: '2025-01-15',
        amount: 25.00,
        name: 'AMAZON.COM',
        merchantName: 'Amazon',
      }),
    ];

    const plaidAccounts = [createMockPlaidAccount()];

    const result = enrichWithPlaid(pdfOutput, plaidTransactions, plaidAccounts);

    expect(result.reconciliation.matched).toBe(1);
    expect(result.reconciliation.unmatchedPdf).toBe(1);
    expect(result.reconciliation.matchRate).toBe(0.5);
  });

  it('should handle unmatched Plaid transactions', () => {
    const pdfOutput = createMockV2Output([
      {
        date: '2025-01-15',
        amount: 25.00,
        description: 'AMAZON.COM',
        merchant: 'Amazon',
        transactionId: 'tx_abc123def456789012345678',
      },
    ]);

    const plaidTransactions = [
      createMockPlaidTransaction({
        transactionId: 'plaid_tx_123',
        date: '2025-01-15',
        amount: 25.00,
        name: 'AMAZON.COM',
        merchantName: 'Amazon',
      }),
      createMockPlaidTransaction({
        transactionId: 'plaid_tx_456',
        date: '2025-01-20',
        amount: 75.00,
        name: 'TARGET',
        merchantName: 'Target',
      }),
    ];

    const plaidAccounts = [createMockPlaidAccount()];

    const result = enrichWithPlaid(pdfOutput, plaidTransactions, plaidAccounts);

    expect(result.reconciliation.matched).toBe(1);
    expect(result.reconciliation.unmatchedPlaid).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should calculate match breakdown correctly', () => {
    const pdfOutput = createMockV2Output([
      {
        date: '2025-01-15',
        amount: 25.00,
        description: 'AMAZON.COM',
        merchant: 'Amazon',
        transactionId: 'tx_abc123def456789012345678',
      },
    ]);

    const plaidTransactions = [
      createMockPlaidTransaction({
        transactionId: 'plaid_tx_123',
        date: '2025-01-15',
        amount: 25.00,
        name: 'AMAZON.COM',
        merchantName: 'Amazon',
      }),
    ];

    const plaidAccounts = [createMockPlaidAccount()];

    const result = enrichWithPlaid(pdfOutput, plaidTransactions, plaidAccounts);

    expect(result.reconciliation.matchBreakdown).toBeDefined();
    expect(result.reconciliation.matchBreakdown.exact + 
           result.reconciliation.matchBreakdown.fuzzy + 
           result.reconciliation.matchBreakdown.amountDate + 
           result.reconciliation.matchBreakdown.amountOnly).toBe(1);
  });

  it('should include dataSources metadata', () => {
    const pdfOutput = createMockV2Output([]);
    const plaidTransactions: PlaidTransaction[] = [];
    const plaidAccounts = [createMockPlaidAccount()];
    const plaidItem = createMockPlaidItem();

    const options: EnrichOptions = {
      pdfFiles: ['statement1.pdf', 'statement2.pdf'],
      parseDate: '2025-01-15T12:00:00Z',
    };

    const result = enrichWithPlaid(pdfOutput, plaidTransactions, plaidAccounts, plaidItem, options);

    expect(result.enrichedOutput.dataSources?.pdf?.files).toEqual(['statement1.pdf', 'statement2.pdf']);
    expect(result.enrichedOutput.dataSources?.pdf?.parseDate).toBe('2025-01-15T12:00:00Z');
    expect(result.enrichedOutput.dataSources?.plaid?.itemId).toBe('plaid_item_789');
    expect(result.enrichedOutput.dataSources?.plaid?.institutionName).toBe('Sandbox Bank');
    expect(result.enrichedOutput.dataSources?.plaid?.cursor).toBe('cursor_abc');
  });

  it('should warn on low match rate', () => {
    const pdfOutput = createMockV2Output([
      {
        date: '2025-01-15',
        amount: 25.00,
        description: 'AMAZON.COM',
        merchant: 'Amazon',
        transactionId: 'tx_abc123def456789012345678',
      },
      {
        date: '2025-01-16',
        amount: 30.00,
        description: 'STARBUCKS',
        merchant: 'Starbucks',
        transactionId: 'tx_def456789012345678901234',
      },
      {
        date: '2025-01-17',
        amount: 40.00,
        description: 'WALMART',
        merchant: 'Walmart',
        transactionId: 'tx_ghi789012345678901234567',
      },
    ]);

    // Only one matching transaction
    const plaidTransactions = [
      createMockPlaidTransaction({
        transactionId: 'plaid_tx_123',
        date: '2025-01-15',
        amount: 25.00,
        name: 'AMAZON.COM',
        merchantName: 'Amazon',
      }),
    ];

    const plaidAccounts = [createMockPlaidAccount()];

    const result = enrichWithPlaid(pdfOutput, plaidTransactions, plaidAccounts);

    // Match rate is 1/3 = 33%, which is below 50%
    expect(result.warnings.some((w) => w.includes('Low match rate'))).toBe(true);
  });

  it('should respect merge strategy pdf-primary', () => {
    const pdfOutput = createMockV2Output([
      {
        date: '2025-01-15',
        amount: 25.00,
        description: 'AMAZON.COM AMZN.COM/BILL',
        merchant: 'Amazon.com',
        transactionId: 'tx_abc123def456789012345678',
      },
    ]);

    const plaidTransactions = [
      createMockPlaidTransaction({
        transactionId: 'plaid_tx_123',
        date: '2025-01-15',
        amount: 25.00,
        name: 'AMAZON.COM',
        merchantName: 'Amazon',
      }),
    ];

    const plaidAccounts = [createMockPlaidAccount()];

    const result = enrichWithPlaid(pdfOutput, plaidTransactions, plaidAccounts, undefined, {
      mergeStrategy: 'pdf-primary',
    });

    // PDF merchant name should be preserved
    const tx = result.enrichedOutput.accounts[0]?.transactions[0];
    expect(tx?.merchant).toBe('Amazon.com');
  });

  it('should update merchant in plaid-primary mode', () => {
    const pdfOutput = createMockV2Output([
      {
        date: '2025-01-15',
        amount: 25.00,
        description: 'AMAZON.COM AMZN.COM/BILL',
        merchant: 'AMAZON.COM AMZN.COM/BILL',
        transactionId: 'tx_abc123def456789012345678',
      },
    ]);

    const plaidTransactions = [
      createMockPlaidTransaction({
        transactionId: 'plaid_tx_123',
        date: '2025-01-15',
        amount: 25.00,
        name: 'AMAZON.COM',
        merchantName: 'Amazon',
      }),
    ];

    const plaidAccounts = [createMockPlaidAccount()];

    const result = enrichWithPlaid(pdfOutput, plaidTransactions, plaidAccounts, undefined, {
      mergeStrategy: 'plaid-primary',
    });

    // Plaid's cleaner merchant name should be used
    const tx = result.enrichedOutput.accounts[0]?.transactions[0];
    expect(tx?.merchant).toBe('Amazon');
  });
});

describe('isPlaidEnriched', () => {
  it('should return true for enriched output', () => {
    const pdfOutput = createMockV2Output([]);
    const plaidAccounts = [createMockPlaidAccount()];
    const plaidItem = createMockPlaidItem();

    const result = enrichWithPlaid(pdfOutput, [], plaidAccounts, plaidItem);

    expect(isPlaidEnriched(result.enrichedOutput)).toBe(true);
  });

  it('should return false for non-enriched output', () => {
    const pdfOutput = createMockV2Output([]);

    expect(isPlaidEnriched(pdfOutput)).toBe(false);
  });
});

describe('getPlaidMatchStats', () => {
  it('should return correct stats for enriched output', () => {
    const pdfOutput = createMockV2Output([
      {
        date: '2025-01-15',
        amount: 25.00,
        description: 'AMAZON.COM',
        merchant: 'Amazon',
        transactionId: 'tx_abc123def456789012345678',
      },
      {
        date: '2025-01-20',
        amount: 50.00,
        description: 'WALMART',
        merchant: 'Walmart',
        transactionId: 'tx_def456789012345678901234',
      },
    ]);

    const plaidTransactions = [
      createMockPlaidTransaction({
        transactionId: 'plaid_tx_123',
        date: '2025-01-15',
        amount: 25.00,
        name: 'AMAZON.COM',
        merchantName: 'Amazon',
      }),
    ];

    const plaidAccounts = [createMockPlaidAccount()];

    const result = enrichWithPlaid(pdfOutput, plaidTransactions, plaidAccounts);
    const stats = getPlaidMatchStats(result.enrichedOutput);

    expect(stats.totalTransactions).toBe(2);
    expect(stats.matchedTransactions).toBe(1);
    expect(stats.matchRate).toBe(0.5);
  });

  it('should return zero stats for non-enriched output', () => {
    const pdfOutput = createMockV2Output([
      {
        date: '2025-01-15',
        amount: 25.00,
        description: 'AMAZON.COM',
        merchant: 'Amazon',
        transactionId: 'tx_abc123def456789012345678',
      },
    ]);

    const stats = getPlaidMatchStats(pdfOutput);

    expect(stats.totalTransactions).toBe(1);
    expect(stats.matchedTransactions).toBe(0);
    expect(stats.matchRate).toBe(0);
  });
});
