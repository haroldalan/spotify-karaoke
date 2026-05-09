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
    if (msg.includes('Extension context invalidated') || msg.includes('Message port closed before a response was received')) {
      console.warn('[SKaraoke:Content] Browser call failed (recoverable):', msg);
    } else {
      console.error('[SKaraoke:Content] Browser call failed:', err);
    }
    return null;
  }
}

export async function getTargetLang(): Promise<string> {
  const data = await safeBrowserCall(() => browser.storage.sync.get('targetLang'));
  return (data?.targetLang as string) ?? 'en';
}
