import { describe, it, expect } from 'vitest';
import {
  normalizeTransaction,
  normalizeTransactions,
  mapAccountType,
} from '../../src/plaid/normalizer.js';
import type { PlaidTransaction, PlaidAccount } from '../../src/plaid/types.js';

describe('Plaid Normalizer', () => {
  const createPlaidTransaction = (
    overrides: Partial<PlaidTransaction> = {}
  ): PlaidTransaction => ({
    transactionId: 'plaid_tx_123',
    accountId: 'acc_456',
    amount: 50.00,
    date: '2024-01-15',
    name: 'STARBUCKS STORE 12345',
    paymentChannel: 'in store',
    pending: false,
    ...overrides,
  });

  const createPlaidAccount = (
    overrides: Partial<PlaidAccount> = {}
  ): PlaidAccount => ({
    accountId: 'acc_456',
    itemId: 'item_789',
    name: 'Checking Account',
    type: 'depository',
    subtype: 'checking',
    mask: '1234',
    balances: {
      current: 1000,
      available: 900,
    },
    ...overrides,
  });

  describe('normalizeTransaction', () => {
    it('should normalize a basic transaction', () => {
      const plaidTx = createPlaidTransaction();
      const account = createPlaidAccount();
      const statementId = 'stmt_test_123';

      const result = normalizeTransaction(plaidTx, account, statementId);

      expect(result.date).toBe('2024-01-15');
      expect(result.amount).toBe(50.00);
      expect(result.description).toBe('STARBUCKS STORE 12345');
    });

    it('should set direction based on amount sign', () => {
      const account = createPlaidAccount();
      const statementId = 'stmt_test_123';

      // Positive amount = debit (money out)
      const debitTx = createPlaidTransaction({ amount: 50.00 });
      const debitResult = normalizeTransaction(debitTx, account, statementId);
      expect(debitResult.direction).toBe('debit');

      // Negative amount = credit (money in)
      const creditTx = createPlaidTransaction({ amount: -50.00 });
      const creditResult = normalizeTransaction(creditTx, account, statementId);
      expect(creditResult.direction).toBe('credit');
    });

    it('should use absolute value for amount', () => {
      const account = createPlaidAccount();
      const statementId = 'stmt_test_123';
      const tx = createPlaidTransaction({ amount: -100.00 });

      const result = normalizeTransaction(tx, account, statementId);

      expect(result.amount).toBe(100.00);
    });

    it('should extract merchant name when available', () => {
      const account = createPlaidAccount();
      const statementId = 'stmt_test_123';
      const tx = createPlaidTransaction({
        merchantName: 'Starbucks',
        name: 'STARBUCKS STORE 12345 SAN FRANCISCO CA',
      });

      const result = normalizeTransaction(tx, account, statementId);

      expect(result.merchant.name).toBe('Starbucks');
    });

    it('should map personal finance category', () => {
      const account = createPlaidAccount();
      const statementId = 'stmt_test_123';
      const tx = createPlaidTransaction({
        personalFinanceCategory: {
          primary: 'FOOD_AND_DRINK',
          detailed: 'FOOD_AND_DRINK_COFFEE',
        },
      });

      const result = normalizeTransaction(tx, account, statementId);

      expect(result.categorization.category).toBe('Food & Dining');
    });

    it('should include location in merchant when available', () => {
      const account = createPlaidAccount();
      const statementId = 'stmt_test_123';
      const tx = createPlaidTransaction({
        location: {
          city: 'San Francisco',
          region: 'CA',
          country: 'US',
        },
      });

      const result = normalizeTransaction(tx, account, statementId);

      expect(result.merchant.city).toBe('San Francisco');
      expect(result.merchant.state).toBe('CA');
    });

    it('should handle check transactions', () => {
      const account = createPlaidAccount();
      const statementId = 'stmt_test_123';
      const tx = createPlaidTransaction({
        checkNumber: '1234',
        name: 'CHECK 1234',
      });

      const result = normalizeTransaction(tx, account, statementId);

      expect(result.bankReference.checkNumber).toBe('1234');
    });
  });

  describe('normalizeTransactions', () => {
    it('should normalize multiple transactions', () => {
      const accounts = [createPlaidAccount()];
      const transactions = [
        createPlaidTransaction({ transactionId: 'tx_1', amount: 50 }),
        createPlaidTransaction({ transactionId: 'tx_2', amount: 75 }),
        createPlaidTransaction({ transactionId: 'tx_3', amount: 100 }),
      ];

      const results = normalizeTransactions(transactions, accounts);

      expect(results.length).toBe(3);
    });

    it('should handle empty array', () => {
      const accounts = [createPlaidAccount()];
      const results = normalizeTransactions([], accounts);

      expect(results).toEqual([]);
    });

    it('should skip transactions with unknown account', () => {
      const accounts = [createPlaidAccount({ accountId: 'acc_different' })];
      const transactions = [
        createPlaidTransaction({ transactionId: 'tx_1', accountId: 'acc_456' }),
      ];

      const results = normalizeTransactions(transactions, accounts);

      expect(results.length).toBe(0);
    });
  });

  describe('mapAccountType', () => {
    it('should map depository/checking to checking', () => {
      expect(mapAccountType('depository', 'checking')).toBe('checking');
    });

    it('should map depository/savings to savings', () => {
      expect(mapAccountType('depository', 'savings')).toBe('savings');
    });

    it('should map credit to credit', () => {
      expect(mapAccountType('credit', 'credit card')).toBe('credit');
    });

    it('should default to checking for unknown types', () => {
      expect(mapAccountType('investment', 'brokerage')).toBe('checking');
      expect(mapAccountType('loan', 'mortgage')).toBe('checking');
    });

    it('should handle undefined subtype', () => {
      expect(mapAccountType('depository', undefined)).toBe('checking');
    });
  });
});
