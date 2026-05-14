import type { LyricsMode, SongCache, LyricsCacheEntry } from './lyricsTypes';
import { isContextValid, safeBrowserCall } from '../utils/browserUtils';

export class StateStore {
  mode: LyricsMode = 'original';
  preferredMode: LyricsMode = 'original';
  currentActiveLang = 'en';
  dualLyricsEnabled = true;
  songKey = '';
  cache: SongCache = { original: [], processed: new Map() };
  romanizedGenRef = { value: 0 };
  translatedGenRef = { value: 0 };
  globalProcessGenRef = { value: 0 };
  switchGenRef = { value: 0 };
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
  
  // Instance-level state moved from module level (BUG-C11)
  godState: 'IDLE' | 'LOADING' | 'NATIVE_OK' | 'RELEASING' | 'PIPELINE_A' | 'FETCHING' | 'FAILED' | 'AD' = 'IDLE';
  setupLock = false;
  lockOwnerKey: string | null = null;
  lastAuditedSongKey = '';
  /** Song key whose lyrics have actually been written into the DOM. */
  lyricsAppliedForKey = '';

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


  }
}
