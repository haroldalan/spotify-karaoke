import type { LyricsMode, SongCache, LyricsCacheEntry } from './lyricsTypes';
import { isContextValid, safeBrowserCall } from '../utils/browserUtils';

export class StateStore {
  mode: LyricsMode = 'original';
  preferredMode: LyricsMode = 'original';
  currentActiveLang = 'en';
  dualLyricsEnabled = true;
  songKey = '';
  cache: SongCache = { original: [], processed: new Map() };
  processGenRef = { value: 0 };
  isApplying = false;
  isSwitchingMode = false;
  showPill = true;
  runtimeCache = new Map<string, LyricsCacheEntry>();
  pendingNativeLines = new Map<string, string[]>();
  domObserver: MutationObserver | null = null;
  lyricsObserver: MutationObserver | null = null;
  pollId: number | null = null;
  slyActiveContainer: HTMLElement | null = null;
  /** Padding-free array of rendered lyric line elements, set by sly:takeover.
   *  Used by syncedLyricsRenderer instead of querySelectorAll to avoid the
   *  2-padding-div index offset that causes sync mismatch on mid-song skip. */
  slyActiveDomElements: HTMLElement[] = [];

  async loadFromStorage(): Promise<void> {
    await safeBrowserCall(async () => {
      const prefs = await browser.storage.sync.get(['dualLyrics', 'targetLang', 'preferredMode', 'showPill']);
      this.dualLyricsEnabled = prefs.dualLyrics !== undefined ? (prefs.dualLyrics as boolean) : true;
      this.currentActiveLang = (prefs.targetLang as string) ?? 'en';
      this.preferredMode = (prefs.preferredMode as LyricsMode) ?? 'original';
      this.showPill = prefs.showPill !== undefined ? (prefs.showPill as boolean) : true;
    }).catch(() => {
      console.warn('[SKaraoke:Content] storage.sync unavailable, using defaults');
      this.dualLyricsEnabled = true;
      this.currentActiveLang = 'en';
      this.preferredMode = 'original';
      this.showPill = true;
    });

    await safeBrowserCall(async () => {
      const allLocal = await browser.storage.local.get(null);
      for (const [k, v] of Object.entries(allLocal)) {
        if (k.startsWith('lc:') && k !== 'lc_index') {
          const key = k.substring(3); // strip 'lc:' prefix
          this.runtimeCache.set(key, v as LyricsCacheEntry);
        }
      }
    }).catch((err) => {
      console.warn('[SKaraoke:Content] Failed to preload runtime cache from storage.local', err);
    });
  }
}
