import { describe, it, expect } from 'vitest';
import { parseBoaStatement } from '../../src/parsers/boa/index.js';
import type { ExtractedPDF } from '../../src/extractors/index.js';

const createMockCheckingPDF = (): ExtractedPDF => ({
  pages: [
    {
      pageNumber: 1,
      text: `
Bank of America
Checking Account Statement
Account number: ****5678

Statement period: January 1, 2024 to January 31, 2024

Beginning balance $1,000.00
Ending balance $1,150.00

Deposits and other additions
01/05 PAYROLL DIRECT DEP ACME CORP 500.00
01/15 VENMO PAYMENT FROM JOHN 50.00

Withdrawals and other subtractions
01/10 STARBUCKS STORE 12345 5.75
01/12 AMAZON.COM*ABC123 94.25
01/20 ATM WITHDRAWAL 200.00

Daily ending balance
      `,
      lines: [
        'Bank of America',
        'Checking Account Statement',
        'Account number: ****5678',
        '',
        'Statement period: January 1, 2024 to January 31, 2024',
        '',
        'Beginning balance $1,000.00',
        'Ending balance $1,150.00',
        '',
        'Deposits and other additions',
        '01/05 PAYROLL DIRECT DEP ACME CORP 500.00',
        '01/15 VENMO PAYMENT FROM JOHN 50.00',
        '',
        'Withdrawals and other subtractions',
        '01/10 STARBUCKS STORE 12345 5.75',
        '01/12 AMAZON.COM*ABC123 94.25',
        '01/20 ATM WITHDRAWAL 200.00',
        '',
        'Daily ending balance',
      ],
    },
  ],
  fullText: `
Bank of America
Checking Account Statement
Account number: ****5678

Statement period: January 1, 2024 to January 31, 2024

Beginning balance $1,000.00
Ending balance $1,150.00

Deposits and other additions
01/05 PAYROLL DIRECT DEP ACME CORP 500.00
01/15 VENMO PAYMENT FROM JOHN 50.00

Withdrawals and other subtractions
01/10 STARBUCKS STORE 12345 5.75
01/12 AMAZON.COM*ABC123 94.25
01/20 ATM WITHDRAWAL 200.00

Daily ending balance
  `,
  totalPages: 1,
  metadata: {},
});

describe('parseBoaStatement integration', () => {
  it('should parse a mock checking statement', () => {
    const pdf = createMockCheckingPDF();
    const result = parseBoaStatement(pdf);

    expect(result.success).toBe(true);
    expect(result.statement.account.accountType).toBe('checking');
    expect(result.statement.account.institution).toBe('Bank of America');
    expect(result.statement.account.currency).toBe('USD');
  });

  it('should extract account information', () => {
    const pdf = createMockCheckingPDF();
    const result = parseBoaStatement(pdf);

    expect(result.statement.account.accountNumberMasked).toMatch(/\*{4}\d{4}/);
    expect(result.statement.account.statementPeriod.start).toBe('2024-01-01');
    expect(result.statement.account.statementPeriod.end).toBe('2024-01-31');
  });

  it('should extract balance information', () => {
    const pdf = createMockCheckingPDF();
    const result = parseBoaStatement(pdf);

    expect(result.statement.summary.startingBalance).toBe(1000);
    expect(result.statement.summary.endingBalance).toBe(1150);
  });

  it('should include metadata', () => {
    const pdf = createMockCheckingPDF();
    const result = parseBoaStatement(pdf);

    expect(result.statement.metadata.parserVersion).toBe('1.1.1');
    expect(result.statement.metadata.parsedAt).toBeTruthy();
    expect(Array.isArray(result.statement.metadata.warnings)).toBe(true);
  });

  it('should categorize transactions', () => {
    const pdf = createMockCheckingPDF();
    const result = parseBoaStatement(pdf);

    for (const txn of result.statement.transactions) {
      expect(txn.category).toBeTruthy();
      expect(txn.confidence).toBeGreaterThanOrEqual(0);
      expect(txn.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('should preserve raw transaction data', () => {
    const pdf = createMockCheckingPDF();
    const result = parseBoaStatement(pdf);

    for (const txn of result.statement.transactions) {
      expect(txn.raw.originalText).toBeTruthy();
      expect(txn.raw.page).toBeGreaterThan(0);
    }
  });
});
