/**
 * Plaid Liabilities API for credit card and loan balances.
 * Retrieves detailed liability information for credit accounts.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { getPlaidClient } from './client.js';

export interface CreditCardLiability {
  accountId: string;
  aprs: Array<{
    aprPercentage: number;
    aprType: string;
    balanceSubjectToApr: number | null;
    interestChargeAmount: number | null;
  }>;
  isOverdue: boolean | null;
  lastPaymentAmount: number | null;
  lastPaymentDate: string | null;
  lastStatementBalance: number | null;
  lastStatementIssueDate: string | null;
  minimumPaymentAmount: number | null;
  nextPaymentDueDate: string | null;
}

export interface MortgageLiability {
  accountId: string;
  accountNumber: string | null;
  currentLateFee: number | null;
  escrowBalance: number | null;
  hasPmi: boolean | null;
  hasPrepaymentPenalty: boolean | null;
  interestRate: {
    percentage: number | null;
    type: string | null;
  };
  lastPaymentAmount: number | null;
  lastPaymentDate: string | null;
  loanTerm: string | null;
  loanTypeDescription: string | null;
  maturityDate: string | null;
  nextMonthlyPayment: number | null;
  nextPaymentDueDate: string | null;
  originationDate: string | null;
  originationPrincipalAmount: number | null;
  pastDueAmount: number | null;
  propertyAddress: {
    city: string | null;
    country: string | null;
    postalCode: string | null;
    region: string | null;
    street: string | null;
  };
  ytdInterestPaid: number | null;
  ytdPrincipalPaid: number | null;
}

export interface StudentLoanLiability {
  accountId: string;
  accountNumber: string | null;
  disbursementDates: string[];
  expectedPayoffDate: string | null;
  guarantor: string | null;
  interestRatePercentage: number | null;
  isOverdue: boolean | null;
  lastPaymentAmount: number | null;
  lastPaymentDate: string | null;
  lastStatementBalance: number | null;
  lastStatementIssueDate: string | null;
  loanName: string | null;
  loanStatus: {
    endDate: string | null;
    type: string | null;
  };
  minimumPaymentAmount: number | null;
  nextPaymentDueDate: string | null;
  originationDate: string | null;
  originationPrincipalAmount: number | null;
  outstandingInterestAmount: number | null;
  paymentReferenceNumber: string | null;
  pslfStatus: {
    estimatedEligibilityDate: string | null;
    paymentsMade: number | null;
    paymentsRemaining: number | null;
  };
  repaymentPlan: {
    description: string | null;
    type: string | null;
  };
  sequenceNumber: string | null;
  servicerAddress: {
    city: string | null;
    country: string | null;
    postalCode: string | null;
    region: string | null;
    street: string | null;
  };
  ytdInterestPaid: number | null;
  ytdPrincipalPaid: number | null;
}

export interface LiabilitiesAccount {
  accountId: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: {
    available: number | null;
    current: number | null;
    limit: number | null;
    isoCurrencyCode: string | null;
  };
}

export interface LiabilitiesResult {
  accounts: LiabilitiesAccount[];
  liabilities: {
    credit: CreditCardLiability[];
    mortgage: MortgageLiability[];
    student: StudentLoanLiability[];
  };
  itemId: string;
  requestId: string;
}

/**
 * Get liabilities information for all credit accounts.
 * Requires the Liabilities product to be enabled for the Item.
 */
export async function getLiabilities(accessToken: string): Promise<LiabilitiesResult> {
  const client = getPlaidClient();

  const response = await client.liabilitiesGet({
    access_token: accessToken,
  });

  const accounts: LiabilitiesAccount[] = response.data.accounts.map((account: any) => ({
    accountId: account.account_id as string,
    name: account.name as string,
    mask: account.mask as string | null,
    type: account.type as string,
    subtype: account.subtype as string | null,
    balances: {
      available: account.balances?.available as number | null,
      current: account.balances?.current as number | null,
      limit: account.balances?.limit as number | null,
      isoCurrencyCode: account.balances?.iso_currency_code as string | null,
    },
  }));

  const liabilities = response.data.liabilities;

  const credit: CreditCardLiability[] = (liabilities.credit ?? []).map((c: any) => ({
    accountId: c.account_id as string,
    aprs: (c.aprs ?? []).map((apr: any) => ({
      aprPercentage: apr.apr_percentage as number,
      aprType: apr.apr_type as string,
      balanceSubjectToApr: apr.balance_subject_to_apr as number | null,
      interestChargeAmount: apr.interest_charge_amount as number | null,
    })),
    isOverdue: c.is_overdue as boolean | null,
    lastPaymentAmount: c.last_payment_amount as number | null,
    lastPaymentDate: c.last_payment_date as string | null,
    lastStatementBalance: c.last_statement_balance as number | null,
    lastStatementIssueDate: c.last_statement_issue_date as string | null,
    minimumPaymentAmount: c.minimum_payment_amount as number | null,
    nextPaymentDueDate: c.next_payment_due_date as string | null,
  }));

  const mortgage: MortgageLiability[] = (liabilities.mortgage ?? []).map((m: any) => ({
    accountId: m.account_id as string,
    accountNumber: m.account_number as string | null,
    currentLateFee: m.current_late_fee as number | null,
    escrowBalance: m.escrow_balance as number | null,
    hasPmi: m.has_pmi as boolean | null,
    hasPrepaymentPenalty: m.has_prepayment_penalty as boolean | null,
    interestRate: {
      percentage: m.interest_rate?.percentage as number | null,
      type: m.interest_rate?.type as string | null,
    },
    lastPaymentAmount: m.last_payment_amount as number | null,
    lastPaymentDate: m.last_payment_date as string | null,
    loanTerm: m.loan_term as string | null,
    loanTypeDescription: m.loan_type_description as string | null,
    maturityDate: m.maturity_date as string | null,
    nextMonthlyPayment: m.next_monthly_payment as number | null,
    nextPaymentDueDate: m.next_payment_due_date as string | null,
    originationDate: m.origination_date as string | null,
    originationPrincipalAmount: m.origination_principal_amount as number | null,
    pastDueAmount: m.past_due_amount as number | null,
    propertyAddress: {
      city: m.property_address?.city as string | null,
      country: m.property_address?.country as string | null,
      postalCode: m.property_address?.postal_code as string | null,
      region: m.property_address?.region as string | null,
      street: m.property_address?.street as string | null,
    },
    ytdInterestPaid: m.ytd_interest_paid as number | null,
    ytdPrincipalPaid: m.ytd_principal_paid as number | null,
  }));

  const student: StudentLoanLiability[] = (liabilities.student ?? []).map((s: any) => ({
    accountId: s.account_id as string,
    accountNumber: s.account_number as string | null,
    disbursementDates: (s.disbursement_dates ?? []) as string[],
    expectedPayoffDate: s.expected_payoff_date as string | null,
    guarantor: s.guarantor as string | null,
    interestRatePercentage: s.interest_rate_percentage as number | null,
    isOverdue: s.is_overdue as boolean | null,
    lastPaymentAmount: s.last_payment_amount as number | null,
    lastPaymentDate: s.last_payment_date as string | null,
    lastStatementBalance: s.last_statement_balance as number | null,
    lastStatementIssueDate: s.last_statement_issue_date as string | null,
    loanName: s.loan_name as string | null,
    loanStatus: {
      endDate: s.loan_status?.end_date as string | null,
      type: s.loan_status?.type as string | null,
    },
    minimumPaymentAmount: s.minimum_payment_amount as number | null,
    nextPaymentDueDate: s.next_payment_due_date as string | null,
    originationDate: s.origination_date as string | null,
    originationPrincipalAmount: s.origination_principal_amount as number | null,
    outstandingInterestAmount: s.outstanding_interest_amount as number | null,
    paymentReferenceNumber: s.payment_reference_number as string | null,
    pslfStatus: {
      estimatedEligibilityDate: s.pslf_status?.estimated_eligibility_date as string | null,
      paymentsMade: s.pslf_status?.payments_made as number | null,
      paymentsRemaining: s.pslf_status?.payments_remaining as number | null,
    },
    repaymentPlan: {
      description: s.repayment_plan?.description as string | null,
      type: s.repayment_plan?.type as string | null,
    },
    sequenceNumber: s.sequence_number as string | null,
    servicerAddress: {
      city: s.servicer_address?.city as string | null,
      country: s.servicer_address?.country as string | null,
      postalCode: s.servicer_address?.postal_code as string | null,
      region: s.servicer_address?.region as string | null,
      street: s.servicer_address?.street as string | null,
    },
    ytdInterestPaid: s.ytd_interest_paid as number | null,
    ytdPrincipalPaid: s.ytd_principal_paid as number | null,
  }));

  return {
    accounts,
    liabilities: { credit, mortgage, student },
    itemId: response.data.item.item_id,
    requestId: response.data.request_id,
  };
}

/**
 * Format liabilities result as a human-readable report.
 */
export function formatLiabilitiesReport(result: LiabilitiesResult): string {
  const lines: string[] = [];

  const formatCurrency = (amount: number | null): string => {
    if (amount === null) return 'N/A';
    return `$${amount.toFixed(2)}`;
  };

  lines.push('=== Liabilities Report ===');
  lines.push('');

  // Credit Cards
  if (result.liabilities.credit.length > 0) {
    lines.push('## Credit Cards');
    for (const cc of result.liabilities.credit) {
      const account = result.accounts.find((a) => a.accountId === cc.accountId);
      lines.push(`  ${account?.name ?? 'Unknown'} (****${account?.mask ?? '????'})`);
      lines.push(`    Balance: ${formatCurrency(account?.balances.current ?? null)}`);
      lines.push(`    Credit Limit: ${formatCurrency(account?.balances.limit ?? null)}`);
      lines.push(`    Last Statement: ${formatCurrency(cc.lastStatementBalance)}`);
      lines.push(`    Minimum Payment: ${formatCurrency(cc.minimumPaymentAmount)}`);
      lines.push(`    Next Due: ${cc.nextPaymentDueDate ?? 'N/A'}`);
      if (cc.isOverdue === true) {
        lines.push('    ⚠️ OVERDUE');
      }
      if (cc.aprs.length > 0) {
        lines.push('    APRs:');
        for (const apr of cc.aprs) {
          lines.push(`      ${apr.aprType}: ${apr.aprPercentage.toFixed(2)}%`);
        }
      }
      lines.push('');
    }
  }

  // Mortgages
  if (result.liabilities.mortgage.length > 0) {
    lines.push('## Mortgages');
    for (const m of result.liabilities.mortgage) {
      const account = result.accounts.find((a) => a.accountId === m.accountId);
      lines.push(`  ${account?.name ?? 'Unknown'} (****${account?.mask ?? '????'})`);
      lines.push(`    Balance: ${formatCurrency(account?.balances.current ?? null)}`);
      lines.push(`    Original Amount: ${formatCurrency(m.originationPrincipalAmount)}`);
      lines.push(`    Interest Rate: ${m.interestRate.percentage !== null ? `${m.interestRate.percentage}%` : 'N/A'} (${m.interestRate.type ?? 'N/A'})`);
      lines.push(`    Monthly Payment: ${formatCurrency(m.nextMonthlyPayment)}`);
      lines.push(`    Next Due: ${m.nextPaymentDueDate ?? 'N/A'}`);
      lines.push(`    Maturity: ${m.maturityDate ?? 'N/A'}`);
      lines.push(`    YTD Interest: ${formatCurrency(m.ytdInterestPaid)}`);
      lines.push(`    YTD Principal: ${formatCurrency(m.ytdPrincipalPaid)}`);
      lines.push('');
    }
  }

  // Student Loans
  if (result.liabilities.student.length > 0) {
    lines.push('## Student Loans');
    for (const s of result.liabilities.student) {
      const account = result.accounts.find((a) => a.accountId === s.accountId);
      lines.push(`  ${s.loanName ?? account?.name ?? 'Unknown'}`);
      lines.push(`    Balance: ${formatCurrency(account?.balances.current ?? null)}`);
      lines.push(`    Original Amount: ${formatCurrency(s.originationPrincipalAmount)}`);
      lines.push(`    Interest Rate: ${s.interestRatePercentage !== null ? `${s.interestRatePercentage}%` : 'N/A'}`);
      lines.push(`    Minimum Payment: ${formatCurrency(s.minimumPaymentAmount)}`);
      lines.push(`    Next Due: ${s.nextPaymentDueDate ?? 'N/A'}`);
      lines.push(`    Expected Payoff: ${s.expectedPayoffDate ?? 'N/A'}`);
      if (s.isOverdue === true) {
        lines.push('    ⚠️ OVERDUE');
      }
      lines.push('');
    }
  }

  if (result.liabilities.credit.length === 0 &&
      result.liabilities.mortgage.length === 0 &&
      result.liabilities.student.length === 0) {
    lines.push('No liabilities found.');
  }

  return lines.join('\n');
}
