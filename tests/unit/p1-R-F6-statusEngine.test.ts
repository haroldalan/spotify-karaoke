/**
 * Review fix C4: the HUD → takeover handoff must not give Spotify's panel back.
 * StatusEngine.clear({ restoreNative: false }) removes only the HUD and its lock;
 * the root, sly-active and the hidden themed panel stay for executeTakeover.
 * Synthetic 2026 lyrics-panel fixture (invented text only).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import '../../lib/slyCore/state';
import '../../lib/slyCore/preFetch';
import '../../lib/slyCore/scavenger';
import '../../lib/slyCore/styles';
import { slyUntagLayoutHost } from '../../lib/slyCore/domEngine';
import { StatusEngine } from '../../lib/slyCore/statusEngine';

/** Spotify's panel in a state with no lyrics on screen (its loading or error state): the
 *  only kind of panel a status screen may be drawn in (statusEngine spotifyLyricsOnScreen). */
const noSpotifyWords = () => document.querySelectorAll('div.bm5I7yGVN8NXt6vH9eiC [data-testid="lyrics-line"]').forEach((l) => { l.textContent = ''; });


const FIXTURE_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'), 'utf8');
const w = window as any;

const themedPanel = () => document.querySelector('div.bm5I7yGVN8NXt6vH9eiC') as HTMLElement;

function loadFixture(): void {
  const doc = new DOMParser().parseFromString(FIXTURE_HTML, 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  document.getElementById('sly-core-styles')?.remove();
  noSpotifyWords();
}

function showFetchingHud(): HTMLElement {
  StatusEngine.show('Fetching [Title]', 'Searching...', false, { title: 'Test Song', artist: 'Test Artist' });
  return document.getElementById('lyrics-root-sync')!;
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  loadFixture();
  StatusEngine.clear(); // drop any hidden-panel reference left by an earlier test
  slyUntagLayoutHost();
  w.slyInternalState.customRoot = null;
  w.spotifyState.track = null;
});

describe('StatusEngine.clear({ restoreNative: false }) (C4)', () => {
  it('removes the HUD and its lock but keeps the root, sly-active and the hidden themed panel', () => {
    const themed = themedPanel();
    const host = themed.parentElement!;
    const root = showFetchingHud();
    expect(themed.style.display).toBe('none');

    StatusEngine.clear({ restoreNative: false });

    expect(document.getElementById('sly-status-hud')).toBeNull();
    expect(themed.style.display).toBe('none');
    expect(document.getElementById('lyrics-root-sync')).toBe(root);
    expect(root.isConnected).toBe(true);
    expect(w.slyInternalState.customRoot).toBe(root);
    expect(host.classList.contains('sly-active')).toBe(true);
    expect(host.classList.contains('sly-hud-active')).toBe(false);
    expect(w.slyInternalState.statusHUDActive).toBe(false);
    expect(w.slyInternalState.isFetchingHUD).toBe(false);
  });

  it('keeps the hidden-panel reference: a later clear() still restores the panel if no takeover rendered', () => {
    const themed = themedPanel();
    showFetchingHud();
    StatusEngine.clear({ restoreNative: false });

    // Takeover aborted (e.g. track skipped): the next plain clear() gives the panel back.
    StatusEngine.clear();

    expect(themed.style.display).toBe('');
    expect(document.getElementById('lyrics-root-sync')).toBeNull();
    expect(themed.parentElement!.classList.contains('sly-active')).toBe(false);
  });

  it('after the takeover renders lines, the sly:takeover clear() keeps the panel hidden', () => {
    const themed = themedPanel();
    const root = showFetchingHud();
    StatusEngine.clear({ restoreNative: false });
    const line = document.createElement('div');
    line.setAttribute('data-testid', 'lyrics-line');
    root.appendChild(line);

    StatusEngine.clear();

    expect(themed.style.display).toBe('none');
    expect(document.getElementById('lyrics-root-sync')).toBe(root);
  });

  it('still accepts the legacy preserveState boolean', () => {
    showFetchingHud();
    StatusEngine.clear(true);
    expect(w.slyInternalState.statusHUDActive).toBe(true);
    expect(themedPanel().style.display).toBe('');

    StatusEngine.clear({ preserveState: false });
    expect(w.slyInternalState.statusHUDActive).toBe(false);
  });
});
