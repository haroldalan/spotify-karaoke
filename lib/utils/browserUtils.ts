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
    if (err.message?.includes('Extension context invalidated')) {
      console.warn('[SKaraoke:Content] Context invalidated.');
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
