/**
 * Plaid Identity API for account owner verification.
 * Retrieves personal information associated with linked accounts.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */

import { getPlaidClient } from './client.js';

export interface IdentityAddress {
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  primary?: boolean;
}

export interface IdentityEmail {
  data: string;
  primary: boolean;
  type: 'primary' | 'secondary' | 'other';
}

export interface IdentityPhone {
  data: string;
  primary: boolean;
  type: 'home' | 'work' | 'mobile' | 'other';
}

export interface IdentityOwner {
  names: string[];
  addresses: IdentityAddress[];
  emails: IdentityEmail[];
  phoneNumbers: IdentityPhone[];
}

export interface AccountIdentity {
  accountId: string;
  accountName: string;
  accountMask: string | null;
  accountType: string;
  accountSubtype: string | null;
  owners: IdentityOwner[];
}

export interface IdentityResult {
  accounts: AccountIdentity[];
  itemId: string;
  requestId: string;
}

/**
 * Get identity information for all accounts associated with an access token.
 * Requires the Identity product to be enabled for the Item.
 */
export async function getIdentity(accessToken: string): Promise<IdentityResult> {
  const client = getPlaidClient();

  const response = await client.identityGet({
    access_token: accessToken,
  });

  const accounts: AccountIdentity[] = response.data.accounts.map((account: any) => {
    const owners: IdentityOwner[] = (account.owners ?? []).map((owner: any) => {
      const addresses: IdentityAddress[] = (owner.addresses ?? []).map((addr: any) => {
        const address: IdentityAddress = {};
        if (addr.data?.street) address.street = addr.data.street;
        if (addr.data?.city) address.city = addr.data.city;
        if (addr.data?.region) address.region = addr.data.region;
        if (addr.data?.postal_code) address.postalCode = addr.data.postal_code;
        if (addr.data?.country) address.country = addr.data.country;
        if (addr.primary !== undefined) address.primary = addr.primary;
        return address;
      });

      const emails: IdentityEmail[] = (owner.emails ?? []).map((email: any) => ({
        data: email.data as string,
        primary: email.primary as boolean,
        type: email.type as IdentityEmail['type'],
      }));

      const phoneNumbers: IdentityPhone[] = (owner.phone_numbers ?? []).map((phone: any) => ({
        data: phone.data as string,
        primary: phone.primary as boolean,
        type: phone.type as IdentityPhone['type'],
      }));

      return {
        names: owner.names as string[],
        addresses,
        emails,
        phoneNumbers,
      };
    });

    return {
      accountId: account.account_id as string,
      accountName: account.name as string,
      accountMask: account.mask as string | null,
      accountType: account.type as string,
      accountSubtype: account.subtype as string | null,
      owners,
    };
  });

  return {
    accounts,
    itemId: response.data.item.item_id,
    requestId: response.data.request_id,
  };
}

/**
 * Format identity result as a human-readable report.
 */
export function formatIdentityReport(result: IdentityResult): string {
  const lines: string[] = [];

  lines.push('=== Account Identity Report ===');
  lines.push('');

  for (const account of result.accounts) {
    lines.push(`Account: ${account.accountName} (****${account.accountMask ?? '????'})`);
    lines.push(`  Type: ${account.accountType}/${account.accountSubtype ?? 'N/A'}`);
    lines.push(`  ID: ${account.accountId}`);

    for (const owner of account.owners) {
      lines.push('  Owner:');
      if (owner.names.length > 0) {
        lines.push(`    Names: ${owner.names.join(', ')}`);
      }

      if (owner.addresses.length > 0) {
        lines.push('    Addresses:');
        for (const addr of owner.addresses) {
          const parts = [addr.street, addr.city, addr.region, addr.postalCode, addr.country]
            .filter(Boolean);
          lines.push(`      ${addr.primary === true ? '(Primary) ' : ''}${parts.join(', ')}`);
        }
      }

      if (owner.emails.length > 0) {
        lines.push('    Emails:');
        for (const email of owner.emails) {
          lines.push(`      ${email.primary ? '(Primary) ' : ''}${email.data} [${email.type}]`);
        }
      }

      if (owner.phoneNumbers.length > 0) {
        lines.push('    Phone Numbers:');
        for (const phone of owner.phoneNumbers) {
          lines.push(`      ${phone.primary ? '(Primary) ' : ''}${phone.data} [${phone.type}]`);
        }
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}
