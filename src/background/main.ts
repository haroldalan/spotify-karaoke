import { serve } from '../shared/messages';
import { saveSettings } from '../shared/settings';
import type { Mode } from '../shared/types';
import { findLyrics, knownNoLyrics } from './lyrics/find';
import { restoreNative } from './lyrics/native';
import { processLines } from './text/process';
import { ytmHeaderRules } from './lyrics/ytm';

export function startBackground(): void {
  void ytmHeaderRules().then(
    () => { (globalThis as { __skRules?: string }).__skRules = 'ok'; },
    (e) => {
      (globalThis as { __skRules?: string }).__skRules = `failed: ${String(e?.message || e)}`;
      console.warn('[spotify-karaoke] header rules:', e);
    },
  );
  serve({
    findLyrics,
    knownNoLyrics: () => knownNoLyrics(),
    restoreNative,
    process: processLines,
    status: () => ({ version: chrome.runtime.getManifest().version }),
  });

  // Keyboard shortcuts (chrome://extensions/shortcuts). Settings sync to every tab.
  chrome.commands?.onCommand.addListener((command) => {
    const mode = ({ 'mode-original': 'original', 'mode-romanized': 'romanized', 'mode-translated': 'translated' } as Record<string, Mode>)[command];
    if (mode) void saveSettings({ mode });
  });
}
