export type LyricsMode = 'original' | 'romanized' | 'translated';

export interface ProcessedCache {
  translated: string[];
  romanized: string[];
  isLowQualityRomanization?: boolean;
  wasTruncated?: boolean;
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
    source: 'SPOTIFY' | 'YTM' | 'LRCLIB' | 'MUSIXMATCH' | 'NONE';
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
  | { type: 'SKL_NATIVE_LYRICS'; trackId?: string; nativeLines: string[]; isRomanizedUpgrade?: boolean; canonHash?: string }
  | { type: 'SLY_MXM_WARMUP' }
  | { type: 'SLY_MXM_NOTIFY_METADATA'; payload: { trackId: string; name: string; artist: string } }
  | { type: 'SLY_MXM_NEW_INTERCEPTION'; payload: { trackId: string }; requestId: string }
  | { type: 'SLY_MXM_NEW_INTERCEPTION_RESPONSE'; generation: number; requestId: string }
  | { type: 'SLY_MXM_FETCH_NATIVE'; payload: { providerLyricsId: string | null; trackId: string; hexGid: string; interceptId: number }; requestId: string }
  | { type: 'SLY_MXM_FETCH_NATIVE_RESPONSE'; ok: boolean; lines: any[] | null; requestId: string }
  | { type: 'SLY_GET_MXM_TOKEN' }
  | { type: 'SLY_MXM_TOKEN_RESPONSE'; token: string; expiry: number }
  | { type: 'SLY_SET_MXM_TOKEN'; payload: { token: string; expiry: number } }
  | { type: 'SLY_TRACK_UPDATE'; payload: Record<string, any> }
  | { type: 'SLY_UPDATE_CLASSES'; classes: Record<string, string> }
  | { type: 'SLY_TRIGGER_NATIVE_CLOSE' }
  | { type: 'SLY_TRIGGER_NATIVE_OPEN' }
  | { type: 'SLY_NAV_CHANGE' };


