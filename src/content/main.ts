import { call } from '../shared/messages';
import { loadSettings, onSettingsChanged, saveSettings } from '../shared/settings';
import type { FoundLyrics, Mode, TrackMeta } from '../shared/types';
import { Bridge } from './bridge';
import { STYLE } from './decorate';
import { LineStore } from './lineStore';
import { Pill, type Notice } from './pill';
import { View, type ViewState } from './view';

/** What the popup's status section asks the page for. */
export interface PageStatus {
  build: string;
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
const lyricsViewOpen = (b: HTMLElement | null) => !!b && (b.getAttribute('data-active') === 'true' || b.getAttribute('aria-pressed') === 'true');
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
  let lastView: ViewState = { lineCount: 0, rect: null, song: null };

  async function searchAgain(meta: TrackMeta) {
    notice = { id: meta.id, text: `Searching again for ${meta.name}…`, actions: [] };
    render();
    const found = await call('retryLyrics', meta).catch(() => null);
    if (found) {
      noLyrics.delete(meta.id);
      finding.delete(meta.id);
      missing.delete(meta.id);
      bridge.setConfig(pageConfig());
      notice = null;
      // Spotify asks for the lyrics again when its lyrics view reopens.
      const b = lyricsButton();
      if (b && lyricsViewOpen(b)) {
        b.click();
        setTimeout(() => lyricsButton()?.click(), 400);
      }
    } else {
      notice = {
        id: meta.id,
        text: `Still no lyrics for ${meta.name}`,
        actions: [{ label: 'Add to LRCLIB', href: lrclibUploadUrl(meta), primary: true }],
      };
    }
    render();
  }

  /** The notice for the song on screen, when its lyrics view is open and empty. */
  function currentNotice(): Notice | null {
    if (!settings.showPill || lastView.lineCount > 0 || !lyricsViewOpen(lyricsButton())) return null;
    const title = nowPlayingTitle();
    const meta = [...missing.values()].reverse().find((m) => m.name === title);
    if (!meta) return null;
    if (notice?.id === meta.id) return notice;
    return {
      text: `No lyrics found for ${meta.name}`,
      actions: [
        { label: 'Search again', run: () => void searchAgain(meta) },
        { label: 'Add to LRCLIB', href: lrclibUploadUrl(meta), primary: true },
      ],
    };
  }

  function render() {
    const st = store.status(lastView.song);
    const translating = settings.mode === 'translated' || settings.showTranslation;
    pill.update({
      mode: settings.mode,
      visible: settings.showPill && lastView.lineCount > 0,
      rect: lastView.rect,
      busy: st.pending,
      note: translating && st.translateError ? 'Translation unavailable' : undefined,
    });
    const n = currentNotice();
    pill.notice(n, n ? lyricsButton()?.getBoundingClientRect() ?? null : null);
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

  // The popup's status section.
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, reply) => {
    if ((msg as { sk?: string })?.sk !== 'page-status') return false;
    reply({ build: BUILD, pageSeenAt, lyricsSeenAt, linesOnScreen: lastView.lineCount } satisfies PageStatus);
    return false;
  });

  const begin = () => view.start();
  if (document.body) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });
}
