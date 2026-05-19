declare const browser: any;

export const isContextValid = () => {
  try {
    return !!browser.runtime?.id;
  } catch {
    return false;
  }
};

export async function safeBrowserCall<T>(fn: () => Promise<T>): Promise<T | null> {
  if (!isContextValid()) return null;
  try {
    return await fn();
  } catch (err: any) {
    const msg = err.message || '';
    if (msg.includes('Extension context invalidated')) {
      console.error('[SKaraoke:Content] Extension context invalidated! Page refresh required.');
      const toast = document.createElement('div');
      toast.style.cssText = 'position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%); background: #e91e63; color: white; padding: 12px 24px; border-radius: 500px; z-index: 1000000; font-family: sans-serif; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
      toast.textContent = 'Spotify Karaoke updated. Please refresh the page.';
      document.body.appendChild(toast);
    } else if (msg.includes('Message port closed before a response was received')) {
      console.warn('[SKaraoke:Content] Service Worker suspended or killed during request.');
    } else {
      console.error('[SKaraoke:Content] Browser call failed:', err);
    }
    return null;
  }
}

export async function getTargetLang(): Promise<string> {
  const data = await safeBrowserCall(() => browser.storage.sync.get('targetLang'));
  return ((data as any)?.targetLang as string) ?? 'en';
}

/**
 * Deep clones an object to strip Xray wrappers (Firefox) and ensure mutability.
 * Uses a robust JSON-based approach for maximum compatibility with cross-world objects.
 */
export function safeClone<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    console.warn('[sly-utils] safeClone failed, returning original:', e);
    return obj;
  }
}
