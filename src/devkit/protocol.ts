// The dev kit: lets a developer (or an agent driving the browser) do from Spotify's page
// what otherwise needs the popup or chrome://extensions: read the extension's state, change
// settings, run the popup's actions, clear or forget cached results, reload the extension.
//
// Built into development builds only (`npm run dev`, `npm run build:devkit`). In production
// builds DEVKIT is false and every dev kit path is compiled out.
//
//   page (MAIN world)  window.__skDev.op(...)
//     -> window.postMessage   { tag: DEVKIT_TAG, dir: 'req' }
//   content script      answers page-side ops, forwards the rest
//     -> chrome.runtime.sendMessage { skDev: true, op, args }
//   background          extension-side ops (reload, cache, logs)

export const DEVKIT: boolean = import.meta.env.MODE !== 'production';

export const DEVKIT_TAG = 'spotify-karaoke-devkit';

export interface DevReq {
  tag: typeof DEVKIT_TAG;
  dir: 'req';
  id: number;
  op: string;
  args?: unknown;
}

export interface DevRes {
  tag: typeof DEVKIT_TAG;
  dir: 'res';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** A request from the content script to the background. */
export interface DevBackgroundReq {
  skDev: true;
  op: string;
  args?: unknown;
}

export type DevAnswer = { ok: true; value: unknown } | { ok: false; error: string };

export const isDevReq = (d: unknown): d is DevReq => !!d && (d as DevReq).tag === DEVKIT_TAG && (d as DevReq).dir === 'req';
export const isDevRes = (d: unknown): d is DevRes => !!d && (d as DevRes).tag === DEVKIT_TAG && (d as DevRes).dir === 'res';

/** What `__skDev.help()` prints: every op, its arguments, and what it does. */
export const HELP: Record<string, string> = {
  'help()': 'This list.',
  'status()': "What the popup shows: the page's status (song, source, reload offer), settings, version, sources' health, storage.",
  'state()': "The content script's state: songs it knows, where the lyrics on screen came from, the view, the switcher.",
  'settings(patch?)': 'Reads the settings, or changes them first (e.g. { allLines: true }). Same as the popup.',
  'mode(m)': "Sets the mode: 'original' | 'romanized' | 'translated'.",
  'popup(req)': "Sends the popup's request to this page: { sk: 'page-status' | 'search-again' | 'not-this-song', on } | { sk: 'reload', when: 'now' | 'after-song' | 'cancel' }.",
  'searchAgain()': "The popup's Search again, for the song playing.",
  'notThisSong(on = true)': "The popup's Not this song (on) or its Undo (false), for the song playing.",
  'forget(id?)': 'Forgets every cached result for one track (default: the one playing), so its next load searches afresh.',
  'fresh()': 'forget() the song playing, then reload this page so Spotify asks for its lyrics again. Reloading stops the music if this tab plays it.',
  'clearCache()': "The popup's Clear cache.",
  'resetData()': "The popup's Reset data: settings, Not this song choices and the cache.",
  'cacheKeys(filter?)': 'Cache keys (optionally only those containing filter), newest first.',
  'cacheGet(key)': 'One cache entry as stored.',
  'health()': "Whether each outside service is answering.",
  'log(n = 50)': "The last n decisions: the page script's (__skLog) and the background's request log.",
  'reloadExtension()': 'Reloads the extension (picks up a new devkit build). Open Spotify tabs get the new scripts without a reload.',
};
