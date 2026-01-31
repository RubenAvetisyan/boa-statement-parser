import type { ExtractedPDF } from '../../extractors/index.js';
import type { ParsedStatement, Transaction, ParserOptions } from '../../schemas/index.js';
import { parseCheckingStatement, parseMultipleCheckingStatements } from './checking-parser.js';
import { parseSavingsStatement, parseMultipleSavingsStatements } from './savings-parser.js';
import { parseCreditStatement } from './credit-parser.js';
import { categorizeTransaction, extractMerchant } from '../../categorization/index.js';
import { parseAmount, roundToTwoDecimals, sumAmounts } from '../../utils/money.js';
import { PARSER_VERSION, BOA_INSTITUTION_NAME } from '../../utils/constants.js';
import type { RawTransaction, AccountInfo, BalanceInfo } from './types.js';

export interface ParseResult {
  statement: ParsedStatement;
  success: boolean;
}

export interface MultiStatementParseResult {
  statements: ParsedStatement[];
  success: boolean;
  totalTransactions: number;
}

export function detectAccountType(pdf: ExtractedPDF): 'checking' | 'savings' | 'credit' | 'unknown' {
  const text = pdf.fullText.toLowerCase();

  // Check for explicit BoA product names first (most reliable)
  // These are specific product names that definitively identify the account type
  if (text.includes('advantage savings')) {
    return 'savings';
  }
  if (text.includes('advantage plus banking')) {
    return 'checking';
  }

  const creditIndicators = [
    'credit card',
    'card member',
    'minimum payment',
    'credit limit',
    'available credit',
    'cash advance',
    'purchase apr',
    'billing period',
  ];

  const savingsIndicators = [
    'annual percentage yield',
    'interest paid year to date',
    'apy earned',
  ];

  const checkingIndicators = [
    'checks paid',
    'daily ending balance',
    'check number',
    'checkcard',
    'atm and debit card',
    'online and mobile banking',
    'service fees',
  ];

  const depositAccountIndicators = [
    'deposits and other additions',
    'withdrawals and other subtractions',
    'atm and debit card subtractions',
    'other subtractions',
    'beginning balance',
    'ending balance',
  ];

  let creditScore = 0;
  let savingsScore = 0;
  let checkingScore = 0;
  let depositAccountScore = 0;

  for (const indicator of creditIndicators) {
    if (text.includes(indicator)) {
      creditScore++;
    }
  }

  for (const indicator of savingsIndicators) {
    if (text.includes(indicator)) {
      savingsScore++;
    }
  }

  for (const indicator of checkingIndicators) {
    if (text.includes(indicator)) {
      checkingScore++;
    }
  }

  for (const indicator of depositAccountIndicators) {
    if (text.includes(indicator)) {
      depositAccountScore++;
    }
  }

  if (creditScore > checkingScore + savingsScore && creditScore >= 2) {
    return 'credit';
  }

  // If it's a deposit account, determine if savings or checking
  if (depositAccountScore >= 2) {
    if (savingsScore > checkingScore) {
      return 'savings';
    }
    if (checkingScore > 0) {
      return 'checking';
    }
    // Default deposit accounts without clear indicators to checking
    return 'checking';
  }

  return 'unknown';
}

export function parseBoaStatement(
  pdf: ExtractedPDF,
  options: ParserOptions = { strict: false, verbose: false }
): ParseResult {
  const accountType = detectAccountType(pdf);
  const warnings: string[] = [];

  if (accountType === 'unknown') {
    warnings.push('Could not determine account type, defaulting to checking');
  }

  let accountInfo: AccountInfo;
  let balanceInfo: BalanceInfo;
  let rawTransactions: RawTransaction[];

  if (accountType === 'credit') {
    const result = parseCreditStatement(pdf);
    accountInfo = result.accountInfo;
    balanceInfo = result.balanceInfo;
    rawTransactions = result.transactions;
    warnings.push(...result.warnings);
  } else if (accountType === 'savings') {
    const result = parseSavingsStatement(pdf);
    accountInfo = result.accountInfo;
    balanceInfo = result.balanceInfo;
    rawTransactions = result.transactions;
    warnings.push(...result.warnings);
  } else {
    const result = parseCheckingStatement(pdf);
    accountInfo = result.accountInfo;
    balanceInfo = result.balanceInfo;
    rawTransactions = result.transactions;
    warnings.push(...result.warnings);
  }

  const transactions = normalizeTransactions(rawTransactions, accountType === 'credit');

  const calculatedCredits = sumAmounts(
    transactions.filter((t) => t.direction === 'credit').map((t) => t.amount)
  );
  const calculatedDebits = sumAmounts(
    transactions.filter((t) => t.direction === 'debit').map((t) => Math.abs(t.amount))
  );

  if (balanceInfo.totalCredits === 0 && calculatedCredits > 0) {
    balanceInfo.totalCredits = calculatedCredits;
  }
  if (balanceInfo.totalDebits === 0 && calculatedDebits > 0) {
    balanceInfo.totalDebits = calculatedDebits;
  }

  if (options.strict) {
    validateStatement(accountInfo, balanceInfo, transactions, warnings);
  }

  const statement: ParsedStatement = {
    account: {
      institution: BOA_INSTITUTION_NAME,
      accountType: accountInfo.accountType,
      accountNumberMasked: accountInfo.accountNumberMasked,
      statementPeriod: {
        start: accountInfo.statementPeriodStart,
        end: accountInfo.statementPeriodEnd,
      },
      currency: 'USD',
    },
    summary: {
      startingBalance: balanceInfo.startingBalance,
      endingBalance: balanceInfo.endingBalance,
      totalCredits: balanceInfo.totalCredits,
      totalDebits: balanceInfo.totalDebits,
    },
    transactions,
    metadata: {
      parserVersion: PARSER_VERSION,
      parsedAt: new Date().toISOString(),
      warnings,
    },
  };

  return { statement, success: true };
}

function normalizeTransactions(
  rawTransactions: RawTransaction[],
  isCreditCard: boolean
): Transaction[] {
  return rawTransactions.map((raw) => {
    const amount = parseAmount(raw.amount);
    const absAmount = roundToTwoDecimals(Math.abs(amount));

    let direction: 'debit' | 'credit';
    if (isCreditCard) {
      direction = amount >= 0 ? 'debit' : 'credit';
    } else {
      direction = amount >= 0 ? 'credit' : 'debit';
    }

    // Force category for transactions from the fees section
    let categorization;
    if (raw.section === 'fees') {
      categorization = { category: 'Fees', subcategory: 'Bank', confidence: 0.95 };
    } else {
      categorization = categorizeTransaction(raw.description);
    }
    const merchant = extractMerchant(raw.description);

    return {
      date: raw.date,
      postedDate: null,
      description: raw.description,
      merchant,
      amount: direction === 'debit' ? -absAmount : absAmount,
      direction,
      category: categorization.category,
      subcategory: categorization.subcategory,
      confidence: categorization.confidence,
      raw: {
        originalText: raw.originalLine,
        page: raw.page,
      },
    };
  });
}

function validateStatement(
  accountInfo: AccountInfo,
  balanceInfo: BalanceInfo,
  transactions: Transaction[],
  warnings: string[]
): void {
  if (accountInfo.accountNumberMasked === '****0000') {
    warnings.push('STRICT: Account number could not be verified');
  }

  if (accountInfo.statementPeriodStart === '' || accountInfo.statementPeriodEnd === '') {
    warnings.push('STRICT: Statement period could not be verified');
  }

  if (balanceInfo.startingBalance === 0 && balanceInfo.endingBalance === 0) {
    warnings.push('STRICT: Both starting and ending balances are zero');
  }

  if (transactions.length === 0) {
    warnings.push('STRICT: No transactions were parsed');
  }

  const calculatedBalance = roundToTwoDecimals(
    balanceInfo.startingBalance + balanceInfo.totalCredits - balanceInfo.totalDebits
  );
  const diff = Math.abs(calculatedBalance - balanceInfo.endingBalance);
  if (diff > 0.01) {
    warnings.push(
      `STRICT: Balance mismatch - calculated ${calculatedBalance}, reported ${balanceInfo.endingBalance}`
    );
  }
}

/**
 * Parse multiple statements from a combined PDF file.
 * This handles PDFs that contain multiple monthly statements.
 */
export function parseBoaMultipleStatements(
  pdf: ExtractedPDF,
  options: ParserOptions = { strict: false, verbose: false }
): MultiStatementParseResult {
  const accountType = detectAccountType(pdf);
  
  if (accountType === 'credit') {
    // For credit cards, fall back to single statement parsing for now
    const result = parseBoaStatement(pdf, options);
    return {
      statements: [result.statement],
      success: result.success,
      totalTransactions: result.statement.transactions.length,
    };
  }
  
  // Parse multiple checking or savings statements based on detected account type
  const parsedStatements = accountType === 'savings'
    ? parseMultipleSavingsStatements(pdf)
    : parseMultipleCheckingStatements(pdf);
  const statements: ParsedStatement[] = [];
  let totalTransactions = 0;
  
  for (const parsed of parsedStatements) {
    const warnings = [...parsed.warnings];
    const transactions = normalizeTransactions(parsed.transactions, false);
    
    // Calculate totals from actual transactions (more reliable than PDF extraction for multi-statement PDFs)
    const calculatedCredits = sumAmounts(
      transactions.filter((t) => t.direction === 'credit').map((t) => t.amount)
    );
    const calculatedDebits = sumAmounts(
      transactions.filter((t) => t.direction === 'debit').map((t) => Math.abs(t.amount))
    );
    
    // Use calculated totals from transactions as they are correctly filtered by date
    // PDF-extracted totals may be from wrong segment in multi-statement PDFs
    const totalCredits = calculatedCredits;
    const totalDebits = calculatedDebits;
    
    if (options.strict) {
      validateStatement(
        parsed.accountInfo,
        { ...parsed.balanceInfo, totalCredits, totalDebits },
        transactions,
        warnings
      );
    }
    
    const statement: ParsedStatement = {
      account: {
        institution: BOA_INSTITUTION_NAME,
        accountType: parsed.accountInfo.accountType,
        accountNumberMasked: parsed.accountInfo.accountNumberMasked,
        statementPeriod: {
          start: parsed.accountInfo.statementPeriodStart,
          end: parsed.accountInfo.statementPeriodEnd,
        },
        currency: 'USD',
      },
      summary: {
        startingBalance: parsed.balanceInfo.startingBalance,
        endingBalance: parsed.balanceInfo.endingBalance,
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
    
    statements.push(statement);
    totalTransactions += transactions.length;
  }
  
  return {
    statements,
    success: statements.length > 0,
    totalTransactions,
  };
}

export { parseCheckingStatement, parseMultipleCheckingStatements } from './checking-parser.js';
export { parseSavingsStatement, parseMultipleSavingsStatements } from './savings-parser.js';
export { parseCreditStatement } from './credit-parser.js';
export { isTransactionDetailsPDF, parseTransactionDetails } from './transaction-details-parser.js';
export type { RawTransaction, AccountInfo, BalanceInfo, ParseContext } from './types.js';
