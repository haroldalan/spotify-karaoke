import { call } from '../shared/messages';
import { loadSettings, loadSpotifyOnly, onSettingsChanged, onSpotifyOnlyChanged, saveSettings, setSpotifyOnly } from '../shared/settings';
import type { FoundLyrics, Mode, TrackMeta } from '../shared/types';
import type { LyricsKind } from '../page/channel';
import { Bridge } from './bridge';
import { STYLE } from './decorate';
import { ALL_MODES, switchFor } from './modes';
import { LineStore } from './lineStore';
import { Pill, type Notice } from './pill';
import { View, type ViewState } from './view';

/**
 * A reload Spotify needs before it shows a change: lyrics found by Search again, or the
 * listener's choice for a song ("Not this song" / "Undo"). `scheduled`: after this song.
 */
export type ReloadOffer = { scheduled: boolean; reason: 'found' | 'choice' } | null;

/** What the popup asks the page for. */
export interface PageStatus {
  build: string;
  /** The song in the player bar, when its details went past. */
  current: {
    name: string;
    artists: string[];
    /** No source has lyrics for it. */
    noLyrics: boolean;
    /** The lyrics on screen came from us: found, restored to their own script, or a synced copy. */
    ours: { kind: Exclude<LyricsKind, 'spotify'>; source: string } | null;
    /** The listener sent this song back to Spotify ("Not this song"). */
    spotifyOnly: boolean;
  } | null;
  /** Lyrics found, or a choice made, that Spotify shows after a reload. */
  reload: ReloadOffer;
  /** Last time the page script reported anything (ms), 0 when never. */
  pageSeenAt: number;
  /** Last time lyrics went past (ms), 0 when never. */
  lyricsSeenAt: number;
  linesOnScreen: number;
}

/** Popup → page requests. */
export type PageRequest =
  | { sk: 'page-status' }
  | { sk: 'search-again' }
  | { sk: 'reload'; when: 'now' | 'after-song' | 'cancel' }
  | { sk: 'not-this-song'; on: boolean };

const BUILD = `${chrome.runtime.getManifest().version}${import.meta.env.DEV ? '-dev' : ''}`;

/**
 * A newer copy of this script, added to an open tab on install or update, announces itself
 * with this event; the one already running (cut off from the extension) steps aside.
 */
const TAKEOVER = 'spotify-karaoke:takeover';

/** "Add lyrics" for a song LRCLIB doesn't have: the LRCLIB uploader, prefilled. */
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

  // Settings and the song lists reach the page before Spotify's first requests are decided.
  const [loaded, known, sentBack] = await Promise.all([
    loadSettings(),
    Promise.race([call('knownNoLyrics', {}), new Promise<string[]>((r) => setTimeout(() => r([]), 500))]).catch(() => [] as string[]),
    loadSpotifyOnly(),
  ]);
  if (signal.aborted) return;
  let settings = loaded;
  /** The non-translated mode last chosen: what "Original" on a Latin-script song goes back to. */
  let lastPlain: Mode = settings.mode === 'translated' ? 'romanized' : settings.mode;
  const noLyrics = new Set<string>(known);
  let spotifyOnly = new Set<string>(sentBack);
  /** As the page loaded: a choice undone before reloading needs no reload. */
  const spotifyOnlyAtLoad = new Set<string>(sentBack);
  const finding = new Map<string, Promise<FoundLyrics | null>>();
  const metas = new Map<string, TrackMeta>();
  /** Songs whose lyrics view came back empty this session, by id. */
  const missing = new Map<string, TrackMeta>();
  /** Where each song's lyrics on screen came from. */
  const kinds = new Map<string, { kind: LyricsKind; source: string }>();
  /** Native-script copies found, used only if the page put them on screen in time. */
  const restored = new Map<string, { shown: string[]; native: string[]; language: string | null; aligned: boolean }>();
  /** The no-lyrics notice's state for a song (searching, nothing, found). */
  let notice: { id: string; caption: string; searching?: boolean; found?: boolean } | null = null;
  /** Songs whose "Add lyrics to LRCLIB" was followed this session. */
  const added = new Set<string>();
  let reload: ReloadOffer = null;
  let reloadTimer: ReturnType<typeof setInterval> | undefined;
  let pageSeenAt = 0;
  let lyricsSeenAt = 0;
  const pageConfig = () => ({ noLyrics: [...noLyrics], spotifyOnly: [...spotifyOnly] });

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
            // Kept until the page says whether it used it: a copy that came too late is used
            // the next time the song loads (from cache, in time), never dropped onto lines
            // already being read.
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
        if (!meta.hasLyrics && !spotifyOnly.has(meta.id)) {
          void find(meta).then((found) => found && store.addSong(found.lines.map((l) => l.text), meta.languages[0] ?? null));
        }
      },
      onLyrics: (l) => {
        pageSeenAt = lyricsSeenAt = Date.now();
        missing.delete(l.id);
        kinds.set(l.id, { kind: l.kind ?? 'spotify', source: l.source });
        if (kinds.size > 300) kinds.delete(kinds.keys().next().value!);
        store.addSong(l.lines, l.language);
        const r = restored.get(l.id);
        restored.delete(l.id);
        // Our native-script copy is on screen: Spotify's own romanized lines (aligned with
        // it) become this song's romanization.
        if (r && l.kind === 'restored' && r.aligned) store.addRestored(r.shown, r.native, r.language);
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
  let lastView: ViewState = { lineCount: 0, anchor: null, song: null };

  /** A mode picked on the page (switcher or key). */
  function pick(mode: Mode) {
    const sw = switchFor(lastView.song, settings);
    // On a Latin-script song "Original" means "not translated": back to the last such mode.
    const next = mode === 'original' && sw && !sw.modes.includes('romanized') ? lastPlain : mode;
    if (next !== settings.mode) void saveSettings({ mode: next });
  }
  const pill = new Pill(pick);

  /** The song now playing, by title and artist (the player bar carries no track id). */
  function currentMeta(): TrackMeta | null {
    const np = nowPlaying();
    return [...metas.values()].reverse().find((m) => isNowPlaying(m, np)) ?? null;
  }

  // ── Reloading: Spotify shows newly found lyrics (or drops ours) only after one ──
  function offerReload(reason: 'found' | 'choice') {
    cancelReload();
    reload = { scheduled: false, reason };
    render();
  }
  function cancelReload() {
    clearInterval(reloadTimer);
    reloadTimer = undefined;
    if (reload) reload = { ...reload, scheduled: false };
  }
  /** Reload when the song in the player bar changes. */
  function reloadAfterSong() {
    cancelReload();
    const np = nowPlaying();
    const key = `${np.title}\n${np.artists.join(',')}`;
    reload = { scheduled: true, reason: reload?.reason ?? 'found' };
    reloadTimer = setInterval(() => {
      const now = nowPlaying();
      if (now.title && `${now.title}\n${now.artists.join(',')}` !== key) location.reload();
    }, 500);
    render();
  }
  function reloadActions(): Notice['actions'] {
    return reload?.scheduled
      ? [{ label: 'Cancel', run: () => { cancelReload(); render(); } }, { label: 'Reload now', run: () => location.reload(), primary: true }]
      : [{ label: 'After this song', run: reloadAfterSong }, { label: 'Reload now', run: () => location.reload(), primary: true }];
  }

  // ── Search again ──
  async function searchAgain(meta: TrackMeta): Promise<boolean> {
    notice = { id: meta.id, caption: 'Searching again…', searching: true };
    added.delete(meta.id);
    render();
    const found = await call('retryLyrics', meta).catch(() => null);
    if (found) {
      noLyrics.delete(meta.id);
      finding.delete(meta.id);
      bridge.setConfig(pageConfig());
      // Spotify keeps its earlier "no lyrics" for this song until the page loads again
      // (reopening the lyrics view doesn't ask again: checked live 2026-11-09).
      notice = { id: meta.id, caption: '', found: true };
      offerReload('found');
    } else {
      notice = { id: meta.id, caption: 'Still none to be found.' };
    }
    render();
    return !!found;
  }

  /** The notice for the song on screen, when its lyrics view is open and empty. */
  function currentNotice(): Notice | null {
    if (lastView.lineCount > 0 || !lyricsViewOpen()) return null;
    const np = nowPlaying();
    const meta = [...missing.values()].reverse().find((m) => isNowPlaying(m, np));
    if (!meta || spotifyOnly.has(meta.id)) return null;
    const search = { label: 'Search again', run: () => void searchAgain(meta) };
    const add = { label: 'Add lyrics to LRCLIB', href: lrclibUploadUrl(meta), run: () => { added.add(meta.id); } };
    const mine = notice?.id === meta.id ? notice : null;
    if (mine?.found && reload) {
      return {
        caption: reload.scheduled ? 'Spotify reloads when this song ends.' : 'Lyrics found. Spotify shows them after a reload, which stops the music.',
        actions: reloadActions(),
      };
    }
    if (mine?.searching) return { caption: mine.caption, actions: [] };
    // Back from adding lyrics: searching is the next step.
    if (added.has(meta.id)) return { caption: 'Added them? Search again.', actions: [add, { ...search, primary: true }] };
    // Spotify's own message already says there are no lyrics: only the ways forward here.
    return { caption: mine?.caption ?? '', actions: [search, { ...add, primary: true }] };
  }

  function render() {
    if (signal.aborted) return;
    const st = store.status(lastView.song);
    const translating = settings.mode === 'translated' || settings.allLines;
    const caption = translating && st.translateError
      ? /rate-limit/i.test(st.translateError) ? 'Translations paused for a few minutes' : 'Translation isn’t available right now'
      : undefined;
    const sw = switchFor(lastView.song, settings);
    pill.update({
      mode: sw?.mode ?? settings.mode,
      modes: sw?.modes ?? ALL_MODES,
      visible: settings.showPill && !!sw && lastView.lineCount > 0 && lyricsViewOpen(),
      anchor: lastView.anchor,
      busy: st.pending,
      caption,
    });
    const n = currentNotice();
    if (n) pill.mount();
    pill.notice(n, n ? lastView.anchor : null);
  }

  view.onUpdate((v) => {
    lastView = v;
    if (v.lineCount) pill.mount();
    render();
  });
  store.onChange(render);
  // Back from the LRCLIB tab: the notice now suggests searching.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); }, { signal });

  onSettingsChanged((s) => {
    if (signal.aborted) return;
    settings = s;
    if (s.mode !== 'translated') lastPlain = s.mode;
    store.setSettings(s);
    view.setSettings(s);
    for (const v of pipViews) v.setSettings(s);
    render();
  });
  onSpotifyOnlyChanged((ids) => {
    if (signal.aborted) return;
    spotifyOnly = new Set(ids);
    bridge.setConfig(pageConfig());
    render();
  });

  listenForKeys(window, () => lastView.lineCount > 0 && lyricsViewOpen(), pick, signal);

  // The popup: the song playing, Search again, Not this song, and the reload they lead to.
  const onMessage = (msg: unknown, _sender: chrome.runtime.MessageSender, reply: (r: unknown) => void) => {
    const req = msg as PageRequest | undefined;
    if (signal.aborted || !req || typeof req.sk !== 'string') return false;
    const m = currentMeta();
    if (req.sk === 'page-status') {
      const k = m ? kinds.get(m.id) : undefined;
      const current = m
        ? {
            name: m.name,
            artists: m.artists,
            noLyrics: noLyrics.has(m.id) || missing.has(m.id),
            ours: k && k.kind !== 'spotify' ? { kind: k.kind, source: k.source } : null,
            spotifyOnly: spotifyOnly.has(m.id),
          }
        : null;
      reply({ build: BUILD, current, reload, pageSeenAt, lyricsSeenAt, linesOnScreen: lastView.lineCount } satisfies PageStatus);
      return false;
    }
    if (req.sk === 'search-again') {
      if (!m) { reply({ found: false }); return false; }
      void searchAgain(m).then((found) => reply({ found }));
      return true;
    }
    if (req.sk === 'reload') {
      if (req.when === 'now') location.reload();
      else if (req.when === 'after-song') reloadAfterSong();
      else { cancelReload(); render(); }
      reply({ reload });
      return false;
    }
    if (req.sk === 'not-this-song') {
      if (!m) { reply({ ok: false }); return false; }
      void setSpotifyOnly(m.id, req.on).then((ids) => {
        spotifyOnly = new Set(ids);
        if (!req.on) { noLyrics.delete(m.id); finding.delete(m.id); }
        bridge.setConfig(pageConfig());
        // Undone before reloading: what's on screen is already right.
        if (spotifyOnly.has(m.id) === spotifyOnlyAtLoad.has(m.id)) {
          cancelReload();
          reload = null;
          render();
        } else offerReload('choice');
        reply({ ok: true, reload });
      }, () => reply({ ok: false }));
      return true;
    }
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
    cancelReload();
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
