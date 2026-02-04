import { describe, it, expect } from 'vitest';
import { isPlaidError } from '../../src/plaid/types.js';
import type { PlaidTransaction, PlaidAccount, PlaidItem } from '../../src/plaid/types.js';

describe('Plaid Type Guards', () => {
  describe('isPlaidError', () => {
    it('should return true for valid Plaid error objects', () => {
      const error = {
        errorType: 'INVALID_REQUEST',
        errorCode: 'INVALID_FIELD',
        errorMessage: 'Invalid field',
        displayMessage: 'Something went wrong',
      };
      expect(isPlaidError(error)).toBe(true);
    });

    it('should return false for non-object values', () => {
      expect(isPlaidError(null)).toBe(false);
      expect(isPlaidError(undefined)).toBe(false);
      expect(isPlaidError('error')).toBe(false);
      expect(isPlaidError(123)).toBe(false);
    });

    it('should return false for objects missing required fields', () => {
      expect(isPlaidError({ errorType: 'TEST' })).toBe(false);
      expect(isPlaidError({ errorCode: 'TEST' })).toBe(false);
      expect(isPlaidError({ errorMessage: 'TEST' })).toBe(false);
    });

    it('should return true for minimal valid error', () => {
      expect(isPlaidError({
        errorType: 'TEST',
        errorCode: 'TEST',
        errorMessage: 'TEST',
      })).toBe(true);
    });
  });
});

describe('Plaid Types', () => {
  describe('PlaidTransaction', () => {
    it('should have required fields', () => {
      const transaction: PlaidTransaction = {
        transactionId: 'tx_123',
        accountId: 'acc_456',
        amount: 100.50,
        date: '2024-01-15',
        name: 'Test Transaction',
        paymentChannel: 'online',
        pending: false,
      };
      expect(transaction.transactionId).toBe('tx_123');
      expect(transaction.amount).toBe(100.50);
      expect(transaction.pending).toBe(false);
    });

    it('should support optional fields', () => {
      const transaction: PlaidTransaction = {
        transactionId: 'tx_123',
        accountId: 'acc_456',
        amount: 100.50,
        date: '2024-01-15',
        name: 'Test Transaction',
        paymentChannel: 'online',
        pending: false,
        merchantName: 'Test Merchant',
        isoCurrencyCode: 'USD',
        personalFinanceCategory: {
          primary: 'FOOD_AND_DRINK',
          detailed: 'FOOD_AND_DRINK_RESTAURANT',
        },
        location: {
          city: 'San Francisco',
          region: 'CA',
          country: 'US',
        },
      };
      expect(transaction.merchantName).toBe('Test Merchant');
      expect(transaction.personalFinanceCategory?.primary).toBe('FOOD_AND_DRINK');
      expect(transaction.location?.city).toBe('San Francisco');
    });
  });

  describe('PlaidAccount', () => {
    it('should have required fields', () => {
      const account: PlaidAccount = {
        accountId: 'acc_123',
        itemId: 'item_456',
        name: 'Checking Account',
        type: 'depository',
        balances: {
          current: 1000,
        },
      };
      expect(account.accountId).toBe('acc_123');
      expect(account.type).toBe('depository');
    });

    it('should support optional fields', () => {
      const account: PlaidAccount = {
        accountId: 'acc_123',
        itemId: 'item_456',
        name: 'Checking Account',
        type: 'depository',
        subtype: 'checking',
        mask: '1234',
        officialName: 'Premium Checking',
        balances: {
          available: 1000,
          current: 1200,
          limit: 5000,
          isoCurrencyCode: 'USD',
        },
      };
      expect(account.subtype).toBe('checking');
      expect(account.balances.available).toBe(1000);
    });
  });

  describe('PlaidItem', () => {
    it('should have required fields', () => {
      const item: PlaidItem = {
        itemId: 'item_123',
        accessToken: 'access-sandbox-xxx',
        institutionId: 'ins_1',
        institutionName: 'Chase',
        userId: 'user_456',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      expect(item.itemId).toBe('item_123');
      expect(item.status).toBe('active');
    });

    it('should support different statuses', () => {
      const activeItem: PlaidItem = {
        itemId: 'item_1',
        accessToken: 'token',
        institutionId: 'ins_1',
        institutionName: 'Bank',
        userId: 'user_1',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      expect(activeItem.status).toBe('active');

      const loginRequiredItem: PlaidItem = {
        ...activeItem,
        status: 'login_required',
      };
      expect(loginRequiredItem.status).toBe('login_required');

      const errorItem: PlaidItem = {
        ...activeItem,
        status: 'error',
      };
      expect(errorItem.status).toBe('error');
    });
  });
});
