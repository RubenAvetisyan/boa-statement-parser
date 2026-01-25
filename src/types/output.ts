/**
 * Output types aligned with schemas/final_result.*.schema.json
 * These are the canonical types for parser output.
 */

export type ISODate = `${number}-${number}-${number}`;
export type ISODateTime = string;

export type AccountType = 'checking' | 'savings' | 'credit';
export type Direction = 'debit' | 'credit';

export type Category =
  | 'Income'
  | 'Housing'
  | 'Utilities'
  | 'Transportation'
  | 'Food & Dining'
  | 'Shopping'
  | 'Entertainment'
  | 'Health'
  | 'Financial'
  | 'Transfer'
  | 'Fees'
  | 'Travel'
  | 'Education'
  | 'Personal Care'
  | 'Insurance'
  | 'Taxes'
  | 'Charity'
  | 'Pets'
  | 'Childcare'
  | 'Uncategorized';

export type Subcategory =
  | 'Salary' | 'Interest' | 'Dividends' | 'Refund' | 'Transfer'
  | 'Rent' | 'Mortgage' | 'HOA' | 'Property Tax'
  | 'Electric' | 'Gas' | 'Water' | 'Internet' | 'Phone'
  | 'Rideshare' | 'Public Transit' | 'Parking' | 'Tolls' | 'Insurance' | 'Registration'
  | 'Groceries' | 'Restaurants' | 'Food Delivery' | 'Alcohol'
  | 'Online' | 'General Merchandise' | 'Electronics' | 'Clothing' | 'Home Improvement' | 'Convenience Store'
  | 'Streaming' | 'Movies' | 'Events' | 'Fitness' | 'Gaming'
  | 'Pharmacy' | 'Medical' | 'Dental' | 'Vision'
  | 'ATM' | 'Deposit' | 'Fees' | 'Credit Card Payment' | 'Investment' | 'Cash Advance' | 'Payment' | 'Loan Payment' | 'Check'
  | 'Zelle' | 'Venmo' | 'Wire' | 'ACH' | 'Internal' | 'Bank'
  | 'Flights' | 'Lodging' | 'Car Rental'
  | 'Tuition' | 'Learning' | 'Certification'
  | 'Grooming' | 'Beauty'
  | 'Life' | 'Renters'
  | 'Tax Payment' | 'Tax Preparation'
  | 'Donation'
  | 'Pet Care'
  | 'Daycare'
  | 'AI Services' | 'Developer Tools' | 'Productivity' | 'Subscription' | 'Security'
  | null;

export type ChannelType =
  | 'CHECKCARD'
  | 'PURCHASE'
  | 'ATM_DEPOSIT'
  | 'ATM_WITHDRAWAL'
  | 'FINANCIAL_CENTER_DEPOSIT'
  | 'ONLINE_BANKING_TRANSFER'
  | 'ZELLE'
  | 'CHECK'
  | 'FEE'
  | 'OTHER';

export type SectionType = 'deposits' | 'atm_debit' | 'other_subtractions' | 'checks' | 'service_fees' | null;

export type CardNetwork = 'VISA' | 'MASTERCARD' | 'AMEX' | 'DISCOVER' | null;

export interface StatementFileOutput {
  schemaVersion: '1.0.0';
  source: {
    fileName: string;
    fileType: 'pdf';
    checksumSha256?: string;
    pageCount?: number;
  };
  statements: Statement[];
  metadata: {
    parser: {
      name: string;
      version: string;
      build?: string;
    };
    parsedAt: ISODateTime;
    warnings: string[];
    notes?: string[];
  };
}

export interface Statement {
  statementId: string;
  account: {
    institution: 'Bank of America';
    productName?: string;
    accountType: AccountType;
    accountNumberMasked: string;
    currency: 'USD';
    statementPeriod: {
      start: ISODate;
      end: ISODate;
    };
    statementCycle?: string;
  };

  summary: {
    beginningBalance: number;
    endingBalance: number;
    depositsAndOtherAdditions?: number;
    atmAndDebitCardSubtractions?: number;
    otherSubtractions?: number;
    checksTotal?: number;
    serviceFeesTotal?: number;
    totalCredits: number;
    totalDebits: number;
    transactionCount: number;
  };

  sections?: {
    deposits?: StatementSectionTotals;
    atmAndDebitCard?: StatementSectionTotals;
    otherSubtractions?: StatementSectionTotals;
    checks?: StatementSectionTotals;
    serviceFees?: StatementSectionTotals;
  };

  transactions: Transaction[];

  provenance: {
    pageStart?: number;
    pageEnd?: number;
    extractedFromText: boolean;
  };
}

export interface StatementSectionTotals {
  total?: number;
  count?: number;
  rawTotalLine?: string;
}

export interface Transaction {
  transactionId: string;
  date: ISODate;
  postedDate: ISODate | null;
  amount: number;
  direction: Direction;
  description: string;
  descriptionRaw: string;

  merchant: {
    name: string | null;
    normalizedName?: string | null;
    city?: string | null;
    state?: string | null;
    phone?: string | null;
    online?: boolean | null;
    network?: CardNetwork;
  };

  bankReference: {
    cardTransactionTraceNumber?: string | null;
    confirmationNumber?: string | null;
    zelleConfirmation?: string | null;
    checkNumber?: string | null;
    atmId?: string | null;
    terminalOrStoreId?: string | null;
  };

  channel: {
    type: ChannelType;
    subtype?: string | null;
  };

  categorization: {
    category: Category;
    subcategory: Subcategory;
    confidence: number;
    ruleId?: string | null;
    rationale?: string | null;
  };

  raw: {
    page: number;
    lineIndex?: number;
    section?: SectionType;
    originalText: string;
  };

  flags?: {
    isRecurring?: boolean;
    isSubscription?: boolean;
    isTransfer?: boolean;
    isCashWithdrawal?: boolean;
    isCashDeposit?: boolean;
    possibleDuplicate?: boolean;
  };
}

export interface ParsedLine {
  date: string;
  description: string;
  amount: string;
  page: number;
  lineIndex: number;
  originalText: string;
  section: SectionType;
  isContinuation: boolean;
}

export interface ChannelInfo {
  type: ChannelType;
  subtype: string | null;
}

export interface BankReferenceInfo {
  cardTransactionTraceNumber: string | null;
  confirmationNumber: string | null;
  zelleConfirmation: string | null;
  checkNumber: string | null;
  atmId: string | null;
  terminalOrStoreId: string | null;
}

export interface MerchantInfo {
  name: string | null;
  normalizedName: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  online: boolean | null;
  network: CardNetwork;
}
