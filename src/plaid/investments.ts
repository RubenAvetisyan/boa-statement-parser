/**
 * Plaid Investments API for portfolio tracking.
 * Retrieves holdings and investment transactions.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { getPlaidClient } from './client.js';

export interface Security {
  securityId: string;
  isin: string | null;
  cusip: string | null;
  sedol: string | null;
  institutionSecurityId: string | null;
  institutionId: string | null;
  proxySecurityId: string | null;
  name: string | null;
  tickerSymbol: string | null;
  isCashEquivalent: boolean | null;
  type: string | null;
  closePrice: number | null;
  closePriceAsOf: string | null;
  isoCurrencyCode: string | null;
  unofficialCurrencyCode: string | null;
}

export interface Holding {
  accountId: string;
  securityId: string;
  institutionPrice: number;
  institutionPriceAsOf: string | null;
  institutionPriceDatetime: string | null;
  institutionValue: number;
  costBasis: number | null;
  quantity: number;
  isoCurrencyCode: string | null;
  unofficialCurrencyCode: string | null;
  vestedQuantity: number | null;
  vestedValue: number | null;
}

export interface InvestmentTransaction {
  investmentTransactionId: string;
  accountId: string;
  securityId: string | null;
  date: string;
  name: string;
  quantity: number;
  amount: number;
  price: number;
  fees: number | null;
  type: string;
  subtype: string | null;
  isoCurrencyCode: string | null;
  unofficialCurrencyCode: string | null;
}

export interface InvestmentAccount {
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

export interface HoldingsResult {
  accounts: InvestmentAccount[];
  holdings: Holding[];
  securities: Security[];
  itemId: string;
  requestId: string;
}

export interface InvestmentTransactionsResult {
  accounts: InvestmentAccount[];
  investmentTransactions: InvestmentTransaction[];
  securities: Security[];
  totalInvestmentTransactions: number;
  itemId: string;
  requestId: string;
}

/**
 * Get investment holdings for all investment accounts.
 * Requires the Investments product to be enabled for the Item.
 */
export async function getHoldings(accessToken: string): Promise<HoldingsResult> {
  const client = getPlaidClient();

  const response = await client.investmentsHoldingsGet({
    access_token: accessToken,
  });

  const accounts: InvestmentAccount[] = response.data.accounts.map((account: any) => ({
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

  const holdings: Holding[] = response.data.holdings.map((h: any) => ({
    accountId: h.account_id as string,
    securityId: h.security_id as string,
    institutionPrice: h.institution_price as number,
    institutionPriceAsOf: h.institution_price_as_of as string | null,
    institutionPriceDatetime: h.institution_price_datetime as string | null,
    institutionValue: h.institution_value as number,
    costBasis: h.cost_basis as number | null,
    quantity: h.quantity as number,
    isoCurrencyCode: h.iso_currency_code as string | null,
    unofficialCurrencyCode: h.unofficial_currency_code as string | null,
    vestedQuantity: h.vested_quantity as number | null,
    vestedValue: h.vested_value as number | null,
  }));

  const securities: Security[] = response.data.securities.map((s: any) => ({
    securityId: s.security_id as string,
    isin: s.isin as string | null,
    cusip: s.cusip as string | null,
    sedol: s.sedol as string | null,
    institutionSecurityId: s.institution_security_id as string | null,
    institutionId: s.institution_id as string | null,
    proxySecurityId: s.proxy_security_id as string | null,
    name: s.name as string | null,
    tickerSymbol: s.ticker_symbol as string | null,
    isCashEquivalent: s.is_cash_equivalent as boolean | null,
    type: s.type as string | null,
    closePrice: s.close_price as number | null,
    closePriceAsOf: s.close_price_as_of as string | null,
    isoCurrencyCode: s.iso_currency_code as string | null,
    unofficialCurrencyCode: s.unofficial_currency_code as string | null,
  }));

  return {
    accounts,
    holdings,
    securities,
    itemId: response.data.item.item_id,
    requestId: response.data.request_id,
  };
}

/**
 * Get investment transactions for all investment accounts.
 * Requires the Investments product to be enabled for the Item.
 */
export async function getInvestmentTransactions(
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<InvestmentTransactionsResult> {
  const client = getPlaidClient();

  const response = await client.investmentsTransactionsGet({
    access_token: accessToken,
    start_date: startDate,
    end_date: endDate,
  });

  const accounts: InvestmentAccount[] = response.data.accounts.map((account: any) => ({
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

  const investmentTransactions: InvestmentTransaction[] = response.data.investment_transactions.map((t: any) => ({
    investmentTransactionId: t.investment_transaction_id as string,
    accountId: t.account_id as string,
    securityId: t.security_id as string | null,
    date: t.date as string,
    name: t.name as string,
    quantity: t.quantity as number,
    amount: t.amount as number,
    price: t.price as number,
    fees: t.fees as number | null,
    type: t.type as string,
    subtype: t.subtype as string | null,
    isoCurrencyCode: t.iso_currency_code as string | null,
    unofficialCurrencyCode: t.unofficial_currency_code as string | null,
  }));

  const securities: Security[] = response.data.securities.map((s: any) => ({
    securityId: s.security_id as string,
    isin: s.isin as string | null,
    cusip: s.cusip as string | null,
    sedol: s.sedol as string | null,
    institutionSecurityId: s.institution_security_id as string | null,
    institutionId: s.institution_id as string | null,
    proxySecurityId: s.proxy_security_id as string | null,
    name: s.name as string | null,
    tickerSymbol: s.ticker_symbol as string | null,
    isCashEquivalent: s.is_cash_equivalent as boolean | null,
    type: s.type as string | null,
    closePrice: s.close_price as number | null,
    closePriceAsOf: s.close_price_as_of as string | null,
    isoCurrencyCode: s.iso_currency_code as string | null,
    unofficialCurrencyCode: s.unofficial_currency_code as string | null,
  }));

  return {
    accounts,
    investmentTransactions,
    securities,
    totalInvestmentTransactions: response.data.total_investment_transactions,
    itemId: response.data.item.item_id,
    requestId: response.data.request_id,
  };
}

/**
 * Format holdings result as a human-readable report.
 */
export function formatHoldingsReport(result: HoldingsResult): string {
  const lines: string[] = [];

  const formatCurrency = (amount: number | null): string => {
    if (amount === null) return 'N/A';
    return `$${amount.toFixed(2)}`;
  };

  lines.push('=== Investment Holdings Report ===');
  lines.push('');

  // Group holdings by account
  const holdingsByAccount = new Map<string, Holding[]>();
  for (const holding of result.holdings) {
    const existing = holdingsByAccount.get(holding.accountId) ?? [];
    existing.push(holding);
    holdingsByAccount.set(holding.accountId, existing);
  }

  // Create security lookup
  const securityMap = new Map<string, Security>();
  for (const security of result.securities) {
    securityMap.set(security.securityId, security);
  }

  for (const account of result.accounts) {
    lines.push(`## ${account.name} (****${account.mask ?? '????'})`);
    lines.push(`   Type: ${account.type}/${account.subtype ?? 'N/A'}`);
    lines.push(`   Total Value: ${formatCurrency(account.balances.current)}`);
    lines.push('');

    const accountHoldings = holdingsByAccount.get(account.accountId) ?? [];
    if (accountHoldings.length === 0) {
      lines.push('   No holdings');
    } else {
      lines.push('   Holdings:');
      for (const holding of accountHoldings) {
        const security = securityMap.get(holding.securityId);
        const symbol = security?.tickerSymbol ?? security?.name ?? 'Unknown';
        const gainLoss = holding.costBasis !== null
          ? holding.institutionValue - holding.costBasis
          : null;
        const gainLossPercent = holding.costBasis !== null && holding.costBasis > 0
          ? ((holding.institutionValue - holding.costBasis) / holding.costBasis) * 100
          : null;

        lines.push(`     ${symbol}`);
        lines.push(`       Quantity: ${holding.quantity.toFixed(4)}`);
        lines.push(`       Price: ${formatCurrency(holding.institutionPrice)}`);
        lines.push(`       Value: ${formatCurrency(holding.institutionValue)}`);
        if (holding.costBasis !== null) {
          lines.push(`       Cost Basis: ${formatCurrency(holding.costBasis)}`);
          lines.push(`       Gain/Loss: ${formatCurrency(gainLoss)} (${gainLossPercent !== null ? gainLossPercent.toFixed(2) : 'N/A'}%)`);
        }
      }
    }
    lines.push('');
  }

  // Summary
  const totalValue = result.holdings.reduce((sum, h) => sum + h.institutionValue, 0);
  const totalCostBasis = result.holdings.reduce((sum, h) => sum + (h.costBasis ?? 0), 0);
  const totalGainLoss = totalValue - totalCostBasis;

  lines.push('## Summary');
  lines.push(`   Total Portfolio Value: ${formatCurrency(totalValue)}`);
  lines.push(`   Total Cost Basis: ${formatCurrency(totalCostBasis)}`);
  lines.push(`   Total Gain/Loss: ${formatCurrency(totalGainLoss)}`);

  return lines.join('\n');
}
