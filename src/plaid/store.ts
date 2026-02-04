/**
 * Plaid token storage interface.
 * Provides an abstraction for storing and retrieving Plaid Items.
 * Default implementation uses Supabase, but can be extended for other stores.
 */

/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlaidItem, PlaidItemStatus } from './types.js';

export interface PlaidItemStore {
  getItem(itemId: string): Promise<PlaidItem | null>;
  getItemByAccessToken(accessToken: string): Promise<PlaidItem | null>;
  getItemsByUserId(userId: string): Promise<PlaidItem[]>;
  saveItem(item: PlaidItem): Promise<void>;
  updateItem(itemId: string, updates: Partial<PlaidItem>): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
  updateSyncCursor(itemId: string, cursor: string): Promise<void>;
  updateStatus(itemId: string, status: PlaidItemStatus): Promise<void>;
}

/**
 * In-memory store for development and testing.
 */
export class InMemoryPlaidItemStore implements PlaidItemStore {
  private items: Map<string, PlaidItem> = new Map();

  async getItem(itemId: string): Promise<PlaidItem | null> {
    return this.items.get(itemId) ?? null;
  }

  async getItemByAccessToken(accessToken: string): Promise<PlaidItem | null> {
    for (const item of this.items.values()) {
      if (item.accessToken === accessToken) {
        return item;
      }
    }
    return null;
  }

  async getItemsByUserId(userId: string): Promise<PlaidItem[]> {
    const result: PlaidItem[] = [];
    for (const item of this.items.values()) {
      if (item.userId === userId) {
        result.push(item);
      }
    }
    return result;
  }

  async saveItem(item: PlaidItem): Promise<void> {
    this.items.set(item.itemId, item);
  }

  async updateItem(itemId: string, updates: Partial<PlaidItem>): Promise<void> {
    const existing = this.items.get(itemId);
    if (existing !== undefined) {
      this.items.set(itemId, {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async deleteItem(itemId: string): Promise<void> {
    this.items.delete(itemId);
  }

  async updateSyncCursor(itemId: string, cursor: string): Promise<void> {
    await this.updateItem(itemId, {
      syncCursor: cursor,
      lastSyncAt: new Date().toISOString(),
    });
  }

  async updateStatus(itemId: string, status: PlaidItemStatus): Promise<void> {
    await this.updateItem(itemId, { status });
  }

  clear(): void {
    this.items.clear();
  }
}

/**
 * Supabase-backed store for production use.
 * Stores Plaid Items in a dedicated table with RLS.
 */
export class SupabasePlaidItemStore implements PlaidItemStore {
  constructor(private client: SupabaseClient, private tableName: string = 'plaid_items') {}

  async getItem(itemId: string): Promise<PlaidItem | null> {
    const { data, error } = await this.client
      .from(this.tableName)
      .select('*')
      .eq('item_id', itemId)
      .single();

    if (error !== null || data === null) {
      return null;
    }

    return this.rowToItem(data);
  }

  async getItemByAccessToken(accessToken: string): Promise<PlaidItem | null> {
    const { data, error } = await this.client
      .from(this.tableName)
      .select('*')
      .eq('access_token', accessToken)
      .single();

    if (error !== null || data === null) {
      return null;
    }

    return this.rowToItem(data);
  }

  async getItemsByUserId(userId: string): Promise<PlaidItem[]> {
    const { data, error } = await this.client
      .from(this.tableName)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error !== null || data === null) {
      return [];
    }

    return data.map((row) => this.rowToItem(row));
  }

  async saveItem(item: PlaidItem): Promise<void> {
    const row = this.itemToRow(item);

    const { error } = await this.client.from(this.tableName).upsert(row, {
      onConflict: 'item_id',
    });

    if (error !== null) {
      throw new Error(`Failed to save Plaid item: ${error.message}`);
    }
  }

  async updateItem(itemId: string, updates: Partial<PlaidItem>): Promise<void> {
    const row: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.accessToken !== undefined) row['access_token'] = updates.accessToken;
    if (updates.institutionId !== undefined) row['institution_id'] = updates.institutionId;
    if (updates.institutionName !== undefined) row['institution_name'] = updates.institutionName;
    if (updates.syncCursor !== undefined) row['sync_cursor'] = updates.syncCursor;
    if (updates.lastSyncAt !== undefined) row['last_sync_at'] = updates.lastSyncAt;
    if (updates.status !== undefined) row['status'] = updates.status;
    if (updates.availableProducts !== undefined) row['available_products'] = updates.availableProducts;
    if (updates.billedProducts !== undefined) row['billed_products'] = updates.billedProducts;
    if (updates.consentExpirationTime !== undefined) row['consent_expiration_time'] = updates.consentExpirationTime;

    const { error } = await this.client
      .from(this.tableName)
      .update(row)
      .eq('item_id', itemId);

    if (error !== null) {
      throw new Error(`Failed to update Plaid item: ${error.message}`);
    }
  }

  async deleteItem(itemId: string): Promise<void> {
    const { error } = await this.client.from(this.tableName).delete().eq('item_id', itemId);

    if (error !== null) {
      throw new Error(`Failed to delete Plaid item: ${error.message}`);
    }
  }

  async updateSyncCursor(itemId: string, cursor: string): Promise<void> {
    await this.updateItem(itemId, {
      syncCursor: cursor,
      lastSyncAt: new Date().toISOString(),
    });
  }

  async updateStatus(itemId: string, status: PlaidItemStatus): Promise<void> {
    await this.updateItem(itemId, { status });
  }

  private rowToItem(row: Record<string, unknown>): PlaidItem {
    const item: PlaidItem = {
      itemId: row['item_id'] as string,
      accessToken: row['access_token'] as string,
      institutionId: row['institution_id'] as string,
      institutionName: row['institution_name'] as string,
      userId: row['user_id'] as string,
      status: row['status'] as PlaidItemStatus,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };

    const syncCursor = row['sync_cursor'];
    if (typeof syncCursor === 'string') item.syncCursor = syncCursor;

    const lastSyncAt = row['last_sync_at'];
    if (typeof lastSyncAt === 'string') item.lastSyncAt = lastSyncAt;

    const availableProducts = row['available_products'];
    if (Array.isArray(availableProducts)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item as any).availableProducts = availableProducts;
    }

    const billedProducts = row['billed_products'];
    if (Array.isArray(billedProducts)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item as any).billedProducts = billedProducts;
    }

    const consentExpirationTime = row['consent_expiration_time'];
    if (typeof consentExpirationTime === 'string') item.consentExpirationTime = consentExpirationTime;

    return item;
  }

  private itemToRow(item: PlaidItem): Record<string, unknown> {
    return {
      item_id: item.itemId,
      access_token: item.accessToken,
      institution_id: item.institutionId,
      institution_name: item.institutionName,
      user_id: item.userId,
      sync_cursor: item.syncCursor,
      last_sync_at: item.lastSyncAt,
      status: item.status,
      available_products: item.availableProducts,
      billed_products: item.billedProducts,
      consent_expiration_time: item.consentExpirationTime,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    };
  }
}

let defaultStore: PlaidItemStore | null = null;

/**
 * Get the default Plaid item store.
 * Uses in-memory store if no Supabase client is provided.
 */
export function getPlaidItemStore(supabaseClient?: SupabaseClient): PlaidItemStore {
  if (defaultStore === null) {
    if (supabaseClient !== undefined) {
      defaultStore = new SupabasePlaidItemStore(supabaseClient);
    } else {
      defaultStore = new InMemoryPlaidItemStore();
    }
  }
  return defaultStore;
}

/**
 * Set the default Plaid item store.
 */
export function setPlaidItemStore(store: PlaidItemStore): void {
  defaultStore = store;
}

/**
 * Reset the default store (for testing).
 */
export function resetPlaidItemStore(): void {
  defaultStore = null;
}
