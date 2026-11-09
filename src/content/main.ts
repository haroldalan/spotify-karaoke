import { call } from '../shared/messages';
import { loadSettings, onSettingsChanged, saveSettings } from '../shared/settings';
import type { FoundLyrics, Mode, Settings, TrackMeta } from '../shared/types';
import { Bridge } from './bridge';
import { STYLE } from './decorate';
import { ALL_MODES, switchFor } from './modes';
import { LineStore } from './lineStore';
import { Pill, type Notice } from './pill';
import { View, type ViewState } from './view';

/** What the popup's status line asks the page for. */
export interface PageStatus {
  build: string;
  /** Last time the page script reported anything (ms), 0 when never. */
  pageSeenAt: number;
  /** Last time lyrics went past (ms), 0 when never. */
  lyricsSeenAt: number;
  linesOnScreen: number;
}

const BUILD = `${chrome.runtime.getManifest().version}${import.meta.env.DEV ? '-dev' : ''}`;

/**
 * A newer copy of this script, injected into an open tab on install or update, announces
 * itself with this event; the one already running (cut off from the extension by the
 * update) steps aside.
 */
const TAKEOVER = 'spotify-karaoke:takeover';

/** "Add lyrics" for a song nobody has lyrics for: the LRCLIB uploader, prefilled. */
function lrclibUploadUrl(meta: TrackMeta): string {
  const u = new URL('https://lrclibup.boidu.dev/');
  u.searchParams.set('title', meta.name);
  u.searchParams.set('artist', meta.artists.join(', '));
  if (meta.album) u.searchParams.set('album', meta.album);
  if (meta.durationMs) u.searchParams.set('duration', String(Math.round(meta.durationMs / 1000)));
  return u.toString();
}

/** Spotify's full lyrics view is open (its Lyrics button is on, or its media switch says lyrics). */
function lyricsViewOpen(doc: Document = document): boolean {
  const b = doc.querySelector<HTMLElement>('[data-testid="lyrics-button"]');
  return (
    (!!b && (b.getAttribute('data-active') === 'true' || b.getAttribute('aria-pressed') === 'true')) ||
    !!doc.querySelector('[role="radiogroup"] [role="radio"][value="lyrics"][aria-checked="true"]')
  );
}

/** The song in Spotify's player bar: its title, and its artists when they can be read. */
function nowPlaying(): { title: string; artists: string[] } {
  const bar = document.querySelector('[data-testid="now-playing-widget"]') ?? document.querySelector('[data-testid="now-playing-bar"]');
  const title = bar?.querySelector('[data-testid="context-item-link"]')?.textContent?.trim() ?? '';
  const artists = [...(bar?.querySelectorAll('a[href*="/artist/"]') ?? [])].map((a) => a.textContent?.trim() ?? '').filter(Boolean);
  return { title, artists };
}

/** Whether these details are the song in the player bar (by title and, when shown, artist). */
function isNowPlaying(m: TrackMeta, np = nowPlaying()): boolean {
  return !!np.title && m.name === np.title && (!np.artists.length || m.artists.some((a) => np.artists.includes(a)));
}

const MODE_KEYS: Record<string, Mode> = { o: 'original', r: 'romanized', t: 'translated' };

/** O / R / T switch modes while lyrics are on screen in `win`, outside text fields. */
function listenForKeys(win: Window, lyricsShown: () => boolean, pick: (m: Mode) => void, signal: AbortSignal) {
  win.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || !lyricsShown()) return;
    const mode = MODE_KEYS[e.key.toLowerCase()];
    const t = e.target as HTMLElement | null;
    if (!mode || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    pick(mode);
  }, { signal });
}

export async function startContent(): Promise<void> {
  // An older copy in this tab (before an update) steps aside first.
  document.dispatchEvent(new CustomEvent(TAKEOVER));
  const life = new AbortController();
  const { signal } = life;

  // Settings and the no-lyrics list reach the page before Spotify's first requests are decided.
  const [loaded, known] = await Promise.all([
    loadSettings(),
    Promise.race([call('knownNoLyrics', {}), new Promise<string[]>((r) => setTimeout(() => r([]), 500))]).catch(() => [] as string[]),
  ]);
  if (signal.aborted) return;
  let settings = loaded;
  /** The non-translated mode last chosen: what "Original" on a Latin-script song goes back to. */
  let lastPlain: Mode = settings.mode === 'translated' ? 'romanized' : settings.mode;
  const noLyrics = new Set<string>(known);
  const finding = new Map<string, Promise<FoundLyrics | null>>();
  const metas = new Map<string, TrackMeta>();
  /** Songs whose lyrics view came back empty this session, by id. */
  const missing = new Map<string, TrackMeta>();
  /** Songs whose "Add lyrics" was followed this session. */
  const added = new Set<string>();
  /** Native-script copies found for songs, used only if the page put them on screen in time. */
  const restored = new Map<string, { shown: string[]; native: string[]; language: string | null; aligned: boolean }>();
  let pageSeenAt = 0;
  let lyricsSeenAt = 0;
  const pageConfig = () => ({ noLyrics: [...noLyrics] });

  const store = new LineStore((req) => call('process', req), settings);

  const find = (meta: TrackMeta): Promise<FoundLyrics | null> => {
    let p = finding.get(meta.id);
    if (!p) {
      p = call('findLyrics', meta).then(
        (found) => {
          if (!found) {
            noLyrics.add(meta.id);
            bridge.setConfig(pageConfig());
          }
          return found;
        },
        () => {
          finding.delete(meta.id); // unreachable sources: try again later
          return null;
        },
      );
      finding.set(meta.id, p);
    }
    return p;
  };

  const bridge = new Bridge(
    {
      findLyrics: find,
      restoreNative: (req) =>
        call('restoreNative', req).then(
          (r) => {
            // Kept until the page says whether it used it: a copy that came too late is
            // used the next time the song loads (from cache, in time), never dropped onto
            // lines already being read.
            if (r) {
              restored.set(req.meta.id, { shown: req.lines, native: r.lines.map((l) => l.text), language: req.meta.languages[0] ?? null, aligned: r.aligned });
              if (restored.size > 20) restored.delete(restored.keys().next().value!);
            }
            return r;
          },
          () => null,
        ),
      onMeta(meta) {
        pageSeenAt = Date.now();
        metas.set(meta.id, meta);
        if (metas.size > 300) metas.delete(metas.keys().next().value!);
        // Japanese needs a dictionary: load it while the song starts, not when its lines arrive.
        if (meta.languages.includes('ja')) void call('warm', { language: 'ja' }).catch(() => {});
        // Spotify has no lyrics: start looking now, before anyone opens the lyrics view.
        if (!meta.hasLyrics) {
          void find(meta).then((found) => found && store.addSong(found.lines.map((l) => l.text), meta.languages[0] ?? null));
        }
      },
      onLyrics: (l) => {
        pageSeenAt = lyricsSeenAt = Date.now();
        missing.delete(l.id);
        store.addSong(l.lines, l.language);
        const r = restored.get(l.id);
        restored.delete(l.id);
        // The page used our native-script copy: Spotify shows it, and its own romanized
        // lines (aligned) become this song's romanization.
        if (r && l.source !== 'spotify' && r.aligned) store.addRestored(r.shown, r.native, r.language);
      },
      onMissing: (m) => {
        pageSeenAt = Date.now();
        const meta = metas.get(m.id);
        if (m.found) missing.delete(m.id);
        else if (meta) missing.set(m.id, meta);
        render();
      },
      onError: (m) => console.warn('[spotify-karaoke] page:', m),
    },
    pageConfig(),
  );

  const style = document.createElement('style');
  style.id = 'spotify-karaoke-style';
  // Which build is running (for diagnostics): version, and -dev for `npm run dev` builds.
  style.dataset.skBuild = BUILD;
  style.textContent = STYLE;
  (document.head ?? document.documentElement).append(style);

  const view = new View(store, settings);
  view.setWantRect(true);
  let lastView: ViewState = { lineCount: 0, anchor: null, song: null };

  /** A mode picked on the page (switcher or key). */
  function pick(mode: Mode) {
    const sw = switchFor(lastView.song, settings);
    // On a Latin-script song "Original" means "not translated": back to the last such mode.
    const next = mode === 'original' && sw && !sw.modes.includes('romanized') ? lastPlain : mode;
    pill.wake();
    if (next !== settings.mode) void saveSettings({ mode: next });
  }
  const pill = new Pill(pick);

  /** "Add lyrics" was followed: forget that nobody had lyrics, so the next load searches again. */
  function added_(meta: TrackMeta) {
    added.add(meta.id);
    noLyrics.delete(meta.id);
    finding.delete(meta.id);
    bridge.setConfig(pageConfig());
    void call('forgetLyrics', meta).catch(() => {});
    render();
  }

  /** "Add lyrics" for the song on screen, when its lyrics view is open and empty. */
  function currentNotice(): Notice | null {
    if (lastView.lineCount > 0 || !lyricsViewOpen()) return null;
    const np = nowPlaying();
    const meta = [...missing.values()].reverse().find((m) => isNowPlaying(m, np));
    if (!meta) return null;
    // Spotify's own message already says there are no lyrics: only the way forward here.
    return {
      caption: added.has(meta.id) ? 'They’ll show the next time this song loads.' : '',
      actions: [{ label: 'Add lyrics', href: lrclibUploadUrl(meta), run: () => added_(meta), primary: true }],
    };
  }

  function render() {
    const st = store.status(lastView.song);
    const caption = settings.mode === 'translated' && st.translateError
      ? /rate-limit/i.test(st.translateError) ? 'Translations paused for a few minutes' : 'Translation isn’t available right now'
      : undefined;
    const sw = switchFor(lastView.song, settings);
    pill.update({
      mode: sw?.mode ?? settings.mode,
      modes: sw?.modes ?? ALL_MODES,
      visible: !!sw && lastView.lineCount > 0 && lyricsViewOpen(),
      anchor: lastView.anchor,
      busy: st.pending,
      caption,
    });
    const n = currentNotice();
    pill.notice(n, n ? lastView.anchor : null);
  }

  view.onUpdate((v) => {
    lastView = v;
    if (v.lineCount) pill.mount();
    render();
  });
  store.onChange(render);

  onSettingsChanged((s) => {
    if (signal.aborted) return;
    settings = s;
    if (s.mode !== 'translated') lastPlain = s.mode;
    store.setSettings(s);
    view.setSettings(s);
    for (const v of pipViews) v.setSettings(s);
    render();
  });

  listenForKeys(window, () => lastView.lineCount > 0 && lyricsViewOpen(), pick, signal);

  // The switcher fades while the mouse rests; any movement brings it back.
  let lastMove = 0;
  window.addEventListener('mousemove', () => {
    const now = Date.now();
    if (now - lastMove < 200) return;
    lastMove = now;
    pill.wake();
  }, { signal, passive: true });

  // The popup's status line.
  const onMessage = (msg: unknown, _sender: chrome.runtime.MessageSender, reply: (r: unknown) => void) => {
    if ((msg as { sk?: string })?.sk !== 'page-status' || signal.aborted) return false;
    reply({ build: BUILD, pageSeenAt, lyricsSeenAt, linesOnScreen: lastView.lineCount } satisfies PageStatus);
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);

  // Spotify's mini player (Document Picture-in-Picture) is a window of its own: decorate it too.
  const pip = (window as unknown as { documentPictureInPicture?: EventTarget & { window: Window | null } }).documentPictureInPicture;
  const pipViews = new Set<View>();
  const attachPip = (w: Window) => {
    const st = w.document.createElement('style');
    st.textContent = STYLE;
    (w.document.head ?? w.document.documentElement).append(st);
    const v = new View(store, settings, w.document);
    let lines = 0;
    v.onUpdate((s) => { lines = s.lineCount; });
    v.setWantRect(false);
    v.start();
    pipViews.add(v);
    listenForKeys(w, () => lines > 0, pick, signal);
    w.addEventListener('pagehide', () => { v.stop(); pipViews.delete(v); }, { once: true });
  };
  pip?.addEventListener('enter', (e) => attachPip((e as Event & { window: Window }).window), { signal });
  if (pip?.window) attachPip(pip.window);

  // Step aside for a newer copy of this script.
  document.addEventListener(TAKEOVER, () => {
    life.abort();
    view.stop();
    for (const v of pipViews) v.stop();
    pipViews.clear();
    pill.remove();
    bridge.dispose();
    style.remove();
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* cut off already */ }
  }, { once: true, signal });

  const begin = () => { if (!signal.aborted) view.start(); };
  if (document.body) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true, signal });
}
