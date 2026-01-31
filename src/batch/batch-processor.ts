import { extractPDF, type ExtractedPDF } from '../extractors/index.js';
import { parseBoaMultipleStatements, isTransactionDetailsPDF, parseTransactionDetails, type RawTransaction } from '../parsers/index.js';
import type { ParsedStatement, Transaction } from '../schemas/index.js';
import { categorizeTransaction, extractMerchant } from '../categorization/index.js';
import { parseAmount, roundToTwoDecimals, sumAmounts } from '../utils/money.js';
import { PARSER_VERSION, BOA_INSTITUTION_NAME } from '../utils/constants.js';
import type { PdfFileInfo } from '../utils/directory-scanner.js';
import {
  mergeStatementsWithSources,
  isCombinedPdfFilename,
  type MergeResult,
  type StatementWithSource,
} from '../utils/statement-merger.js';

export interface ParseError {
  filename: string;
  filePath: string;
  error: string;
  stack: string | undefined;
  timestamp: string;
}

export interface BatchProcessResult {
  statements: ParsedStatement[];
  totalStatements: number;
  totalTransactions: number;
  parseErrors: ParseError[];
  summary: {
    totalPdfsFound: number;
    pdfsSucceeded: number;
    pdfsFailed: number;
    statementsBeforeDedup: number;
    duplicateStatementsRemoved: number;
    duplicateTransactionsRemoved: number;
  };
}

export interface BatchProcessOptions {
  strict?: boolean;
  verbose?: boolean;
  onProgress?: (current: number, total: number, filename: string) => void;
  onError?: (error: ParseError) => void;
}

/**
 * Processes multiple PDF files and merges results into a single consolidated output.
 * 
 * Processing is sequential to ensure deterministic results and avoid memory pressure.
 * Each PDF is parsed using the existing multi-statement parser, then all results
 * are merged with robust statement-level and transaction-level deduplication.
 * 
 * Deduplication handles:
 * - Same monthly statement appearing in multiple PDFs
 * - Combined PDFs containing statements that also exist as separate PDFs
 * - Duplicate transactions within and across statements
 */
export async function processBatch(
  files: PdfFileInfo[],
  options: BatchProcessOptions = {}
): Promise<BatchProcessResult> {
  const allStatementArrays: StatementWithSource[][] = [];
  const parseErrors: ParseError[] = [];
  let pdfsSucceeded = 0;
  let statementsBeforeDedup = 0;
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file === undefined) continue;
    
    // Report progress
    if (options.onProgress !== undefined) {
      options.onProgress(i + 1, files.length, file.fileName);
    }
    
    try {
      const statements = await processSinglePdf(file.filePath, options);
      
      // Wrap statements with source metadata for deduplication
      const isCombined = isCombinedPdfFilename(file.fileName);
      const statementsWithSource: StatementWithSource[] = statements.map(statement => ({
        statement,
        sourceFile: file.fileName,
        isCombinedPdf: isCombined,
      }));
      
      allStatementArrays.push(statementsWithSource);
      statementsBeforeDedup += statements.length;
      pdfsSucceeded++;
    } catch (error) {
      const parseError = createParseError(file, error);
      parseErrors.push(parseError);
      
      if (options.onError !== undefined) {
        options.onError(parseError);
      }
    }
  }
  
  // Merge all statements with robust deduplication
  const mergeResult: MergeResult = allStatementArrays.length > 0
    ? mergeStatementsWithSources(allStatementArrays)
    : { statements: [], totalTransactions: 0, duplicateStatementsRemoved: 0, duplicateTransactionsRemoved: 0 };
  
  return {
    statements: mergeResult.statements,
    totalStatements: mergeResult.statements.length,
    totalTransactions: mergeResult.totalTransactions,
    parseErrors,
    summary: {
      totalPdfsFound: files.length,
      pdfsSucceeded,
      pdfsFailed: parseErrors.length,
      statementsBeforeDedup,
      duplicateStatementsRemoved: mergeResult.duplicateStatementsRemoved,
      duplicateTransactionsRemoved: mergeResult.duplicateTransactionsRemoved,
    },
  };
}

/**
 * Processes a single PDF file and returns its statements.
 * This wraps the existing parser logic and handles both monthly statements
 * and "Print Transaction Details" exports.
 */
async function processSinglePdf(
  filePath: string,
  options: BatchProcessOptions
): Promise<ParsedStatement[]> {
  // Extract PDF content
  const pdf = await extractPDF(filePath);
  
  // Check for password-protected PDFs (pdf-parse throws specific error)
  if (pdf.fullText.length === 0 && pdf.totalPages > 0) {
    throw new Error('PDF appears to be password-protected or contains no extractable text');
  }
  
  // Check if this is a "Print Transaction Details" PDF
  if (isTransactionDetailsPDF(pdf)) {
    return parseTransactionDetailsPdf(pdf, options);
  }
  
  // Parse using existing multi-statement parser for monthly statements
  const result = parseBoaMultipleStatements(pdf, {
    strict: options.strict ?? false,
    verbose: options.verbose ?? false,
  });
  
  if (!result.success || result.statements.length === 0) {
    throw new Error('Failed to parse any statements from PDF');
  }
  
  return result.statements;
}

/**
 * Parse a "Print Transaction Details" PDF into a single statement.
 * These PDFs contain a flat list of transactions from online banking export.
 */
function parseTransactionDetailsPdf(
  pdf: ExtractedPDF,
  _options: BatchProcessOptions
): ParsedStatement[] {
  const result = parseTransactionDetails(pdf);
  
  if (result.transactions.length === 0) {
    throw new Error('No transactions found in transaction details PDF');
  }
  
  // Normalize raw transactions to full Transaction objects
  const transactions: Transaction[] = result.transactions.map((raw: RawTransaction) => {
    const amount = parseAmount(raw.amount);
    const absAmount = roundToTwoDecimals(Math.abs(amount));
    const direction: 'debit' | 'credit' = amount >= 0 ? 'credit' : 'debit';
    
    // Categorize based on section or description
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
  
  // Calculate totals from transactions
  const totalCredits = sumAmounts(
    transactions.filter((t) => t.direction === 'credit').map((t) => t.amount)
  );
  const totalDebits = sumAmounts(
    transactions.filter((t) => t.direction === 'debit').map((t) => Math.abs(t.amount))
  );
  
  // Build the statement
  const statement: ParsedStatement = {
    account: {
      institution: BOA_INSTITUTION_NAME,
      accountType: result.accountInfo.accountType,
      accountNumberMasked: result.accountInfo.accountNumberMasked,
      statementPeriod: {
        start: result.accountInfo.statementPeriodStart,
        end: result.accountInfo.statementPeriodEnd,
      },
      currency: 'USD',
    },
    summary: {
      startingBalance: result.balanceInfo.startingBalance,
      endingBalance: result.balanceInfo.endingBalance,
      totalCredits,
      totalDebits,
    },
    transactions,
    metadata: {
      parserVersion: PARSER_VERSION,
      parsedAt: new Date().toISOString(),
      warnings: result.warnings,
    },
  };
  
  return [statement];
}

/**
 * Creates a structured parse error from an exception.
 */
function createParseError(file: PdfFileInfo, error: unknown): ParseError {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  
  return {
    filename: file.fileName,
    filePath: file.filePath,
    error: message,
    stack,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Checks if a PDF parsing error indicates a non-BOA PDF.
 * Used to provide better error messages.
 */
export function isNonBoaPdfError(error: ParseError): boolean {
  const nonBoaIndicators = [
    'Failed to parse any statements',
    'Unable to detect account type',
    'No transactions found',
  ];
  
  return nonBoaIndicators.some(indicator => 
    error.error.toLowerCase().includes(indicator.toLowerCase())
  );
}
