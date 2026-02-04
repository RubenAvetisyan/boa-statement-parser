/**
 * File-based Plaid item store for CLI persistence.
 * Stores items in a JSON file in the user's home directory or project root.
 */

/* eslint-disable @typescript-eslint/require-await */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { PlaidItem, PlaidItemStatus } from './types.js';
import type { PlaidItemStore } from './store.js';

const DEFAULT_STORE_PATH = join(homedir(), '.boa-parser', 'plaid-items.json');

export class FilePlaidItemStore implements PlaidItemStore {
  private items: Map<string, PlaidItem> = new Map();
  private filePath: string;

  constructor(filePath: string = DEFAULT_STORE_PATH) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const data = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(data) as Record<string, PlaidItem>;
        this.items = new Map(Object.entries(parsed));
      }
    } catch {
      // If file doesn't exist or is invalid, start fresh
      this.items = new Map();
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this.items);
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[WARN] Failed to save Plaid items: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

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

  async getAllItems(): Promise<PlaidItem[]> {
    return Array.from(this.items.values());
  }

  async saveItem(item: PlaidItem): Promise<void> {
    this.items.set(item.itemId, item);
    this.save();
  }

  async updateItem(itemId: string, updates: Partial<PlaidItem>): Promise<void> {
    const existing = this.items.get(itemId);
    if (existing !== undefined) {
      this.items.set(itemId, {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
      });
      this.save();
    }
  }

  async deleteItem(itemId: string): Promise<void> {
    this.items.delete(itemId);
    this.save();
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

  getFilePath(): string {
    return this.filePath;
  }
}

let defaultFileStore: FilePlaidItemStore | null = null;

export function getFilePlaidItemStore(filePath?: string): FilePlaidItemStore {
  if (defaultFileStore === null || (filePath !== undefined && filePath !== defaultFileStore.getFilePath())) {
    defaultFileStore = new FilePlaidItemStore(filePath);
  }
  return defaultFileStore;
}

export function resetFilePlaidItemStore(): void {
  defaultFileStore = null;
}
