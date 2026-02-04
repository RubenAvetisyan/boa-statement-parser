/**
 * Plaid webhook handling for real-time updates.
 * Handles TRANSACTIONS, ITEM, and other webhook events.
 */

import type { PlaidItemStore } from './store.js';
import { getFilePlaidItemStore } from './file-store.js';

export type WebhookType =
  | 'TRANSACTIONS'
  | 'ITEM'
  | 'AUTH'
  | 'ASSETS'
  | 'HOLDINGS'
  | 'INVESTMENTS_TRANSACTIONS'
  | 'LIABILITIES'
  | 'INCOME'
  | 'IDENTITY'
  | 'LINK';

export type TransactionWebhookCode =
  | 'INITIAL_UPDATE'
  | 'HISTORICAL_UPDATE'
  | 'DEFAULT_UPDATE'
  | 'TRANSACTIONS_REMOVED'
  | 'SYNC_UPDATES_AVAILABLE';

export type ItemWebhookCode =
  | 'ERROR'
  | 'LOGIN_REPAIRED'
  | 'PENDING_EXPIRATION'
  | 'USER_PERMISSION_REVOKED'
  | 'WEBHOOK_UPDATE_ACKNOWLEDGED';

export interface PlaidWebhookPayload {
  webhook_type: WebhookType;
  webhook_code: string;
  item_id: string;
  error?: {
    error_type: string;
    error_code: string;
    error_message: string;
    display_message?: string;
  };
  new_transactions?: number;
  removed_transactions?: string[];
  consent_expiration_time?: string;
}

export interface WebhookHandlerResult {
  handled: boolean;
  action?: 'sync' | 'reauth' | 'remove' | 'none';
  message: string;
  itemId: string;
}

export interface WebhookHandlers {
  onSyncAvailable?: (itemId: string, newCount: number) => Promise<void>;
  onLoginRequired?: (itemId: string) => Promise<void>;
  onError?: (itemId: string, error: PlaidWebhookPayload['error']) => Promise<void>;
  onTransactionsRemoved?: (itemId: string, transactionIds: string[]) => Promise<void>;
  onPermissionRevoked?: (itemId: string) => Promise<void>;
}

/**
 * Handle a Plaid webhook payload.
 * Updates item status and triggers appropriate actions.
 */
export async function handleWebhook(
  payload: PlaidWebhookPayload,
  handlers: WebhookHandlers = {},
  store?: PlaidItemStore
): Promise<WebhookHandlerResult> {
  const itemStore = store ?? getFilePlaidItemStore();
  const { webhook_type, webhook_code, item_id } = payload;

  // Transaction webhooks
  if (webhook_type === 'TRANSACTIONS') {
    return handleTransactionWebhook(payload, handlers, itemStore);
  }

  // Item webhooks
  if (webhook_type === 'ITEM') {
    return handleItemWebhook(payload, handlers, itemStore);
  }

  // Unhandled webhook type
  return {
    handled: false,
    action: 'none',
    message: `Unhandled webhook type: ${webhook_type}/${webhook_code}`,
    itemId: item_id,
  };
}

/**
 * Handle transaction-related webhooks.
 */
async function handleTransactionWebhook(
  payload: PlaidWebhookPayload,
  handlers: WebhookHandlers,
  store: PlaidItemStore
): Promise<WebhookHandlerResult> {
  const { webhook_code, item_id, new_transactions, removed_transactions } = payload;

  switch (webhook_code as TransactionWebhookCode) {
    case 'SYNC_UPDATES_AVAILABLE':
    case 'INITIAL_UPDATE':
    case 'HISTORICAL_UPDATE':
    case 'DEFAULT_UPDATE': {
      // Update item's last activity timestamp
      await store.updateItem(item_id, {
        updatedAt: new Date().toISOString(),
      });

      if (handlers.onSyncAvailable !== undefined) {
        await handlers.onSyncAvailable(item_id, new_transactions ?? 0);
      }

      return {
        handled: true,
        action: 'sync',
        message: `Sync available: ${new_transactions ?? 0} new transactions`,
        itemId: item_id,
      };
    }

    case 'TRANSACTIONS_REMOVED': {
      if (handlers.onTransactionsRemoved !== undefined && removed_transactions !== undefined) {
        await handlers.onTransactionsRemoved(item_id, removed_transactions);
      }

      return {
        handled: true,
        action: 'sync',
        message: `${removed_transactions?.length ?? 0} transactions removed`,
        itemId: item_id,
      };
    }

    default:
      return {
        handled: false,
        action: 'none',
        message: `Unhandled transaction webhook: ${webhook_code}`,
        itemId: item_id,
      };
  }
}

/**
 * Handle item-related webhooks.
 */
async function handleItemWebhook(
  payload: PlaidWebhookPayload,
  handlers: WebhookHandlers,
  store: PlaidItemStore
): Promise<WebhookHandlerResult> {
  const { webhook_code, item_id, error } = payload;

  switch (webhook_code as ItemWebhookCode) {
    case 'ERROR': {
      // Update item status to error
      await store.updateStatus(item_id, 'error');

      if (handlers.onError !== undefined && error !== undefined) {
        await handlers.onError(item_id, error);
      }

      // Check if this is a login required error
      if (error?.error_code === 'ITEM_LOGIN_REQUIRED') {
        await store.updateStatus(item_id, 'login_required');

        if (handlers.onLoginRequired !== undefined) {
          await handlers.onLoginRequired(item_id);
        }

        return {
          handled: true,
          action: 'reauth',
          message: `Login required: ${error.error_message}`,
          itemId: item_id,
        };
      }

      return {
        handled: true,
        action: 'none',
        message: `Item error: ${error?.error_message ?? 'Unknown error'}`,
        itemId: item_id,
      };
    }

    case 'LOGIN_REPAIRED': {
      // Update item status back to active
      await store.updateStatus(item_id, 'active');

      return {
        handled: true,
        action: 'sync',
        message: 'Login repaired, item is active again',
        itemId: item_id,
      };
    }

    case 'PENDING_EXPIRATION': {
      // Consent is about to expire, user needs to re-authenticate
      if (handlers.onLoginRequired !== undefined) {
        await handlers.onLoginRequired(item_id);
      }

      return {
        handled: true,
        action: 'reauth',
        message: `Consent expiring: ${payload.consent_expiration_time ?? 'soon'}`,
        itemId: item_id,
      };
    }

    case 'USER_PERMISSION_REVOKED': {
      // User revoked access, mark item for removal
      await store.updateStatus(item_id, 'error');

      if (handlers.onPermissionRevoked !== undefined) {
        await handlers.onPermissionRevoked(item_id);
      }

      return {
        handled: true,
        action: 'remove',
        message: 'User permission revoked',
        itemId: item_id,
      };
    }

    case 'WEBHOOK_UPDATE_ACKNOWLEDGED': {
      return {
        handled: true,
        action: 'none',
        message: 'Webhook URL update acknowledged',
        itemId: item_id,
      };
    }

    default:
      return {
        handled: false,
        action: 'none',
        message: `Unhandled item webhook: ${webhook_code}`,
        itemId: item_id,
      };
  }
}

/**
 * Verify a Plaid webhook signature.
 * @see https://plaid.com/docs/api/webhooks/webhook-verification/
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  _webhookSecret: string
): boolean {
  // Note: Full implementation requires JWT verification
  // This is a placeholder that should be implemented with proper crypto
  // For production, use Plaid's webhook verification endpoint or JWT library
  
  if (signature === '' || body === '') {
    return false;
  }

  // TODO: Implement proper JWT verification
  // The signature is a JWT that should be verified using the webhook secret
  // For now, we trust the signature if it's present
  return true;
}

/**
 * Create an Express-compatible webhook handler middleware.
 * Usage: app.post('/webhook', createWebhookMiddleware(handlers))
 */
export function createWebhookHandler(
  handlers: WebhookHandlers = {},
  store?: PlaidItemStore
): (payload: PlaidWebhookPayload) => Promise<WebhookHandlerResult> {
  return async (payload: PlaidWebhookPayload) => {
    return handleWebhook(payload, handlers, store);
  };
}
