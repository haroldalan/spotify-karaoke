// @ts-nocheck
import { spotifyState } from './state';
import { getNowPlayingTrackId } from '../dom/domQueries';

export interface TrackMetadata {
  uri: string | undefined;
  title: string;
  artist: string;
  albumArtUrl: string | undefined;
}

/**
 * MetadataEngine: Centralized service for track metadata extraction.
 * Reconciles Spotify's internal state with DOM evidence to provide 
 * reliable data during high-speed transitions.
 */
export const MetadataEngine = {
  /**
   * Extracts current track metadata.
   * Priority: DOM for URI (more reactive), State for text/images.
   */
  getNowPlaying(): TrackMetadata {
    const track = spotifyState.track as Record<string, any> | null;
    
    // 1. Resolve URI (Priority: DOM -> State)
    const domId = getNowPlayingTrackId();
    const stateUri = track?.uri as string | undefined;
    const uri = domId ? `spotify:track:${domId}` : stateUri;

    // 2. Resolve Title
    const title = track?.name || '';

    // 3. Resolve Artist (Normalization)
    // Spotify's internal state format varies; we check multiple common locations.
    const artist = track?.metadata?.artist_name || 
                   track?.artists?.[0]?.name || 
                   track?.artistName || 
                   '';

    // 4. Resolve Album Art
    const albumArtUrl = track?.metadata?.image_large_url || 
                        track?.images?.[0]?.url || 
                        track?.image || 
                        undefined;

    return { uri, title, artist, albumArtUrl };
  },

  /**
   * Validates metadata for fetch readiness.
   * Ensures we don't send garbage or missing fields to the Service Worker.
   */
  isValidForFetch(meta: TrackMetadata): boolean {
    const valid = !!(meta.title && meta.artist && meta.uri && meta.uri !== 'N/A' && meta.uri !== 'ad');
    if (!valid) {
      console.warn(`[MetadataEngine] ⚠️ Metadata invalid for fetch: "${meta.title}" by "${meta.artist}" [URI: ${meta.uri}]`);
    }
    return valid;
  }
};
