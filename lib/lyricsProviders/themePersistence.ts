import { safeBrowserCall } from '../utils/browserUtils';

const THEME_INDEX_KEY = 'sly_theme_index';
const MAX_THEMES = 100;

export class ThemePersistence {
  private storageQueue: Promise<void> = Promise.resolve();

  async get(url: string): Promise<string | null> {
    const key = `t:${url}`;
    try {
      const result = await safeBrowserCall(() => browser.storage.local.get([key]));
      return (result?.[key] as string) || null;
    } catch (e) {
      return null;
    }
  }

  async set(url: string, color: string): Promise<void> {
    const key = `t:${url}`;
    
    // Serialize storage writes
    this.storageQueue = this.storageQueue.then(async () => {
      try {
        await safeBrowserCall(() => browser.storage.local.set({ [key]: color }));

        // Manage index and eviction
        const { [THEME_INDEX_KEY]: index } = await safeBrowserCall(() => 
          browser.storage.local.get({ [THEME_INDEX_KEY]: [] })
        ) as { [key: string]: string[] };

        let newIndex = index.filter(k => k !== url);
        newIndex.push(url);

        if (newIndex.length > MAX_THEMES) {
          const toEvict = newIndex.splice(0, 20);
          const evictKeys = toEvict.map(u => `t:${u}`);
          await safeBrowserCall(() => browser.storage.local.remove(evictKeys));
        }

        await safeBrowserCall(() => browser.storage.local.set({ [THEME_INDEX_KEY]: newIndex }));
      } catch (e) {
        console.warn('[ThemePersistence] Failed to save theme:', e);
      }
    }).catch(() => {});

    return this.storageQueue;
  }
}

export const themePersistence = new ThemePersistence();
