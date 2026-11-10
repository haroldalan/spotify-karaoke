// storage.local cache with an index for least-recently-used eviction, plus a small
// in-memory layer (the service worker can be stopped at any time, so memory is a bonus).

const INDEX = 'cache-index';
const MAX_ENTRIES = 2000;
const memory = new Map<string, unknown>();

interface Entry<T> { v: T; t: number; ttl?: number }

let index: Record<string, number> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function loadIndex(): Promise<Record<string, number>> {
  if (!index) index = ((await chrome.storage.local.get(INDEX))[INDEX] as Record<string, number>) ?? {};
  return index;
}

function scheduleIndexSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const idx = await loadIndex();
    const keys = Object.keys(idx);
    if (keys.length > MAX_ENTRIES) {
      const old = keys.sort((a, b) => idx[a] - idx[b]).slice(0, keys.length - MAX_ENTRIES);
      for (const k of old) { delete idx[k]; memory.delete(k); }
      await chrome.storage.local.remove(old);
    }
    await chrome.storage.local.set({ [INDEX]: idx });
  }, 2000);
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const now = Date.now();
  let e = memory.get(key) as Entry<T> | undefined;
  if (!e) {
    e = (await chrome.storage.local.get(key))[key] as Entry<T> | undefined;
    if (e) memory.set(key, e);
  }
  if (!e) return undefined;
  if (e.ttl && now - e.t > e.ttl) {
    // Expired: gone from the device too, not only ignored (the policy says entries expire).
    void cacheDelete(key).catch(() => {});
    return undefined;
  }
  (await loadIndex())[key] = now;
  scheduleIndexSave();
  return e.v;
}

export async function cacheSet<T>(key: string, v: T, ttlMs?: number): Promise<void> {
  const e: Entry<T> = { v, t: Date.now(), ...(ttlMs ? { ttl: ttlMs } : {}) };
  memory.set(key, e);
  if (memory.size > 300) memory.delete(memory.keys().next().value!);
  await chrome.storage.local.set({ [key]: e });
  (await loadIndex())[key] = e.t;
  scheduleIndexSave();
}

/** Removes one entry. */
export async function cacheDelete(key: string): Promise<void> {
  memory.delete(key);
  delete (await loadIndex())[key];
  await chrome.storage.local.remove(key);
  scheduleIndexSave();
}

/** Removes everything the extension stored on this device (settings live in storage.sync). */
export async function cacheClear(): Promise<void> {
  memory.clear();
  index = {};
  await chrome.storage.local.clear();
}

/** Bytes stored on this device. */
export async function cacheBytes(): Promise<number> {
  const local = chrome.storage.local as chrome.storage.LocalStorageArea & { getBytesInUse?: (keys: null) => Promise<number> };
  if (local.getBytesInUse) return local.getBytesInUse(null);
  return new Blob([JSON.stringify(await chrome.storage.local.get(null))]).size;
}

/** Runs fn once per key at a time; concurrent callers share the result. */
const running = new Map<string, Promise<unknown>>();
export function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const r = running.get(key) as Promise<T> | undefined;
  if (r) return r;
  const p = fn().finally(() => running.delete(key));
  running.set(key, p);
  return p;
}
