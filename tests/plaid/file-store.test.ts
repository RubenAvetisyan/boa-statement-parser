import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FilePlaidItemStore } from '../../src/plaid/file-store.js';
import type { PlaidItem } from '../../src/plaid/types.js';

describe('FilePlaidItemStore', () => {
  let testDir: string;
  let testFilePath: string;
  let store: FilePlaidItemStore;

  const createTestItem = (overrides: Partial<PlaidItem> = {}): PlaidItem => ({
    itemId: 'item_123',
    accessToken: 'access-sandbox-xxx',
    institutionId: 'ins_1',
    institutionName: 'Test Bank',
    userId: 'user_456',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  });

  beforeEach(() => {
    // Create a temporary directory for tests
    testDir = path.join(os.tmpdir(), `plaid-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    testFilePath = path.join(testDir, 'plaid-items.json');
    store = new FilePlaidItemStore(testFilePath);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('saveItem', () => {
    it('should save a new item', async () => {
      const item = createTestItem();
      await store.saveItem(item);

      const retrieved = await store.getItem(item.itemId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.itemId).toBe(item.itemId);
      expect(retrieved!.accessToken).toBe(item.accessToken);
    });

    it('should update an existing item', async () => {
      const item = createTestItem();
      await store.saveItem(item);

      const updatedItem = { ...item, status: 'login_required' as const };
      await store.saveItem(updatedItem);

      const retrieved = await store.getItem(item.itemId);
      expect(retrieved!.status).toBe('login_required');
    });

    it('should persist items to file', async () => {
      const item = createTestItem();
      await store.saveItem(item);

      // Create a new store instance to verify persistence
      const newStore = new FilePlaidItemStore(testFilePath);
      const retrieved = await newStore.getItem(item.itemId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.itemId).toBe(item.itemId);
    });
  });

  describe('getItem', () => {
    it('should return null for non-existent item', async () => {
      const result = await store.getItem('non_existent');
      expect(result).toBeNull();
    });

    it('should return the correct item', async () => {
      const item1 = createTestItem({ itemId: 'item_1' });
      const item2 = createTestItem({ itemId: 'item_2' });

      await store.saveItem(item1);
      await store.saveItem(item2);

      const retrieved = await store.getItem('item_2');
      expect(retrieved!.itemId).toBe('item_2');
    });
  });

  describe('getItemByUserId', () => {
    it('should return items for a specific user', async () => {
      const item1 = createTestItem({ itemId: 'item_1', userId: 'user_1' });
      const item2 = createTestItem({ itemId: 'item_2', userId: 'user_1' });
      const item3 = createTestItem({ itemId: 'item_3', userId: 'user_2' });

      await store.saveItem(item1);
      await store.saveItem(item2);
      await store.saveItem(item3);

      const userItems = await store.getItemsByUserId('user_1');
      expect(userItems.length).toBe(2);
      expect(userItems.map((i) => i.itemId)).toContain('item_1');
      expect(userItems.map((i) => i.itemId)).toContain('item_2');
    });

    it('should return empty array for user with no items', async () => {
      const items = await store.getItemsByUserId('non_existent_user');
      expect(items).toEqual([]);
    });
  });

  describe('getAllItems', () => {
    it('should return all items', async () => {
      const item1 = createTestItem({ itemId: 'item_1' });
      const item2 = createTestItem({ itemId: 'item_2' });

      await store.saveItem(item1);
      await store.saveItem(item2);

      const allItems = await store.getAllItems();
      expect(allItems.length).toBe(2);
    });

    it('should return empty array when no items exist', async () => {
      const items = await store.getAllItems();
      expect(items).toEqual([]);
    });
  });

  describe('deleteItem', () => {
    it('should delete an existing item', async () => {
      const item = createTestItem();
      await store.saveItem(item);

      await store.deleteItem(item.itemId);

      const retrieved = await store.getItem(item.itemId);
      expect(retrieved).toBeNull();
    });

    it('should not throw when deleting non-existent item', async () => {
      await expect(store.deleteItem('non_existent')).resolves.not.toThrow();
    });
  });

  describe('updateItem', () => {
    it('should update specific fields', async () => {
      const item = createTestItem();
      await store.saveItem(item);

      await store.updateItem(item.itemId, {
        syncCursor: 'cursor_123',
        lastSyncAt: '2024-01-15T00:00:00Z',
      });

      const retrieved = await store.getItem(item.itemId);
      expect(retrieved!.syncCursor).toBe('cursor_123');
      expect(retrieved!.lastSyncAt).toBe('2024-01-15T00:00:00Z');
      expect(retrieved!.accessToken).toBe(item.accessToken); // Unchanged
    });

    it('should update updatedAt timestamp', async () => {
      const item = createTestItem({ updatedAt: '2024-01-01T00:00:00Z' });
      await store.saveItem(item);

      await store.updateItem(item.itemId, { syncCursor: 'new_cursor' });

      const retrieved = await store.getItem(item.itemId);
      expect(retrieved!.updatedAt).not.toBe('2024-01-01T00:00:00Z');
    });
  });

  describe('updateStatus', () => {
    it('should update item status', async () => {
      const item = createTestItem({ status: 'active' });
      await store.saveItem(item);

      await store.updateStatus(item.itemId, 'login_required');

      const retrieved = await store.getItem(item.itemId);
      expect(retrieved!.status).toBe('login_required');
    });

    it('should handle all status values', async () => {
      const item = createTestItem();
      await store.saveItem(item);

      await store.updateStatus(item.itemId, 'active');
      expect((await store.getItem(item.itemId))!.status).toBe('active');

      await store.updateStatus(item.itemId, 'login_required');
      expect((await store.getItem(item.itemId))!.status).toBe('login_required');

      await store.updateStatus(item.itemId, 'error');
      expect((await store.getItem(item.itemId))!.status).toBe('error');
    });
  });

  describe('updateSyncCursor', () => {
    it('should update sync cursor and lastSyncAt', async () => {
      const item = createTestItem();
      await store.saveItem(item);

      await store.updateSyncCursor(item.itemId, 'new_cursor_123');

      const retrieved = await store.getItem(item.itemId);
      expect(retrieved!.syncCursor).toBe('new_cursor_123');
      expect(retrieved!.lastSyncAt).toBeDefined();
    });
  });

  describe('file handling', () => {
    it('should create directory if it does not exist', async () => {
      const nestedPath = path.join(testDir, 'nested', 'dir', 'items.json');
      const nestedStore = new FilePlaidItemStore(nestedPath);

      const item = createTestItem();
      await nestedStore.saveItem(item);

      expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it('should handle corrupted file gracefully', async () => {
      // Write invalid JSON to the file
      fs.writeFileSync(testFilePath, 'not valid json');

      // Should not throw, should return empty
      const items = await store.getAllItems();
      expect(items).toEqual([]);
    });
  });
});
