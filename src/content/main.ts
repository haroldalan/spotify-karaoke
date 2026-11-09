import { call } from '../shared/messages';
import { loadSettings, onSettingsChanged, saveSettings } from '../shared/settings';
import type { FoundLyrics, Mode, Settings, TrackMeta } from '../shared/types';
import { songScript } from '../shared/scripts';
import type { Song } from './lineStore';
import { Bridge } from './bridge';
import { STYLE } from './decorate';
import { LineStore } from './lineStore';
import { Pill, type Notice } from './pill';
import { View, type ViewState } from './view';

/** What the popup's status section asks the page for. */
export interface PageStatus {
  build: string;
  /** The song now playing, when its details went past, and whether no source has lyrics for it. */
  current: { name: string; artists: string[]; noLyrics: boolean } | null;
  /** Last time the page script reported anything (ms), 0 when never. */
  pageSeenAt: number;
  /** Last time lyrics went past (ms), 0 when never. */
  lyricsSeenAt: number;
  linesOnScreen: number;
}

const BUILD = `${chrome.runtime.getManifest().version}${import.meta.env.DEV ? '-dev' : ''}`;

/** "Add lyrics" for a song LRCLIB doesn't have: the LRCLIB uploader, prefilled. */
function lrclibUploadUrl(meta: TrackMeta): string {
  const u = new URL('https://lrclibup.boidu.dev/');
  u.searchParams.set('title', meta.name);
  u.searchParams.set('artist', meta.artists.join(', '));
  if (meta.album) u.searchParams.set('album', meta.album);
  if (meta.durationMs) u.searchParams.set('duration', String(Math.round(meta.durationMs / 1000)));
  return u.toString();
}

const lyricsButton = () => document.querySelector<HTMLElement>('[data-testid="lyrics-button"]');
const lyricsViewOpen = (b: HTMLElement | null) =>
  (!!b && (b.getAttribute('data-active') === 'true' || b.getAttribute('aria-pressed') === 'true')) ||
  !!document.querySelector('[role="radiogroup"] [role="radio"][value="lyrics"][aria-checked="true"]');
const baseLang = (l?: string | null) => (l ?? '').toLowerCase().split(/[-_]/)[0];

/** Whether the switcher has anything to offer for this song: not for a song already in the target language and script. */
function worthSwitching(song: Song | null, s: Settings): boolean {
  if (!song) return true;
  const script = song.script ?? songScript(song.lines, song.language);
  if (script !== 'Latn') return true;
  const lang = baseLang(song.language);
  return !lang || lang !== baseLang(s.targetLang);
}
const nowPlayingTitle = () => document.querySelector('[data-testid="now-playing-bar"] [data-testid="context-item-link"]')?.textContent?.trim() ?? '';

export async function startContent(): Promise<void> {
  // Settings and the no-lyrics list reach the page before Spotify's first requests are decided.
  const [loaded, known] = await Promise.all([
    loadSettings(),
    Promise.race([call('knownNoLyrics', {}), new Promise<string[]>((r) => setTimeout(() => r([]), 500))]).catch(() => [] as string[]),
  ]);
  let settings = loaded;
  const noLyrics = new Set<string>(known);
  const finding = new Map<string, Promise<FoundLyrics | null>>();
  const metas = new Map<string, TrackMeta>();
  /** Songs whose lyrics view came back empty this session, by id. */
  const missing = new Map<string, TrackMeta>();
  let notice: (Notice & { id: string }) | null = null;
  let pageSeenAt = 0;
  let lyricsSeenAt = 0;
  const pageConfig = () => ({ fillMissing: settings.fillMissing, restoreNative: settings.restoreNative, noLyrics: [...noLyrics] });

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
            if (r) {
              const native = r.lines.map((l) => l.text);
              const language = req.meta.languages[0] ?? null;
              // Aligned: Spotify may already show its romanized lines; tie them to this song.
              if (r.aligned) store.addRestored(req.lines, native, language);
              else store.addSong(native, language);
            }
            return r;
          },
          () => null,
        ),
      onMeta(meta) {
        pageSeenAt = Date.now();
        metas.set(meta.id, meta);
        if (metas.size > 300) metas.delete(metas.keys().next().value!);
        // Spotify has no lyrics: start looking now, before anyone opens the lyrics view.
        if (!meta.hasLyrics && settings.fillMissing) {
          void find(meta).then((found) => found && store.addSong(found.lines.map((l) => l.text), meta.languages[0] ?? null));
        }
      },
      onLyrics: (l) => {
        pageSeenAt = lyricsSeenAt = Date.now();
        missing.delete(l.id);
        store.addSong(l.lines, l.language);
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
  view.setWantRect(settings.showPill);
  const pill = new Pill((mode) => void saveSettings({ mode }));
  let lastView: ViewState = { lineCount: 0, anchor: null, song: null };

  /** The song now playing (matched by title: the player bar carries no track id). */
  function currentMeta(): TrackMeta | null {
    const title = nowPlayingTitle();
    return title ? [...metas.values()].reverse().find((m) => m.name === title) ?? null : null;
  }

  async function searchAgain(meta: TrackMeta): Promise<boolean> {
    notice = { id: meta.id, caption: 'Searching again…', actions: [] };
    render();
    const found = await call('retryLyrics', meta).catch(() => null);
    if (found) {
      noLyrics.delete(meta.id);
      finding.delete(meta.id);
      bridge.setConfig(pageConfig());
      // Spotify keeps its earlier "no lyrics" for this song until the page loads again
      // (reopening the lyrics view doesn't ask again: checked live 2026-11-09). A reload
      // interrupts playback, so it's the listener's call.
      notice = {
        id: meta.id,
        caption: 'Lyrics found. Spotify shows them after a reload.',
        actions: [{ label: 'Reload Spotify', run: () => location.reload(), primary: true }],
      };
    } else {
      notice = {
        id: meta.id,
        caption: 'Still none to be found.',
        actions: [{ label: 'Add lyrics to LRCLIB', href: lrclibUploadUrl(meta), primary: true }],
      };
    }
    render();
    return !!found;
  }

  /** The notice for the song on screen, when its lyrics view is open and empty. */
  function currentNotice(): Notice | null {
    if (!settings.showPill || lastView.lineCount > 0 || !lyricsViewOpen(lyricsButton())) return null;
    const title = nowPlayingTitle();
    const meta = [...missing.values()].reverse().find((m) => m.name === title);
    if (!meta) return null;
    if (notice?.id === meta.id) return notice;
    // Spotify's own message already says there are no lyrics: only the ways forward here.
    return {
      caption: '',
      actions: [
        { label: 'Search again', run: () => void searchAgain(meta) },
        { label: 'Add lyrics to LRCLIB', href: lrclibUploadUrl(meta), primary: true },
      ],
    };
  }

  function render() {
    const st = store.status(lastView.song);
    const translating = settings.mode === 'translated' || settings.showTranslation;
    const caption = translating && st.translateError
      ? /rate-limit/i.test(st.translateError) ? 'Translations paused for a few minutes' : 'Translation isn’t available right now'
      : undefined;
    pill.update({
      mode: settings.mode,
      visible: settings.showPill && lastView.lineCount > 0 && worthSwitching(lastView.song, settings),
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
    const fillChanged = s.fillMissing !== settings.fillMissing || s.restoreNative !== settings.restoreNative;
    settings = s;
    store.setSettings(s);
    view.setSettings(s);
    view.setWantRect(s.showPill);
    if (fillChanged) bridge.setConfig(pageConfig());
    render();
  });

  // O / R / T switch modes while lyrics are on screen (the rebindable Alt+Shift shortcuts work anywhere).
  const KEYS: Record<string, Mode> = { o: 'original', r: 'romanized', t: 'translated' };
  window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || lastView.lineCount === 0) return;
    const mode = KEYS[e.key.toLowerCase()];
    const t = e.target as HTMLElement | null;
    if (!mode || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    void saveSettings({ mode });
  });

  // The popup: status, and "Search again" for a song whose Lyrics button Spotify disabled
  // (no source had lyrics: the in-page actions can't be reached then).
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, reply) => {
    const kind = (msg as { sk?: string })?.sk;
    if (kind === 'page-status') {
      const m = currentMeta();
      const current = m ? { name: m.name, artists: m.artists, noLyrics: noLyrics.has(m.id) || missing.has(m.id) } : null;
      reply({ build: BUILD, current, pageSeenAt, lyricsSeenAt, linesOnScreen: lastView.lineCount } satisfies PageStatus);
      return false;
    }
    if (kind === 'search-again') {
      const m = currentMeta();
      if (!m) { reply({ found: false }); return false; }
      void searchAgain(m).then((found) => reply({ found }));
      return true;
    }
    return false;
  });

  // Spotify's mini player (Document Picture-in-Picture) is a window of its own: decorate it too.
  const pip = (window as unknown as { documentPictureInPicture?: EventTarget & { window: Window | null } }).documentPictureInPicture;
  const pipViews = new Set<View>();
  const attachPip = (w: Window) => {
    const st = w.document.createElement('style');
    st.textContent = STYLE;
    (w.document.head ?? w.document.documentElement).append(st);
    const v = new View(store, settings, w.document);
    v.setWantRect(false);
    v.start();
    pipViews.add(v);
    w.addEventListener('pagehide', () => { v.stop(); pipViews.delete(v); }, { once: true });
  };
  pip?.addEventListener('enter', (e) => attachPip((e as Event & { window: Window }).window));
  if (pip?.window) attachPip(pip.window);
  onSettingsChanged((s) => { for (const v of pipViews) v.setSettings(s); });

  const begin = () => view.start();
  if (document.body) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });
}
