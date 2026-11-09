// A minimal in-memory chrome.storage for background-code tests.
export function installChromeStorage() {
  const local = new Map<string, unknown>();
  const sync = new Map<string, unknown>();
  const area = (m: Map<string, unknown>) => ({
    get: async (keys?: string | string[] | null) => {
      if (keys == null) return Object.fromEntries(m);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => m.has(k)).map((k) => [k, structuredClone(m.get(k))]));
    },
    set: async (items: Record<string, unknown>) => { for (const [k, v] of Object.entries(items)) m.set(k, structuredClone(v)); },
    remove: async (keys: string | string[]) => { for (const k of Array.isArray(keys) ? keys : [keys]) m.delete(k); },
    clear: async () => m.clear(),
  });
  (globalThis as any).chrome = {
    storage: { local: area(local), sync: area(sync), onChanged: { addListener() {} } },
    runtime: { getManifest: () => ({ version: 'test' }) },
  };
  return { local, sync };
}
