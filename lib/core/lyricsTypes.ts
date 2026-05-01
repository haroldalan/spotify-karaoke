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
}

export type LyricsIndex = {
  [songKey: string]: {
    lastAccessed: number;
  };
};
