/**
 * Plaid to canonical transaction transformer.
 * Converts Plaid transactions to the project's canonical Transaction format.
 */

import { createHash } from 'crypto';
import type { PlaidTransaction, PlaidAccount } from './types.js';
import type { Transaction, ISODate, Direction, Category, Subcategory, ChannelType } from '../types/output.js';
import { categorizeTransaction } from '../categorization/index.js';

/**
 * Map Plaid payment channel to our ChannelType.
 */
function mapPaymentChannel(paymentChannel: string): ChannelType {
  switch (paymentChannel.toLowerCase()) {
    case 'online':
      return 'ONLINE_BANKING_TRANSFER';
    case 'in store':
      return 'CHECKCARD';
    case 'other':
      return 'OTHER';
    default:
      return 'OTHER';
  }
}

/**
 * Map Plaid account type to our AccountType.
 */
export function mapAccountType(type: string, subtype?: string): 'checking' | 'savings' | 'credit' {
  const t = type.toLowerCase();
  const s = subtype?.toLowerCase() ?? '';

  if (t === 'credit') return 'credit';
  if (t === 'depository') {
    if (s === 'savings') return 'savings';
    return 'checking';
  }
  if (s === 'credit card') return 'credit';
  if (s === 'savings') return 'savings';
  return 'checking';
}

/**
 * Generate a deterministic transaction ID from Plaid transaction.
 */
function generateTransactionId(plaidTx: PlaidTransaction): string {
  const hash = createHash('sha256');
  hash.update(plaidTx.transactionId);
  hash.update(plaidTx.accountId);
  hash.update(plaidTx.date);
  hash.update(String(plaidTx.amount));
  return `tx_${hash.digest('hex').slice(0, 24)}`;
}

/**
 * Generate a statement ID for Plaid transactions.
 * Uses account info and month to create a synthetic statement ID.
 */
export function generatePlaidStatementId(
  accountType: string,
  accountMask: string,
  date: string
): string {
  const [year, month] = date.split('-');
  const lastDay = new Date(Number(year), Number(month), 0).getDate();
  const startDate = `${year}${month}01`;
  const endDate = `${year}${month}${String(lastDay).padStart(2, '0')}`;
  return `${accountType.toUpperCase()}-${accountMask}-${startDate}-${endDate}`;
}

/**
 * Convert a Plaid transaction to our canonical Transaction format.
 */
export function normalizeTransaction(
  plaidTx: PlaidTransaction,
  _account: PlaidAccount,
  _statementId: string
): Transaction {
  // Plaid amounts are positive for debits, negative for credits
  // Our format uses positive amounts with direction
  const amount = Math.abs(plaidTx.amount);
  const direction: Direction = plaidTx.amount > 0 ? 'debit' : 'credit';

  // Use merchant name if available, otherwise transaction name
  const merchantName = plaidTx.merchantName ?? plaidTx.name;
  const description = plaidTx.name;

  // Categorize using our existing categorizer
  const channelType = mapPaymentChannel(plaidTx.paymentChannel);
  const categorizationResult = categorizeTransaction(description, channelType);

  // Map Plaid category to our category if available
  let category: Category = categorizationResult.category;
  let subcategory: Subcategory = categorizationResult.subcategory;
  let confidence = categorizationResult.confidence;

  // If Plaid provides personal_finance_category, use it as a hint
  if (plaidTx.personalFinanceCategory !== undefined) {
    const plaidCategory = mapPlaidCategory(plaidTx.personalFinanceCategory.primary);
    if (plaidCategory !== null) {
      category = plaidCategory.category;
      subcategory = plaidCategory.subcategory;
      confidence = 0.9; // High confidence from Plaid
    }
  }

  const transactionId = generateTransactionId(plaidTx);

  const tx: Transaction = {
    transactionId,
    date: plaidTx.date as ISODate,
    postedDate: (plaidTx.authorizedDate ?? plaidTx.date) as ISODate,
    amount,
    direction,
    description,
    descriptionRaw: plaidTx.name,
    merchant: {
      name: merchantName,
      normalizedName: merchantName,
      city: plaidTx.location?.city ?? null,
      state: plaidTx.location?.region ?? null,
      phone: null,
      online: plaidTx.paymentChannel === 'online',
      network: null,
    },
    bankReference: {
      cardTransactionTraceNumber: null,
      confirmationNumber: plaidTx.paymentMeta?.referenceNumber ?? null,
      zelleConfirmation: null,
      checkNumber: plaidTx.checkNumber ?? null,
      atmId: null,
      terminalOrStoreId: plaidTx.location?.storeNumber ?? null,
    },
    channel: {
      type: channelType,
      subtype: plaidTx.paymentChannel,
    },
    categorization: {
      category,
      subcategory,
      confidence,
      ruleId: categorizationResult.ruleId ?? null,
      rationale: `Plaid: ${plaidTx.personalFinanceCategory?.primary ?? 'N/A'}`,
    },
    raw: {
      page: 0,
      lineIndex: 0,
      section: null,
      originalText: plaidTx.name,
    },
    flags: {
      isRecurring: false,
      isSubscription: false,
      isTransfer: category === 'Transfer',
      isCashWithdrawal: channelType === 'ATM_WITHDRAWAL',
      isCashDeposit: channelType === 'ATM_DEPOSIT',
      possibleDuplicate: false,
    },
  };

  return tx;
}

/**
 * Generate a period label for display.
 */
function generatePeriodLabel(account: PlaidAccount, date: string): string {
  const [year, month] = date.split('-');
  const accountType = mapAccountType(account.type, account.subtype);
  return `${year}-${month} ${account.name} (${accountType})`;
}

// Re-export for use in other modules
export { generatePeriodLabel };

/**
 * Map Plaid personal_finance_category to our Category/Subcategory.
 */
function mapPlaidCategory(primary: string): { category: Category; subcategory: Subcategory } | null {
  const mapping: Record<string, { category: Category; subcategory: Subcategory }> = {
    'INCOME': { category: 'Income', subcategory: 'Salary' },
    'TRANSFER_IN': { category: 'Transfer', subcategory: 'Transfer' },
    'TRANSFER_OUT': { category: 'Transfer', subcategory: 'Transfer' },
    'LOAN_PAYMENTS': { category: 'Financial', subcategory: 'Loan Payment' },
    'BANK_FEES': { category: 'Fees', subcategory: 'Fees' },
    'ENTERTAINMENT': { category: 'Entertainment', subcategory: null },
    'FOOD_AND_DRINK': { category: 'Food & Dining', subcategory: null },
    'GENERAL_MERCHANDISE': { category: 'Shopping', subcategory: 'General Merchandise' },
    'HOME_IMPROVEMENT': { category: 'Shopping', subcategory: 'Home Improvement' },
    'MEDICAL': { category: 'Health', subcategory: 'Medical' },
    'PERSONAL_CARE': { category: 'Personal Care', subcategory: null },
    'GENERAL_SERVICES': { category: 'Uncategorized', subcategory: null },
    'GOVERNMENT_AND_NON_PROFIT': { category: 'Taxes', subcategory: null },
    'TRANSPORTATION': { category: 'Transportation', subcategory: null },
    'TRAVEL': { category: 'Travel', subcategory: null },
    'RENT_AND_UTILITIES': { category: 'Housing', subcategory: 'Rent' },
  };

  return mapping[primary] ?? null;
}

/**
 * Normalize multiple Plaid transactions.
 */
export function normalizeTransactions(
  plaidTransactions: PlaidTransaction[],
  accounts: PlaidAccount[]
): Transaction[] {
  const accountMap = new Map<string, PlaidAccount>();
  for (const account of accounts) {
    accountMap.set(account.accountId, account);
  }

  const transactions: Transaction[] = [];

  for (const plaidTx of plaidTransactions) {
    const account = accountMap.get(plaidTx.accountId);
    if (account === undefined) {
      continue;
    }

    const accountType = mapAccountType(account.type, account.subtype);
    const mask = account.mask ?? '0000';
    const statementId = generatePlaidStatementId(accountType, mask, plaidTx.date);

    const tx = normalizeTransaction(plaidTx, account, statementId);
    transactions.push(tx);
  }

  return transactions;
}
