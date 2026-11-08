export type LyricsMode = 'original' | 'romanized' | 'translated';

export interface ProcessedCache {
  /** `null` only together with `translationFailed: true` (K1). */
  translated: string[] | null;
  romanized: string[];
  /** Hash of the exact source lyric lines used to generate this result. */
  sourceHash?: number;
  isLowQualityRomanization?: boolean;
  wasTruncated?: boolean;
  /** Translation failed; romanization is still usable. Never persisted. */
  translationFailed?: boolean;
  /** Memory-only result (failed translation or flagged romanization): never persisted, retried next session. */
  transient?: boolean;
  /** ROMANIZER_VERSION the romanization was made with (processedCache.ts). */
  romanizerVersion?: number;
}

export interface SongCache {
  original: string[];
  processed: Map<string, ProcessedCache>;
}

export interface LyricsCacheEntry {
  original: string[];
  processed: {
    [targetLang: string]: ProcessedCache;
  };
  lastAccessed: number;
  originalHash?: number;
  persistedAt?: number;
}

export type LyricsIndex = {
  [songKey: string]: {
    lastAccessed: number;
  };
};

export interface UnifiedSongCacheEntry {
  uri: string;
  title: string;
  artist: string;
  status: 'SYNCED' | 'UNSYNCED' | 'SYNCED_ROMANIZED' | 'MISSING';
  lyrics: {
    syncedLyrics?: string;
    plainLyrics?: string;
    source: 'SPOTIFY' | 'YTM' | 'LRCLIB' | 'NATIVE' | 'NONE';
  };
  processed: {
    [targetLang: string]: ProcessedCache;
  };
  metadata: {
    persistedAt: number;
    lastAccessed: number;
    extractedColor?: string | null;
  };
  
  // Backward compatibility fields for Chunk 2-5 transition
  original: string[];
  originalHash?: number;
  lastAccessed?: number;
  persistedAt?: number;
}

export function isUnifiedSongCacheEntry(obj: any): obj is UnifiedSongCacheEntry {
  return (
    obj &&
    typeof obj === 'object' &&
    'status' in obj &&
    'lyrics' in obj &&
    'metadata' in obj &&
    'processed' in obj
  );
}

export type SlyAction =
  | { type: 'SLY_FETCH_START'; trackId?: string }
  | { type: 'SLY_FETCH_END'; trackId?: string }
  | { type: 'SLY_INTERCEPT_START' }
  | { type: 'SLY_INTERCEPT_END' }
  | { type: 'SLY_FORCE_FALLBACK' }
  | { type: 'SLY_PREFETCH_REPORT'; trackId?: string; state: string; nativeStatus?: string; metadata?: any }
  | { type: 'SKL_NATIVE_LYRICS'; trackId?: string; nativeLines: string[]; isRomanizedUpgrade?: boolean; canonHash?: string; late?: boolean; spotifyLineCount?: number; romanizedWordLines?: string[] }
  | { type: 'SLY_NATIVE_NOTIFY_METADATA'; payload: { trackId: string; name: string; artist: string; durationMs?: number } }
  | { type: 'SLY_NATIVE_NEW_INTERCEPTION'; payload: { trackId: string }; requestId: string }
  | { type: 'SLY_NATIVE_NEW_INTERCEPTION_RESPONSE'; generation: number; requestId: string }
  | { type: 'SLY_NATIVE_FETCH'; payload: { trackId: string; hexGid: string; interceptId: number; spotifyWordLines?: number }; requestId: string }
  | { type: 'SLY_NATIVE_FETCH_RESPONSE'; ok: boolean; lines: any[] | null; requestId: string }
  | { type: 'SLY_TRACK_UPDATE'; payload: Record<string, any> }
  | { type: 'SLY_UPDATE_CLASSES'; classes: Record<string, string> }
  | { type: 'SLY_TRIGGER_NATIVE_CLOSE' }
  | { type: 'SLY_TRIGGER_NATIVE_OPEN' }
  | { type: 'SLY_NAV_CHANGE' };

