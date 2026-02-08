import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PlaidSyncService,
  createSyncService,
  type SyncServiceConfig,
  type SyncProgressEvent,
} from '../../src/plaid/sync-service.js';
import { InMemoryPlaidItemStore } from '../../src/plaid/store.js';
import type { PlaidItem, PlaidTransaction } from '../../src/plaid/types.js';

// Mock the external dependencies
vi.mock('../../src/plaid/transactions.js', () => ({
  syncAllTransactions: vi.fn(),
}));

vi.mock('../../src/supabase/import.js', () => ({
  upsertTransactions: vi.fn(),
}));

vi.mock('../../src/plaid/webhooks.js', () => ({
  handleWebhook: vi.fn(),
}));

// Import mocked modules
import { syncAllTransactions } from '../../src/plaid/transactions.js';
import { upsertTransactions } from '../../src/supabase/import.js';
import { handleWebhook } from '../../src/plaid/webhooks.js';

describe('PlaidSyncService', () => {
  let mockSupabaseClient: ReturnType<typeof createMockSupabaseClient>;
  let mockStore: InMemoryPlaidItemStore;

  const createMockSupabaseClient = () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'account-123' }, error: null }),
            }),
          }),
          single: vi.fn().mockResolvedValue({ data: { id: 'account-123' }, error: null }),
        }),
        single: vi.fn().mockResolvedValue({ data: { id: 'account-123' }, error: null }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ error: null, count: 0 }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'new-account-123' }, error: null }),
        }),
      }),
    });

    return {
      from: mockFrom,
    };
  };

  const createTestItem = (overrides: Partial<PlaidItem> = {}): PlaidItem => ({
    itemId: 'item-123',
    accessToken: 'access-token-123',
    institutionId: 'ins_123',
    institutionName: 'Test Bank',
    userId: 'user-123',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  });

  const createTestTransaction = (overrides: Partial<PlaidTransaction> = {}): PlaidTransaction => ({
    transactionId: 'tx-123',
    accountId: 'acc-123',
    date: '2024-01-15',
    amount: 50.00,
    name: 'Test Transaction',
    merchantName: 'Test Merchant',
    paymentChannel: 'online',
    pending: false,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseClient = createMockSupabaseClient();
    mockStore = new InMemoryPlaidItemStore();

    // Default mock implementations
    vi.mocked(syncAllTransactions).mockResolvedValue({
      added: [],
      modified: [],
      removed: [],
      finalCursor: 'cursor-123',
    });

    vi.mocked(upsertTransactions).mockResolvedValue({
      inserted: 0,
      skipped: 0,
      transactionDbIds: [],
    });
  });

  afterEach(() => {
    mockStore.clear();
  });

  describe('createSyncService', () => {
    it('should create a PlaidSyncService instance', () => {
      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      expect(service).toBeInstanceOf(PlaidSyncService);
    });

    it('should accept optional configuration', () => {
      const onProgress = vi.fn();
      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
        rateLimitTokens: 20,
        rateLimitRefillRate: 10,
        retryOptions: { maxRetries: 5 },
        onProgress,
      });

      expect(service).toBeInstanceOf(PlaidSyncService);
    });
  });

  describe('syncItem', () => {
    it('should throw error if item not found', async () => {
      // Mock Supabase to return null for non-existent item
      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      await expect(service.syncItem('non-existent-item')).rejects.toThrow(
        'Plaid item not found: non-existent-item'
      );
    });

    it('should sync transactions for a valid item', async () => {
      const item = createTestItem();
      await mockStore.saveItem(item);

      // Override the store in the service by creating a custom config
      // Since PlaidSyncService creates its own SupabasePlaidItemStore, we need to mock at a different level
      // For this test, we'll mock syncAllTransactions to return test data
      const testTransactions = [
        createTestTransaction({ transactionId: 'tx-1', amount: 100 }),
        createTestTransaction({ transactionId: 'tx-2', amount: 200 }),
      ];

      vi.mocked(syncAllTransactions).mockResolvedValue({
        added: testTransactions,
        modified: [],
        removed: [],
        finalCursor: 'new-cursor',
      });

      vi.mocked(upsertTransactions).mockResolvedValue({
        inserted: 2,
        skipped: 0,
        transactionDbIds: ['db-1', 'db-2'],
      });

      // Create a service that uses our mock store
      // We need to test with the actual SupabasePlaidItemStore behavior
      // For unit testing, we'll verify the mocks are called correctly
      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      // Since the service creates its own SupabasePlaidItemStore, we need to mock the Supabase response
      // to return our test item
      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    item_id: item.itemId,
                    access_token: item.accessToken,
                    institution_id: item.institutionId,
                    institution_name: item.institutionName,
                    user_id: item.userId,
                    status: item.status,
                    sync_cursor: item.syncCursor,
                    created_at: item.createdAt,
                    updated_at: item.updatedAt,
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({ data: { id: 'account-123' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'transactions') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ error: null, count: 0 }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const result = await service.syncItem(item.itemId);

      expect(result.itemId).toBe(item.itemId);
      expect(result.transactionsInserted).toBe(2);
      expect(result.finalCursor).toBe('new-cursor');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(syncAllTransactions).toHaveBeenCalledWith(item.accessToken, undefined);
    });

    it('should emit progress events', async () => {
      const progressEvents: SyncProgressEvent[] = [];
      const onProgress = (event: SyncProgressEvent): void => {
        progressEvents.push(event);
      };

      const item = createTestItem();

      vi.mocked(syncAllTransactions).mockResolvedValue({
        added: [createTestTransaction()],
        modified: [],
        removed: [],
        finalCursor: 'cursor',
      });

      vi.mocked(upsertTransactions).mockResolvedValue({
        inserted: 1,
        skipped: 0,
        transactionDbIds: ['db-1'],
      });

      // Mock Supabase to return the item
      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    item_id: item.itemId,
                    access_token: item.accessToken,
                    institution_id: item.institutionId,
                    institution_name: item.institutionName,
                    user_id: item.userId,
                    status: item.status,
                    created_at: item.createdAt,
                    updated_at: item.updatedAt,
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({ data: { id: 'account-123' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'transactions') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ error: null, count: 0 }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
        onProgress,
      });

      await service.syncItem(item.itemId);

      expect(progressEvents.length).toBeGreaterThanOrEqual(3);
      expect(progressEvents[0].phase).toBe('fetching');
      expect(progressEvents[1].phase).toBe('importing');
      expect(progressEvents[progressEvents.length - 1].phase).toBe('complete');
    });

    it('should emit error progress on sync failure', async () => {
      const progressEvents: SyncProgressEvent[] = [];
      const onProgress = (event: SyncProgressEvent): void => {
        progressEvents.push(event);
      };

      const item = createTestItem();
      const syncError = new Error('Plaid API error');

      vi.mocked(syncAllTransactions).mockRejectedValue(syncError);

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    item_id: item.itemId,
                    access_token: item.accessToken,
                    institution_id: item.institutionId,
                    institution_name: item.institutionName,
                    user_id: item.userId,
                    status: item.status,
                    created_at: item.createdAt,
                    updated_at: item.updatedAt,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
        onProgress,
      });

      await expect(service.syncItem(item.itemId)).rejects.toThrow('Plaid API error');

      const errorEvent = progressEvents.find((e) => e.phase === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error?.message).toBe('Plaid API error');
    });

    it('should handle removed transactions', async () => {
      const item = createTestItem();

      vi.mocked(syncAllTransactions).mockResolvedValue({
        added: [],
        modified: [],
        removed: [{ transactionId: 'removed-tx-1' }, { transactionId: 'removed-tx-2' }],
        finalCursor: 'cursor',
      });

      vi.mocked(upsertTransactions).mockResolvedValue({
        inserted: 0,
        skipped: 0,
        transactionDbIds: [],
      });

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ error: null, count: 2 }),
        }),
      });

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    item_id: item.itemId,
                    access_token: item.accessToken,
                    institution_id: item.institutionId,
                    institution_name: item.institutionName,
                    user_id: item.userId,
                    status: item.status,
                    created_at: item.createdAt,
                    updated_at: item.updatedAt,
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({ data: { id: 'account-123' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'transactions') {
          return {
            update: mockUpdate,
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      const result = await service.syncItem(item.itemId);

      expect(result.transactionsRemoved).toBe(2);
    });
  });

  describe('syncAllItems', () => {
    it('should return empty array when no items exist', async () => {
      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      const results = await service.syncAllItems();

      expect(results).toEqual([]);
    });

    it('should skip items with login_required status', async () => {
      const items = [
        createTestItem({ itemId: 'item-1', status: 'active' }),
        createTestItem({ itemId: 'item-2', status: 'login_required' }),
        createTestItem({ itemId: 'item-3', status: 'error' }),
      ];

      vi.mocked(syncAllTransactions).mockResolvedValue({
        added: [],
        modified: [],
        removed: [],
        finalCursor: 'cursor',
      });

      vi.mocked(upsertTransactions).mockResolvedValue({
        inserted: 0,
        skipped: 0,
        transactionDbIds: [],
      });

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((field: string, value: string) => {
                if (field === 'user_id') {
                  return {
                    order: vi.fn().mockResolvedValue({
                      data: items.map((item) => ({
                        item_id: item.itemId,
                        access_token: item.accessToken,
                        institution_id: item.institutionId,
                        institution_name: item.institutionName,
                        user_id: item.userId,
                        status: item.status,
                        created_at: item.createdAt,
                        updated_at: item.updatedAt,
                      })),
                      error: null,
                    }),
                  };
                }
                // For getItem calls
                return {
                  single: vi.fn().mockImplementation(() => {
                    const item = items.find((i) => i.itemId === value);
                    if (item) {
                      return Promise.resolve({
                        data: {
                          item_id: item.itemId,
                          access_token: item.accessToken,
                          institution_id: item.institutionId,
                          institution_name: item.institutionName,
                          user_id: item.userId,
                          status: item.status,
                          created_at: item.createdAt,
                          updated_at: item.updatedAt,
                        },
                        error: null,
                      });
                    }
                    return Promise.resolve({ data: null, error: { message: 'Not found' } });
                  }),
                };
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({ data: { id: 'account-123' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'transactions') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ error: null, count: 0 }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      const results = await service.syncAllItems();

      // Only item-1 should be synced (active status)
      expect(results.length).toBe(1);
      expect(results[0].itemId).toBe('item-1');
    });

    it('should continue syncing other items when one fails', async () => {
      const items = [
        createTestItem({ itemId: 'item-1', status: 'active' }),
        createTestItem({ itemId: 'item-2', status: 'active' }),
      ];

      let callCount = 0;
      vi.mocked(syncAllTransactions).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('First item failed'));
        }
        return Promise.resolve({
          added: [],
          modified: [],
          removed: [],
          finalCursor: 'cursor',
        });
      });

      vi.mocked(upsertTransactions).mockResolvedValue({
        inserted: 0,
        skipped: 0,
        transactionDbIds: [],
      });

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((field: string, value: string) => {
                if (field === 'user_id') {
                  return {
                    order: vi.fn().mockResolvedValue({
                      data: items.map((item) => ({
                        item_id: item.itemId,
                        access_token: item.accessToken,
                        institution_id: item.institutionId,
                        institution_name: item.institutionName,
                        user_id: item.userId,
                        status: item.status,
                        created_at: item.createdAt,
                        updated_at: item.updatedAt,
                      })),
                      error: null,
                    }),
                  };
                }
                const item = items.find((i) => i.itemId === value);
                return {
                  single: vi.fn().mockResolvedValue({
                    data: item
                      ? {
                          item_id: item.itemId,
                          access_token: item.accessToken,
                          institution_id: item.institutionId,
                          institution_name: item.institutionName,
                          user_id: item.userId,
                          status: item.status,
                          created_at: item.createdAt,
                          updated_at: item.updatedAt,
                        }
                      : null,
                    error: item ? null : { message: 'Not found' },
                  }),
                };
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({ data: { id: 'account-123' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'transactions') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ error: null, count: 0 }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      const results = await service.syncAllItems();

      // Second item should still succeed
      expect(results.length).toBe(1);
      expect(results[0].itemId).toBe('item-2');

      consoleSpy.mockRestore();
    });
  });

  describe('getSyncStatus', () => {
    it('should throw error if item not found', async () => {
      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      await expect(service.getSyncStatus('non-existent')).rejects.toThrow(
        'Plaid item not found: non-existent'
      );
    });

    it('should return sync status for existing item', async () => {
      const item = createTestItem({
        syncCursor: 'cursor-abc',
        lastSyncAt: '2024-01-15T10:00:00Z',
      });

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    item_id: item.itemId,
                    access_token: item.accessToken,
                    institution_id: item.institutionId,
                    institution_name: item.institutionName,
                    user_id: item.userId,
                    status: item.status,
                    sync_cursor: item.syncCursor,
                    last_sync_at: item.lastSyncAt,
                    created_at: item.createdAt,
                    updated_at: item.updatedAt,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      const status = await service.getSyncStatus(item.itemId);

      expect(status.itemId).toBe(item.itemId);
      expect(status.syncCursor).toBe('cursor-abc');
      expect(status.lastSyncAt).toBe('2024-01-15T10:00:00Z');
      expect(status.status).toBe('active');
    });

    it('should return null for missing cursor and lastSyncAt', async () => {
      const item = createTestItem();

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    item_id: item.itemId,
                    access_token: item.accessToken,
                    institution_id: item.institutionId,
                    institution_name: item.institutionName,
                    user_id: item.userId,
                    status: item.status,
                    created_at: item.createdAt,
                    updated_at: item.updatedAt,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      const status = await service.getSyncStatus(item.itemId);

      expect(status.syncCursor).toBeNull();
      expect(status.lastSyncAt).toBeNull();
    });
  });

  describe('handleWebhook', () => {
    it('should delegate to webhook handler', async () => {
      vi.mocked(handleWebhook).mockResolvedValue({
        handled: true,
        action: 'sync',
        message: 'Sync triggered',
        itemId: 'item-123',
      });

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      const payload = {
        webhook_type: 'TRANSACTIONS' as const,
        webhook_code: 'SYNC_UPDATES_AVAILABLE' as const,
        item_id: 'item-123',
        new_transactions: 5,
      };

      const result = await service.handleWebhook(payload);

      expect(result.handled).toBe(true);
      expect(handleWebhook).toHaveBeenCalledWith(
        payload,
        expect.objectContaining({
          onSyncAvailable: expect.any(Function),
          onTransactionsRemoved: expect.any(Function),
        }),
        expect.anything()
      );
    });
  });

  describe('mapPlaidToSupabase (via syncItem)', () => {
    it('should correctly map Plaid transaction to Supabase format', async () => {
      const item = createTestItem();
      const plaidTx: PlaidTransaction = {
        transactionId: 'plaid-tx-123',
        accountId: 'acc-123',
        date: '2024-01-15',
        authorizedDate: '2024-01-14',
        amount: 50.00, // Positive = debit
        name: 'Coffee Shop Purchase',
        merchantName: 'Starbucks',
        merchantEntityId: 'merchant-entity-123',
        paymentChannel: 'in store',
        pending: false,
        personalFinanceCategory: {
          primary: 'FOOD_AND_DRINK',
          detailed: 'FOOD_AND_DRINK_COFFEE',
          confidenceLevel: 'HIGH',
        },
        location: {
          city: 'Seattle',
          region: 'WA',
          country: 'US',
        },
      };

      vi.mocked(syncAllTransactions).mockResolvedValue({
        added: [plaidTx],
        modified: [],
        removed: [],
        finalCursor: 'cursor',
      });

      let capturedTransactions: any[] = [];
      vi.mocked(upsertTransactions).mockImplementation(async (_client, _userId, input) => {
        capturedTransactions = input.transactions;
        return { inserted: 1, skipped: 0, transactionDbIds: ['db-1'] };
      });

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    item_id: item.itemId,
                    access_token: item.accessToken,
                    institution_id: item.institutionId,
                    institution_name: item.institutionName,
                    user_id: item.userId,
                    status: item.status,
                    created_at: item.createdAt,
                    updated_at: item.updatedAt,
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({ data: { id: 'account-123' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'transactions') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ error: null, count: 0 }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      await service.syncItem(item.itemId);

      expect(capturedTransactions.length).toBe(1);
      const mapped = capturedTransactions[0];

      expect(mapped.transactionId).toBe('plaid-plaid-tx-123');
      expect(mapped.date).toBe('2024-01-15');
      expect(mapped.postedDate).toBe('2024-01-14');
      expect(mapped.amount).toBe(50.00);
      expect(mapped.direction).toBe('debit');
      expect(mapped.description).toBe('Coffee Shop Purchase');
      expect(mapped.merchant.name).toBe('Starbucks');
      expect(mapped.merchant.entityId).toBe('merchant-entity-123');
      expect(mapped.channel.type).toBe('in store');
      expect(mapped.confidence).toBe(0.85); // HIGH confidence
      expect(mapped.category).toBe('FOOD_AND_DRINK');
      expect(mapped.subcategory).toBe('FOOD_AND_DRINK_COFFEE');
    });

    it('should map negative amounts as credits', async () => {
      const item = createTestItem();
      const plaidTx: PlaidTransaction = {
        transactionId: 'plaid-tx-refund',
        accountId: 'acc-123',
        date: '2024-01-15',
        amount: -25.00, // Negative = credit (refund)
        name: 'Refund',
        paymentChannel: 'online',
        pending: false,
      };

      vi.mocked(syncAllTransactions).mockResolvedValue({
        added: [plaidTx],
        modified: [],
        removed: [],
        finalCursor: 'cursor',
      });

      let capturedTransactions: any[] = [];
      vi.mocked(upsertTransactions).mockImplementation(async (_client, _userId, input) => {
        capturedTransactions = input.transactions;
        return { inserted: 1, skipped: 0, transactionDbIds: ['db-1'] };
      });

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    item_id: item.itemId,
                    access_token: item.accessToken,
                    institution_id: item.institutionId,
                    institution_name: item.institutionName,
                    user_id: item.userId,
                    status: item.status,
                    created_at: item.createdAt,
                    updated_at: item.updatedAt,
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({ data: { id: 'account-123' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'transactions') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ error: null, count: 0 }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      await service.syncItem(item.itemId);

      expect(capturedTransactions.length).toBe(1);
      expect(capturedTransactions[0].amount).toBe(25.00); // Absolute value
      expect(capturedTransactions[0].direction).toBe('credit');
    });

    it('should map confidence levels correctly', async () => {
      const item = createTestItem();
      const transactions: PlaidTransaction[] = [
        {
          transactionId: 'tx-very-high',
          accountId: 'acc-123',
          date: '2024-01-15',
          amount: 10,
          name: 'Test',
          paymentChannel: 'online',
          pending: false,
          personalFinanceCategory: { primary: 'TEST', detailed: 'TEST', confidenceLevel: 'VERY_HIGH' },
        },
        {
          transactionId: 'tx-high',
          accountId: 'acc-123',
          date: '2024-01-15',
          amount: 10,
          name: 'Test',
          paymentChannel: 'online',
          pending: false,
          personalFinanceCategory: { primary: 'TEST', detailed: 'TEST', confidenceLevel: 'HIGH' },
        },
        {
          transactionId: 'tx-medium',
          accountId: 'acc-123',
          date: '2024-01-15',
          amount: 10,
          name: 'Test',
          paymentChannel: 'online',
          pending: false,
          personalFinanceCategory: { primary: 'TEST', detailed: 'TEST', confidenceLevel: 'MEDIUM' },
        },
        {
          transactionId: 'tx-low',
          accountId: 'acc-123',
          date: '2024-01-15',
          amount: 10,
          name: 'Test',
          paymentChannel: 'online',
          pending: false,
          personalFinanceCategory: { primary: 'TEST', detailed: 'TEST', confidenceLevel: 'LOW' },
        },
      ];

      vi.mocked(syncAllTransactions).mockResolvedValue({
        added: transactions,
        modified: [],
        removed: [],
        finalCursor: 'cursor',
      });

      let capturedTransactions: any[] = [];
      vi.mocked(upsertTransactions).mockImplementation(async (_client, _userId, input) => {
        capturedTransactions = input.transactions;
        return { inserted: 4, skipped: 0, transactionDbIds: ['db-1', 'db-2', 'db-3', 'db-4'] };
      });

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    item_id: item.itemId,
                    access_token: item.accessToken,
                    institution_id: item.institutionId,
                    institution_name: item.institutionName,
                    user_id: item.userId,
                    status: item.status,
                    created_at: item.createdAt,
                    updated_at: item.updatedAt,
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({ data: { id: 'account-123' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'transactions') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ error: null, count: 0 }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      await service.syncItem(item.itemId);

      expect(capturedTransactions.length).toBe(4);
      expect(capturedTransactions.find((t: any) => t.transactionId === 'plaid-tx-very-high')?.confidence).toBe(0.95);
      expect(capturedTransactions.find((t: any) => t.transactionId === 'plaid-tx-high')?.confidence).toBe(0.85);
      expect(capturedTransactions.find((t: any) => t.transactionId === 'plaid-tx-medium')?.confidence).toBe(0.7);
      expect(capturedTransactions.find((t: any) => t.transactionId === 'plaid-tx-low')?.confidence).toBe(0.5);
    });
  });

  describe('Scheduled Sync', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should start and stop scheduled sync', () => {
      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      expect(service.isScheduledSyncRunning()).toBe(false);

      service.startScheduledSync({
        intervalMs: 60000,
      });

      expect(service.isScheduledSyncRunning()).toBe(true);

      service.stopScheduledSync();

      expect(service.isScheduledSyncRunning()).toBe(false);
    });

    it('should throw error if scheduled sync already running', () => {
      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      service.startScheduledSync({ intervalMs: 60000 });

      expect(() => {
        service.startScheduledSync({ intervalMs: 30000 });
      }).toThrow('Scheduled sync is already running');

      service.stopScheduledSync();
    });

    it('should return correct scheduled sync status when not running', () => {
      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      const status = service.getScheduledSyncStatus();

      expect(status.isRunning).toBe(false);
      expect(status.intervalMs).toBe(0);
      expect(status.lastRunAt).toBeNull();
      expect(status.nextRunAt).toBeNull();
      expect(status.totalRuns).toBe(0);
      expect(status.consecutiveErrors).toBe(0);
    });

    it('should return correct scheduled sync status when running', () => {
      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      service.startScheduledSync({ intervalMs: 60000 });

      const status = service.getScheduledSyncStatus();

      expect(status.isRunning).toBe(true);
      expect(status.intervalMs).toBe(60000);
      expect(status.nextRunAt).not.toBeNull();

      service.stopScheduledSync();
    });

    it('should call onSyncComplete callback after successful sync', async () => {
      // Mock empty items list for simple test
      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const onSyncComplete = vi.fn();

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      service.startScheduledSync({
        intervalMs: 1000,
        runImmediately: true,
        onSyncComplete,
      });

      // Wait for the immediate run to complete
      await vi.advanceTimersByTimeAsync(100);

      expect(onSyncComplete).toHaveBeenCalledWith([]);

      service.stopScheduledSync();
    });

    it('should call onSyncError callback on sync failure', async () => {
      // Mock to throw error
      mockSupabaseClient.from = vi.fn().mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const onSyncError = vi.fn();

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      service.startScheduledSync({
        intervalMs: 1000,
        runImmediately: true,
        onSyncError,
      });

      // Wait for the immediate run to complete
      await vi.advanceTimersByTimeAsync(100);

      expect(onSyncError).toHaveBeenCalled();
      expect(onSyncError.mock.calls[0][0]).toBeInstanceOf(Error);

      const status = service.getScheduledSyncStatus();
      expect(status.consecutiveErrors).toBe(1);

      service.stopScheduledSync();
    });

    it('should run sync at configured interval', async () => {
      // Mock empty items list
      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const onSyncComplete = vi.fn();

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      service.startScheduledSync({
        intervalMs: 5000,
        onSyncComplete,
      });

      // Initially no calls
      expect(onSyncComplete).not.toHaveBeenCalled();

      // Advance past first interval
      await vi.advanceTimersByTimeAsync(5100);
      expect(onSyncComplete).toHaveBeenCalledTimes(1);

      // Advance past second interval
      await vi.advanceTimersByTimeAsync(5000);
      expect(onSyncComplete).toHaveBeenCalledTimes(2);

      service.stopScheduledSync();
    });

    it('should track total runs correctly', async () => {
      // Mock empty items list
      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'plaid_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        return createMockSupabaseClient().from(table);
      });

      const service = createSyncService({
        supabaseClient: mockSupabaseClient as any,
        userId: 'user-123',
      });

      service.startScheduledSync({
        intervalMs: 1000,
        runImmediately: true,
      });

      // Wait for immediate run
      await vi.advanceTimersByTimeAsync(100);

      let status = service.getScheduledSyncStatus();
      expect(status.totalRuns).toBe(1);
      expect(status.lastRunAt).not.toBeNull();

      // Wait for another run
      await vi.advanceTimersByTimeAsync(1000);

      status = service.getScheduledSyncStatus();
      expect(status.totalRuns).toBe(2);

      service.stopScheduledSync();
    });
  });
});
