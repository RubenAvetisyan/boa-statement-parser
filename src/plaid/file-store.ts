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

// ─── Gap Cache ───────────────────────────────────────────────────────────────

interface GapCacheEntry {
  start: string;
  end: string;
  checkedAt: string;
}

interface GapCacheData {
  [accountKey: string]: GapCacheEntry[];
}

interface EarliestDateCache {
  [plaidAccountId: string]: { date: string; checkedAt: string };
}

/**
 * Persistent cache of date ranges that were checked via Plaid and returned 0 results.
 * Prevents re-fetching empty gaps on subsequent runs.
 */
export class PlaidGapCache {
  private data: GapCacheData = {};
  private earliestDates: EarliestDateCache = {};
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(homedir(), '.boa-parser', 'plaid-gap-cache.json');
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Record<string, unknown>;
        // Support both old format (just GapCacheData) and new format with _earliestDates
        if (raw['_earliestDates'] !== undefined) {
          this.earliestDates = raw['_earliestDates'] as EarliestDateCache;
          delete raw['_earliestDates'];
        }
        this.data = raw as GapCacheData;
      }
    } catch {
      this.data = {};
      this.earliestDates = {};
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const toWrite = { ...this.data, _earliestDates: this.earliestDates };
      writeFileSync(this.filePath, JSON.stringify(toWrite, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }

  getCheckedRanges(accountKey: string): Array<{ start: string; end: string }> {
    return (this.data[accountKey] ?? []).map((e) => ({ start: e.start, end: e.end }));
  }

  markChecked(accountKey: string, start: string, end: string): void {
    if (this.data[accountKey] === undefined) {
      this.data[accountKey] = [];
    }
    // Avoid duplicates
    const exists = this.data[accountKey]!.some((e) => e.start === start && e.end === end);
    if (!exists) {
      this.data[accountKey]!.push({ start, end, checkedAt: new Date().toISOString() });
      this.save();
    }
  }

  getEarliestDate(plaidAccountId: string): string | null {
    return this.earliestDates[plaidAccountId]?.date ?? null;
  }

  setEarliestDate(plaidAccountId: string, date: string): void {
    this.earliestDates[plaidAccountId] = { date, checkedAt: new Date().toISOString() };
    this.save();
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
