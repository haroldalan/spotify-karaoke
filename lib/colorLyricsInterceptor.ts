import { LATIN_LIKE_LANGS, base62ToHex } from './utils/spotifyUtils';
import type { MxmClient } from './mxmClient';

export async function handleColorLyrics(
  originalResponse: Response,
  fallbackResponse: Response,
  url: string,
  mxm: MxmClient
): Promise<Response> {
  let data: any = null;

  // Guard: non-2xx responses (401, 429, 503, 304, etc.) will never
  // contain the lyrics JSON we need. Return the clone immediately —
  // no parse attempt, no console error.
  // The try-catch below still covers any unexpected failures on 200s.
  if (!originalResponse.ok) {
      return fallbackResponse;
  }

  try {
      data = await originalResponse.json() as any;
      const language = data.lyrics?.language;
      const isDenseTypeface = data.lyrics?.isDenseTypeface;
      const providerLyricsId = data.lyrics?.providerLyricsId;
      const spotifyTrackId = url.match(/\/track\/([A-Za-z0-9]+)/)?.[1];
      const hexGid = spotifyTrackId ? base62ToHex(spotifyTrackId) : null;

      if (isDenseTypeface !== false || LATIN_LIKE_LANGS.has(language!) || !spotifyTrackId || !hexGid) {
          if (!hexGid && spotifyTrackId) {
              console.warn('[SKaraoke:Interceptor] Base62 conversion failed for track ID:', spotifyTrackId);
          }
          const headers = new Headers(fallbackResponse.headers);
          headers.delete('content-encoding');
          headers.set('content-type', 'application/json');
          return new Response(JSON.stringify(data), { 
              status: fallbackResponse.status,
              statusText: fallbackResponse.statusText,
              headers 
          });
      }

      // Increment generation only for real intercepts
      const interceptId = mxm.newInterception(spotifyTrackId);

      const nativeLines = await mxm.fetchNativeLines(providerLyricsId, spotifyTrackId, hexGid, interceptId);
      if (!nativeLines || nativeLines.length === 0) {
          console.warn('[SKaraoke:Interceptor] Native restoration failed or returned no lines.');
          const headers = new Headers(fallbackResponse.headers);
          headers.delete('content-encoding');
          headers.set('content-type', 'application/json');
          return new Response(JSON.stringify(data), { 
              status: fallbackResponse.status,
              statusText: fallbackResponse.statusText,
              headers 
          });
      }

      window.postMessage({
          type: 'SKL_NATIVE_LYRICS',
          trackId: spotifyTrackId,
          nativeLines: nativeLines.map((l: any) => l.words),
      }, window.location.origin);

      const modified = {
          ...data,
          lyrics: { ...data.lyrics, isDenseTypeface: true, lines: nativeLines },
      };

      const headers = new Headers(fallbackResponse.headers);
      headers.delete('content-encoding');
      headers.set('content-type', 'application/json');

      return new Response(JSON.stringify(modified), {
          status: fallbackResponse.status,
          statusText: fallbackResponse.statusText,
          headers,
      });
  } catch (e) {
      console.error('[SKaraoke:Interceptor] Interceptor block error:', e);
      if (data === null) return fallbackResponse;
      const headers = new Headers(fallbackResponse.headers);
      headers.delete('content-encoding');
      headers.set('content-type', 'application/json');
      return new Response(JSON.stringify(data), {
          status: fallbackResponse.status,
          statusText: fallbackResponse.statusText,
          headers,
      });
  }
}
