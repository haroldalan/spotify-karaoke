import { call } from '../shared/messages';
import { loadSettings, onSettingsChanged, saveSettings } from '../shared/settings';
import type { FoundLyrics, TrackMeta } from '../shared/types';
import { Bridge } from './bridge';
import { STYLE } from './decorate';
import { LineStore } from './lineStore';
import { Pill } from './pill';
import { View } from './view';

export async function startContent(): Promise<void> {
  let settings = await loadSettings();
  const noLyrics = new Set<string>();
  const finding = new Map<string, Promise<FoundLyrics | null>>();
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
              // Aligned: also map Spotify's romanized lines to ours, in case Spotify drew its own first.
              if (r.aligned) store.addAliases(req.lines, r.lines.map((l) => l.text));
              store.addSong(r.lines.map((l) => l.text), req.meta.languages[0] ?? null);
            }
            return r;
          },
          () => null,
        ),
      onMeta(meta) {
        // Spotify has no lyrics: start looking now, before anyone opens the lyrics view.
        if (!meta.hasLyrics && settings.fillMissing) {
          void find(meta).then((found) => found && store.addSong(found.lines.map((l) => l.text), meta.languages[0] ?? null));
        }
      },
      onLyrics: (l) => store.addSong(l.lines, l.language),
      onError: (m) => console.warn('[spotify-karaoke] page:', m),
    },
    pageConfig(),
  );

  const style = document.createElement('style');
  style.id = 'spotify-karaoke-style';
  style.textContent = STYLE;
  (document.head ?? document.documentElement).append(style);

  const view = new View(store, settings);
  const pill = new Pill((mode) => void saveSettings({ mode }));
  let lastView = { lineCount: 0, rect: null as DOMRect | null };
  const renderPill = () => {
    const st = store.status();
    const translating = settings.mode === 'translated' || settings.showTranslation;
    pill.update({
      mode: settings.mode,
      visible: settings.showPill && lastView.lineCount > 0,
      rect: lastView.rect,
      busy: st.pending,
      note: translating && st.translateError ? 'Translation unavailable' : undefined,
    });
  };
  view.onUpdate((v) => {
    lastView = v;
    if (v.lineCount) pill.mount();
    renderPill();
  });
  store.onChange(renderPill);

  onSettingsChanged((s) => {
    const fillChanged = s.fillMissing !== settings.fillMissing || s.restoreNative !== settings.restoreNative;
    settings = s;
    store.setSettings(s);
    view.setSettings(s);
    if (fillChanged) bridge.setConfig(pageConfig());
    renderPill();
  });

  const begin = () => view.start();
  if (document.body) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });
}
