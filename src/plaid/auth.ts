/**
 * Plaid Auth API for ACH routing and account numbers.
 * Retrieves bank account and routing numbers for ACH transfers.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { getPlaidClient } from './client.js';

export interface ACHNumbers {
  accountId: string;
  account: string;
  routing: string;
  wireRouting: string | null;
}

export interface EFTNumbers {
  accountId: string;
  account: string;
  institution: string;
  branch: string;
}

export interface InternationalNumbers {
  accountId: string;
  iban: string | null;
  bic: string | null;
}

export interface BACSNumbers {
  accountId: string;
  account: string;
  sortCode: string;
}

export interface AuthAccount {
  accountId: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  officialName: string | null;
  balances: {
    available: number | null;
    current: number | null;
    limit: number | null;
    isoCurrencyCode: string | null;
  };
}

export interface AuthResult {
  accounts: AuthAccount[];
  numbers: {
    ach: ACHNumbers[];
    eft: EFTNumbers[];
    international: InternationalNumbers[];
    bacs: BACSNumbers[];
  };
  itemId: string;
  requestId: string;
}

/**
 * Get auth information (account and routing numbers) for all accounts.
 * Requires the Auth product to be enabled for the Item.
 */
export async function getAuth(accessToken: string): Promise<AuthResult> {
  const client = getPlaidClient();

  const response = await client.authGet({
    access_token: accessToken,
  });

  const accounts: AuthAccount[] = response.data.accounts.map((account: any) => ({
    accountId: account.account_id as string,
    name: account.name as string,
    mask: account.mask as string | null,
    type: account.type as string,
    subtype: account.subtype as string | null,
    officialName: account.official_name as string | null,
    balances: {
      available: account.balances?.available as number | null,
      current: account.balances?.current as number | null,
      limit: account.balances?.limit as number | null,
      isoCurrencyCode: account.balances?.iso_currency_code as string | null,
    },
  }));

  const numbers = response.data.numbers;

  const ach: ACHNumbers[] = (numbers.ach ?? []).map((n: any) => ({
    accountId: n.account_id as string,
    account: n.account as string,
    routing: n.routing as string,
    wireRouting: n.wire_routing as string | null,
  }));

  const eft: EFTNumbers[] = (numbers.eft ?? []).map((n: any) => ({
    accountId: n.account_id as string,
    account: n.account as string,
    institution: n.institution as string,
    branch: n.branch as string,
  }));

  const international: InternationalNumbers[] = (numbers.international ?? []).map((n: any) => ({
    accountId: n.account_id as string,
    iban: n.iban as string | null,
    bic: n.bic as string | null,
  }));

  const bacs: BACSNumbers[] = (numbers.bacs ?? []).map((n: any) => ({
    accountId: n.account_id as string,
    account: n.account as string,
    sortCode: n.sort_code as string,
  }));

  return {
    accounts,
    numbers: { ach, eft, international, bacs },
    itemId: response.data.item.item_id,
    requestId: response.data.request_id,
  };
}

/**
 * Format auth result as a human-readable report.
 * WARNING: This contains sensitive account numbers - handle with care!
 */
export function formatAuthReport(result: AuthResult, maskNumbers = true): string {
  const lines: string[] = [];

  const mask = (value: string | null, showLast = 4): string => {
    if (value === null) return 'N/A';
    if (!maskNumbers) return value;
    if (value.length <= showLast) return value;
    return '*'.repeat(value.length - showLast) + value.slice(-showLast);
  };

  lines.push('=== Auth Report ===');
  lines.push('');

  for (const account of result.accounts) {
    lines.push(`Account: ${account.name} (****${account.mask ?? '????'})`);
    lines.push(`  Type: ${account.type}/${account.subtype ?? 'N/A'}`);
    lines.push(`  ID: ${account.accountId}`);

    // Find ACH numbers for this account
    const achNumbers = result.numbers.ach.find((n) => n.accountId === account.accountId);
    if (achNumbers !== undefined) {
      lines.push('  ACH:');
      lines.push(`    Account: ${mask(achNumbers.account)}`);
      lines.push(`    Routing: ${mask(achNumbers.routing)}`);
      if (achNumbers.wireRouting !== null) {
        lines.push(`    Wire Routing: ${mask(achNumbers.wireRouting)}`);
      }
    }

    // Find EFT numbers for this account
    const eftNumbers = result.numbers.eft.find((n) => n.accountId === account.accountId);
    if (eftNumbers !== undefined) {
      lines.push('  EFT:');
      lines.push(`    Account: ${mask(eftNumbers.account)}`);
      lines.push(`    Institution: ${eftNumbers.institution}`);
      lines.push(`    Branch: ${eftNumbers.branch}`);
    }

    // Find international numbers for this account
    const intlNumbers = result.numbers.international.find((n) => n.accountId === account.accountId);
    if (intlNumbers !== undefined) {
      lines.push('  International:');
      if (intlNumbers.iban !== null) {
        lines.push(`    IBAN: ${mask(intlNumbers.iban, 6)}`);
      }
      if (intlNumbers.bic !== null) {
        lines.push(`    BIC: ${intlNumbers.bic}`);
      }
    }

    // Find BACS numbers for this account
    const bacsNumbers = result.numbers.bacs.find((n) => n.accountId === account.accountId);
    if (bacsNumbers !== undefined) {
      lines.push('  BACS:');
      lines.push(`    Account: ${mask(bacsNumbers.account)}`);
      lines.push(`    Sort Code: ${bacsNumbers.sortCode}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
