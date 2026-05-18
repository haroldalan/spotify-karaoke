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

