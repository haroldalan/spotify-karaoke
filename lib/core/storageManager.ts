/**
 * storageManager.ts
 * 
 * Centralized serialization queue for all browser.storage.local write operations.
 * This ensures that concurrent writes, index updates, and evictions do not 
 * race or corrupt each other.
 */

import { safeBrowserCall } from '../utils/browserUtils';

let storageQueue: Promise<void> = Promise.resolve();

/**
 * Executes a storage operation within the centralized queue.
 * @param operation - An async function that performs storage mutations.
 */
export async function enqueueStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = storageQueue;
  const result = (async () => {
    try {
      await previous;
    } catch (e) {
      // Swallow previous errors to ensure the queue doesn't stall
    }
    return operation();
  })();

  storageQueue = (async () => {
    try {
      await result;
    } catch (e) {
      // Swallow current error to allow next task to run
    }
  })();

  return result;
}

/**
 * Helper for performing a safe set operation within the queue.
 */
export async function safeStorageSet(items: Record<string, any>): Promise<void> {
  return enqueueStorageOperation(() => safeBrowserCall(() => browser.storage.local.set(items)));
}

/**
 * Helper for performing a safe remove operation within the queue.
 */
export async function safeStorageRemove(keys: string | string[]): Promise<void> {
  return enqueueStorageOperation(() => safeBrowserCall(() => browser.storage.local.remove(keys)));
}
