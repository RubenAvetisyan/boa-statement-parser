import type { ExtractedPDF, ExtractedPage } from '../../extractors/index.js';
import { parseUSDate } from '../../utils/date.js';
import { parseAmount } from '../../utils/money.js';
import type { RawTransaction, AccountInfo, BalanceInfo } from './types.js';

/**
 * Pre-process a line to fix common OCR/extraction issues:
 * - Separates date from merchant when no space exists (e.g., "03/17/257-ELEVEN" -> "03/17/25 7-ELEVEN")
 * 
 * Note: Generic "glued amount" splitting was removed because:
 * 1. Layout-aware PDF extraction now properly inserts separators between columns
 * 2. The regex was incorrectly splitting amounts like "200.00" into "2 00.00"
 * 3. Specific extractors handle Conf# and trace number cases
 */
function preprocessLine(line: string): string {
  // Fix "03/17/257-ELEVEN" -> "03/17/25 7-ELEVEN"
  return line.replace(
    /^(\d{2}\/\d{2}\/\d{2})([A-Za-z0-9])/,
    '$1 $2'
  );
}

const CHECKING_PATTERNS = {
  accountNumber: /Account\s*#?\s*[\d\s]*(\d{4})/im,
  accountNumberAlt: /(?:Account|Acct).*?(\d{4})$/im,
  statementPeriod: /([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s+to\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
  statementPeriodAlt: /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:to|-|through)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  beginningBalance: /(?:Beginning|Starting|Previous)\s+balance\s*(?:on\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4})?\s*[:\s$]*\$?([0-9,]+\.\d{2})/i,
  endingBalance: /(?:Ending|Closing|New)\s+balance\s*(?:on\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4})?\s*[:\s$]*\$?([0-9,]+\.\d{2})/i,
  totalDeposits: /Total\s+deposits\s+and\s+other\s+additions\s*-?\$?([0-9,]+\.\d{2})/i,
  totalWithdrawals: /Total\s+ATM\s+and\s+debit\s+card\s+subtractions\s*-?\$?([0-9,]+\.\d{2})/i,
  totalOtherSubtractions: /Total\s+other\s+subtractions\s*-?\$?([0-9,]+\.\d{2})/i,
  totalServiceFees: /Total\s+service\s+fees\s*-?\$?([0-9,]+\.\d{2})/i,
  transactionLine: /^(\d{1,2}\/\d{1,2})\s+(.+?)\s+(-?[0-9,]+\.\d{2})$/,
  transactionLineAlt: /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+?)\s+(-?[0-9,]+\.\d{2})$/,
  // BoA format: MM/DD/YY followed by description (may have no space) then amount
  // We need to handle cases like "03/17/257-ELEVEN" where date runs into merchant
  transactionLineBoA: /^(\d{2}\/\d{2}\/\d{2})(.+?)(-?[0-9,]+\.\d{2})$/,
  checkLine: /^(\d{2}\/\d{2}\/\d{2})(\d{1,6})(-?[0-9,]+\.\d{2})$/,
  depositsSection: /deposits\s+and\s+(?:other\s+)?additions/i,
  withdrawalsSection: /withdrawals\s+and\s+(?:other\s+)?subtractions|ATM\s+and\s+debit\s+card\s+subtractions/i,
  checksSection: /checks\s*$/i,
  serviceFees: /service\s+fees/i,
  dailyBalanceSection: /daily\s+(?:ending\s+)?balance/i,
  totalLine: /^Total\s+/i,
  // Statement boundary detection for multi-statement PDFs
  statementBoundary: /(?:February|March|April|May|June|July|August|September|October|November|December|January)\s+\d{1,2},?\s+\d{4}\s+(?:to|-|through)\s+(?:February|March|April|May|June|July|August|September|October|November|December|January)\s+\d{1,2},?\s+\d{4}/i,
};

export interface StatementSegment {
  text: string;
  pages: ExtractedPage[];
  startPage: number;
  endPage: number;
}

/**
 * Detect statement boundaries in a multi-statement PDF.
 * Returns an array of text segments, one per statement.
 */
export function detectStatementBoundaries(pdf: ExtractedPDF): StatementSegment[] {
  const segments: StatementSegment[] = [];
  
  // Look for "Beginning balance on [Date]" as the most reliable statement boundary
  // This appears once per statement and marks the start of the account summary
  const boundaryPattern = /Beginning\s+balance\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi;
  
  const boundaries: Array<{ date: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = boundaryPattern.exec(pdf.fullText)) !== null) {
    boundaries.push({ date: match[1] ?? '', index: match.index });
  }
  
  if (boundaries.length === 0) {
    // No boundaries found, treat entire PDF as single statement
    return [{
      text: pdf.fullText,
      pages: pdf.pages,
      startPage: 1,
      endPage: pdf.pages.length,
    }];
  }
  
  // Create segments based on boundary positions
  for (let i = 0; i < boundaries.length; i++) {
    // Start a bit before "Beginning balance" to capture the statement period header
    // Look backwards for "for [Month] [Day], [Year] to" pattern
    const boundaryPos = boundaries[i]?.index ?? 0;
    let startPos = boundaryPos;
    
    // Search backwards up to 500 chars for the statement period header
    const searchStart = Math.max(0, boundaryPos - 500);
    const searchText = pdf.fullText.slice(searchStart, boundaryPos);
    const periodMatch = /(?:for\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s+to\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi.exec(searchText);
    if (periodMatch !== null) {
      startPos = searchStart + periodMatch.index;
    }
    
    const endPos = boundaries[i + 1]?.index ?? pdf.fullText.length;
    // For end position, also search backwards to find the period header of next statement
    let adjustedEndPos = endPos;
    if (i + 1 < boundaries.length) {
      const nextSearchStart = Math.max(0, endPos - 500);
      const nextSearchText = pdf.fullText.slice(nextSearchStart, endPos);
      const nextPeriodMatch = /(?:for\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s+to\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi.exec(nextSearchText);
      if (nextPeriodMatch !== null) {
        adjustedEndPos = nextSearchStart + nextPeriodMatch.index;
      }
    }
    
    const segmentText = pdf.fullText.slice(startPos, adjustedEndPos);
    
    // Determine which pages belong to this segment
    const segmentPages: ExtractedPage[] = [];
    let startPage = 1;
    let endPage = pdf.pages.length;
    
    for (const page of pdf.pages) {
      const pageStartInFull = pdf.fullText.indexOf(page.text);
      const pageEndInFull = pageStartInFull + page.text.length;
      
      if (pageEndInFull > startPos && pageStartInFull < adjustedEndPos) {
        segmentPages.push(page);
        if (segmentPages.length === 1) {
          startPage = page.pageNumber;
        }
        endPage = page.pageNumber;
      }
    }
    
    segments.push({
      text: segmentText,
      pages: segmentPages.length > 0 ? segmentPages : pdf.pages,
      startPage,
      endPage,
    });
  }
  
  return segments;
}

/**
 * Parse multiple checking statements from a combined PDF.
 */
export function parseMultipleCheckingStatements(pdf: ExtractedPDF): Array<{
  accountInfo: AccountInfo;
  balanceInfo: BalanceInfo;
  transactions: RawTransaction[];
  warnings: string[];
  pageRange: { start: number; end: number };
}> {
  const segments = detectStatementBoundaries(pdf);
  const results: Array<{
    accountInfo: AccountInfo;
    balanceInfo: BalanceInfo;
    transactions: RawTransaction[];
    warnings: string[];
    pageRange: { start: number; end: number };
  }> = [];
  
  for (const segment of segments) {
    const warnings: string[] = [];
    const accountInfo = extractAccountInfo(segment.text, warnings);
    const balanceInfo = extractBalanceInfo(segment.text, warnings);
    
    // Filter transactions to only those within the statement period
    const allTransactions = extractTransactions(segment.pages, accountInfo, warnings);
    const filteredTransactions = filterTransactionsByPeriod(
      allTransactions,
      accountInfo.statementPeriodStart,
      accountInfo.statementPeriodEnd
    );
    
    results.push({
      accountInfo,
      balanceInfo,
      transactions: filteredTransactions,
      warnings,
      pageRange: { start: segment.startPage, end: segment.endPage },
    });
  }
  
  return results;
}

/**
 * Filter transactions to only those within the statement period.
 */
function filterTransactionsByPeriod(
  transactions: RawTransaction[],
  startDate: string,
  endDate: string
): RawTransaction[] {
  if (!startDate || !endDate) {
    return transactions;
  }
  
  return transactions.filter(txn => {
    return txn.date >= startDate && txn.date <= endDate;
  });
}

/**
 * Parse a single checking statement (legacy function for backward compatibility).
 */
export function parseCheckingStatement(pdf: ExtractedPDF): {
  accountInfo: AccountInfo;
  balanceInfo: BalanceInfo;
  transactions: RawTransaction[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const fullText = pdf.fullText;

  const accountInfo = extractAccountInfo(fullText, warnings);
  const balanceInfo = extractBalanceInfo(fullText, warnings);
  const transactions = extractTransactions(pdf.pages, accountInfo, warnings);

  return { accountInfo, balanceInfo, transactions, warnings };
}

function extractAccountInfo(text: string, warnings: string[]): AccountInfo {
  let accountNumberMasked = '****0000';
  let statementPeriodStart = '';
  let statementPeriodEnd = '';

  const accountMatch = CHECKING_PATTERNS.accountNumber.exec(text) ?? 
                       CHECKING_PATTERNS.accountNumberAlt.exec(text);
  if (accountMatch?.[1] !== undefined) {
    accountNumberMasked = `****${accountMatch[1]}`;
  } else {
    warnings.push('Could not extract account number from statement');
  }

  const periodMatch = CHECKING_PATTERNS.statementPeriod.exec(text);
  if (periodMatch?.[1] !== undefined && periodMatch[2] !== undefined) {
    statementPeriodStart = parseMonthDayYear(periodMatch[1]);
    statementPeriodEnd = parseMonthDayYear(periodMatch[2]);
  } else {
    const periodAltMatch = CHECKING_PATTERNS.statementPeriodAlt.exec(text);
    if (periodAltMatch?.[1] !== undefined && periodAltMatch[2] !== undefined) {
      statementPeriodStart = parseUSDate(periodAltMatch[1]);
      statementPeriodEnd = parseUSDate(periodAltMatch[2]);
    } else {
      warnings.push('Could not extract statement period');
      const now = new Date();
      statementPeriodEnd = now.toISOString().split('T')[0] ?? '';
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      statementPeriodStart = lastMonth.toISOString().split('T')[0] ?? '';
    }
  }

  return {
    accountType: 'checking',
    accountNumberMasked,
    statementPeriodStart,
    statementPeriodEnd,
  };
}

function parseMonthDayYear(dateStr: string): string {
  const months: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04',
    jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const match = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(dateStr);
  if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
    const monthNum = months[match[1].toLowerCase()];
    if (monthNum !== undefined) {
      return `${match[3]}-${monthNum}-${match[2].padStart(2, '0')}`;
    }
  }
  throw new Error(`Unable to parse date: ${dateStr}`);
}

function extractBalanceInfo(text: string, warnings: string[]): BalanceInfo {
  let startingBalance = 0;
  let endingBalance = 0;
  let totalCredits = 0;
  let totalDebits = 0;

  const beginMatch = CHECKING_PATTERNS.beginningBalance.exec(text);
  if (beginMatch?.[1] !== undefined) {
    startingBalance = parseAmount(beginMatch[1]);
  } else {
    warnings.push('Could not extract beginning balance');
  }

  const endMatch = CHECKING_PATTERNS.endingBalance.exec(text);
  if (endMatch?.[1] !== undefined) {
    endingBalance = parseAmount(endMatch[1]);
  } else {
    warnings.push('Could not extract ending balance');
  }

  const depositsMatch = CHECKING_PATTERNS.totalDeposits.exec(text);
  if (depositsMatch?.[1] !== undefined) {
    totalCredits = parseAmount(depositsMatch[1]);
  }

  // Extract all debit categories: ATM/debit card, other subtractions, service fees
  const withdrawalsMatch = CHECKING_PATTERNS.totalWithdrawals.exec(text);
  if (withdrawalsMatch?.[1] !== undefined) {
    totalDebits += parseAmount(withdrawalsMatch[1]);
  }

  const otherSubtractionsMatch = CHECKING_PATTERNS.totalOtherSubtractions.exec(text);
  if (otherSubtractionsMatch?.[1] !== undefined) {
    totalDebits += parseAmount(otherSubtractionsMatch[1]);
  }

  const serviceFeesMatch = CHECKING_PATTERNS.totalServiceFees.exec(text);
  if (serviceFeesMatch?.[1] !== undefined) {
    totalDebits += parseAmount(serviceFeesMatch[1]);
  }

  return { startingBalance, endingBalance, totalCredits, totalDebits };
}

function extractTransactions(
  pages: ExtractedPage[],
  accountInfo: AccountInfo,
  warnings: string[]
): RawTransaction[] {
  const transactions: RawTransaction[] = [];
  const statementYear = parseInt(accountInfo.statementPeriodEnd.split('-')[0] ?? '2024', 10);

  let currentSection: 'deposits' | 'withdrawals' | 'checks' | 'fees' | 'unknown' = 'unknown';
  let pendingLine: { line: string; page: number; index: number } | null = null;

  for (const page of pages) {
    for (let i = 0; i < page.lines.length; i++) {
      const line = page.lines[i];
      if (line === undefined) continue;

      if (CHECKING_PATTERNS.totalLine.test(line)) {
        pendingLine = null;
        continue;
      }

      if (CHECKING_PATTERNS.depositsSection.test(line)) {
        currentSection = 'deposits';
        pendingLine = null;
        continue;
      }
      if (CHECKING_PATTERNS.withdrawalsSection.test(line)) {
        currentSection = 'withdrawals';
        pendingLine = null;
        continue;
      }
      if (CHECKING_PATTERNS.checksSection.test(line)) {
        currentSection = 'checks';
        pendingLine = null;
        continue;
      }
      if (CHECKING_PATTERNS.serviceFees.test(line)) {
        currentSection = 'fees';
        pendingLine = null;
        continue;
      }
      if (CHECKING_PATTERNS.dailyBalanceSection.test(line)) {
        currentSection = 'unknown';
        pendingLine = null;
        continue;
      }

      // Check if this line is just an amount (continuation of previous line)
      const amountOnlyMatch = /^-?[0-9,]+\.\d{2}$/.exec(line.trim());
      if (amountOnlyMatch !== null && pendingLine !== null) {
        // Merge with pending line
        const mergedLine = `${pendingLine.line}${line.trim()}`;
        const processedLine = preprocessLine(mergedLine);
        const txn = parseTransactionLine(processedLine, pendingLine.page, pendingLine.index, statementYear, currentSection);
        if (txn !== null) {
          transactions.push(txn);
        }
        pendingLine = null;
        continue;
      }

      // Preprocess line to fix date concatenation issues (e.g., "03/17/257-ELEVEN")
      const processedLine = preprocessLine(line);
      
      // Check if this line starts with a date but has no amount (multi-line transaction)
      const dateOnlyMatch = /^(\d{2}\/\d{2}\/\d{2})(.+)$/.exec(processedLine);
      const hasAmount = /-?[0-9,]+\.\d{2}$/.test(processedLine);
      
      if (dateOnlyMatch !== null && !hasAmount) {
        // This line has a date but no amount - save it as pending
        pendingLine = { line: processedLine, page: page.pageNumber, index: i };
        continue;
      }
      
      // Handle multi-column check lines (e.g., "11/06/25	108	-2,300.00	12/08/25	109	-2,300.00")
      if (currentSection === 'checks') {
        const multiCheckTxns = parseMultiColumnCheckLine(processedLine, page.pageNumber, i, statementYear);
        if (multiCheckTxns.length > 0) {
          transactions.push(...multiCheckTxns);
          pendingLine = null;
          continue;
        }
      }

      const txn = parseTransactionLine(processedLine, page.pageNumber, i, statementYear, currentSection);
      if (txn !== null) {
        transactions.push(txn);
        pendingLine = null;
      }
    }
  }

  if (transactions.length === 0) {
    warnings.push('No transactions found in statement');
  }

  return transactions;
}

/**
 * Parse multi-column check lines where multiple checks appear on the same line.
 * Format: "Date	Check#	Amount	Date	Check#	Amount"
 * Example: "11/06/25	108	-2,300.00	12/08/25	109	-2,300.00"
 */
function parseMultiColumnCheckLine(
  line: string,
  pageNumber: number,
  lineIndex: number,
  statementYear: number
): RawTransaction[] {
  const transactions: RawTransaction[] = [];
  
  // Pattern for a single check entry: Date + Check# + Amount
  // The check line can have multiple entries separated by tabs
  const checkPattern = /(\d{2}\/\d{2}\/\d{2})\s+(\d{1,6})\s+(-?[0-9,]+\.\d{2})/g;
  
  let match: RegExpExecArray | null;
  while ((match = checkPattern.exec(line)) !== null) {
    const [, dateStr, checkNum, amountStr] = match;
    if (dateStr === undefined || checkNum === undefined || amountStr === undefined) {
      continue;
    }
    
    let amount = amountStr;
    if (!amount.startsWith('-')) {
      amount = `-${amount}`;
    }
    
    transactions.push({
      date: parseUSDate(dateStr, statementYear),
      description: `Check #${checkNum}`,
      amount,
      page: pageNumber,
      lineIndex,
      originalLine: line,
      section: 'checks',
    });
  }
  
  return transactions;
}

function extractAmountFromConfirmationLine(line: string): { cleanedLine: string; amount: string } | null {
  // Pattern: "Confirmation# NNNNNNNNNN" followed by amount
  // Confirmation numbers are exactly 10 digits
  // Example: "Confirmation# 757982788977.98" -> conf# is "7579827889", amount is "77.98"
  const confPattern = /Confirmation#\s*(\d{10})(\d*,?\d*\.\d{2})$/i;
  const match = confPattern.exec(line);
  if (match !== null && match[1] !== undefined && match[2] !== undefined) {
    const confirmationNum = match[1];
    const amount = match[2];
    // Remove the confirmation number from the line but keep the amount
    const cleanedLine = line.replace(confPattern, `Confirmation# ${confirmationNum} ${amount}`);
    return { cleanedLine, amount };
  }
  return null;
}

/**
 * Extract amount from Zelle lines where the Conf# code runs into the amount.
 * Zelle confirmation codes are alphanumeric (6-10 chars) and can concatenate with amount.
 * Example: "Conf# T0ZGTJ9B91,000.00" -> conf is "T0ZGTJ9B9", amount is "1,000.00"
 * 
 * Strategy: Generate all valid candidate splits, then choose the smallest amount.
 * This handles ambiguous cases like "91,000.00" vs "1,000.00" correctly.
 */
function extractAmountFromZelleConfLine(line: string): { cleanedLine: string; amount: string } | null {
  // First, check if this is a Zelle line with Conf#
  if (!/Zelle.*Conf#/i.test(line)) {
    return null;
  }
  
  // Find the Conf# position
  const confMatch = /Conf#\s*/i.exec(line);
  if (confMatch === null) {
    return null;
  }
  
  const afterConf = line.slice(confMatch.index + confMatch[0].length).trimStart();
  
  // Find last letter index - conf codes contain letters, amounts don't
  let lastLetterIndex = -1;
  for (let i = 0; i < afterConf.length; i++) {
    if (/[A-Za-z]/.test(afterConf[i] ?? '')) {
      lastLetterIndex = i;
    }
  }
  
  if (lastLetterIndex < 0) {
    return null;
  }
  
  type Candidate = { confCode: string; amountPart: string; amountNum: number };
  const candidates: Candidate[] = [];
  
  function considerCandidate(confCodeRaw: string, amountPartRaw: string): void {
    const confCode = confCodeRaw.trim();
    const amountPart = amountPartRaw.trim();
    
    // Conf code sanity checks
    if (confCode.length < 6 || confCode.length > 12) return;
    if (!/[A-Za-z]/.test(confCode)) return; // must contain letters
    if (confCode.endsWith(',')) return;
    
    // Amount sanity checks
    if (!/^-?\d{1,3}(?:,\d{3})*\.\d{2}$/.test(amountPart)) return;
    
    const amountNum = Math.abs(parseFloat(amountPart.replace(/,/g, '')));
    if (!Number.isFinite(amountNum) || amountNum === 0) return;
    
    candidates.push({ confCode, amountPart, amountNum });
  }
  
  // Scan all possible split points after the last letter
  for (let splitPos = afterConf.length - 1; splitPos >= lastLetterIndex + 1; splitPos--) {
    const confCode = afterConf.slice(0, splitPos);
    const amountPart = afterConf.slice(splitPos);
    considerCandidate(confCode, amountPart);
  }
  
  if (candidates.length === 0) {
    return null;
  }
  
  // Separate candidates into those with commas (>= 1,000) and without
  const withComma = candidates.filter(c => c.amountPart.includes(','));
  const withoutComma = candidates.filter(c => !c.amountPart.includes(','));
  
  let best: Candidate;
  
  if (withComma.length > 0) {
    // For amounts with commas: choose smallest amount (most digits went to conf code)
    // This handles "T0ZGTJ9B91,000.00" -> prefer "1,000.00" over "91,000.00"
    withComma.sort((a, b) => a.amountNum - b.amountNum || b.confCode.length - a.confCode.length);
    best = withComma[0]!;
  } else {
    // For amounts without commas: choose largest amount (fewest digits stolen from conf code)
    // This handles "T0ZDL3WND950.00" -> prefer "950.00" over "50.00"
    withoutComma.sort((a, b) => b.amountNum - a.amountNum || a.confCode.length - b.confCode.length);
    best = withoutComma[0]!;
  }
  
  const cleanedLine = line.slice(0, confMatch.index) + `Conf# ${best.confCode} ${best.amountPart}`;
  return { cleanedLine, amount: best.amountPart };
}

/**
 * Extract amount from lines where a long trace number is concatenated with the amount.
 * BoA CHECKCARD transactions have 17-25 digit trace numbers that can run into the amount.
 * Example: "CA 749064152172355304579864.32" -> trace is "74906415217235530457986", amount is "4.32"
 */
function extractAmountFromTraceNumberLine(line: string): { cleanedLine: string; amount: string } | null {
  // Pattern: State code followed by space, then long number (17-25 digits) concatenated with amount
  // The trace number is 17-25 digits, amount is typically 1-6 digits before decimal
  const tracePattern = /([A-Z]{2})\s+(\d{17,25})(\d{1,6}\.\d{2})$/;
  const match = tracePattern.exec(line);
  if (match !== null && match[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
    const stateCode = match[1];
    const traceNum = match[2];
    const amount = match[3];
    // Validate: amount should be reasonable (less than 100000)
    const amountNum = parseFloat(amount);
    if (amountNum < 100000) {
      const cleanedLine = line.replace(tracePattern, `${stateCode} ${traceNum} ${amount}`);
      return { cleanedLine, amount };
    }
  }
  return null;
}

function parseTransactionLine(
  line: string,
  pageNumber: number,
  lineIndex: number,
  statementYear: number,
  section: 'deposits' | 'withdrawals' | 'checks' | 'fees' | 'unknown'
): RawTransaction | null {
  const checkMatch = CHECKING_PATTERNS.checkLine.exec(line);
  if (checkMatch !== null) {
    const [, dateStr, checkNum, amountStr] = checkMatch;
    if (dateStr !== undefined && checkNum !== undefined && amountStr !== undefined) {
      let amount = amountStr;
      if (!amountStr.startsWith('-')) {
        amount = `-${amountStr}`;
      }
      return {
        date: parseUSDate(dateStr, statementYear),
        description: `Check #${checkNum}`,
        amount,
        page: pageNumber,
        lineIndex,
        originalLine: line,
        section,
      };
    }
  }

  // Check for confirmation number mixed with amount
  const confExtraction = extractAmountFromConfirmationLine(line);
  let workingLine = line;
  let extractedAmount: string | null = null;
  if (confExtraction !== null) {
    workingLine = confExtraction.cleanedLine;
    extractedAmount = confExtraction.amount;
  }

  // Check for Zelle Conf# code mixed with amount (alphanumeric codes)
  if (extractedAmount === null) {
    const zelleExtraction = extractAmountFromZelleConfLine(workingLine);
    if (zelleExtraction !== null) {
      workingLine = zelleExtraction.cleanedLine;
      extractedAmount = zelleExtraction.amount;
    }
  }

  // Check for trace number mixed with amount (long digit sequences before amount)
  if (extractedAmount === null) {
    const traceExtraction = extractAmountFromTraceNumberLine(workingLine);
    if (traceExtraction !== null) {
      workingLine = traceExtraction.cleanedLine;
      extractedAmount = traceExtraction.amount;
    }
  }

  const match = CHECKING_PATTERNS.transactionLine.exec(workingLine) ??
                CHECKING_PATTERNS.transactionLineAlt.exec(workingLine) ??
                CHECKING_PATTERNS.transactionLineBoA.exec(workingLine);

  if (match === null) return null;

  const [, dateStr, description, amountStr] = match;
  if (dateStr === undefined || description === undefined || amountStr === undefined) {
    return null;
  }

  // Use extracted amount if we found a confirmation number issue
  let amount = extractedAmount ?? amountStr;
  if (section === 'withdrawals' || section === 'checks' || section === 'fees') {
    if (!amount.startsWith('-')) {
      amount = `-${amount}`;
    }
  }

  return {
    date: parseUSDate(dateStr, statementYear),
    description: description.trim(),
    amount,
    page: pageNumber,
    lineIndex,
    originalLine: line,
    section,
  };
}
