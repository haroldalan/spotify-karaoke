import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createModeController } from '../../lib/core/modeController';
import { StateStore } from '../../lib/core/store';
import { getLyricsLines } from '../../lib/dom/domQueries';

const FIXTURE = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'), 'utf-8');

function loadFixture(): void {
  const parsed = new DOMParser().parseFromString(FIXTURE, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

const flush = () => new Promise(r => setTimeout(r, 0));
const processCalls = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls.filter(c => (c[0] as any)?.type === 'PROCESS').length;

describe('p1-C modeController', () => {
  let sendMessage: ReturnType<typeof vi.fn>;
  let store: StateStore;

  beforeEach(() => {
    loadFixture();
    for (const m of ['log', 'warn', 'table', 'groupCollapsed', 'groupEnd', 'error'] as const) {
      vi.spyOn(console, m).mockImplementation(() => {});
    }
    (window as any).browser.runtime.id = 'test-id';
    sendMessage = vi.fn().mockResolvedValue(undefined);
    (window as any).browser.runtime.sendMessage = sendMessage;
    // Romanized Hindi tagged "id" (see tests/fixtures/color-lyrics-romanized-hindi.json).
    (window as any).spotifyState = { track: null, language: 'id' };
    (window as any).slyInternalState = { interceptorActive: false };
    store = new StateStore();
    store.songKey = 'Now playing: Test Song by Test Artist';
    store.currentActiveLang = 'en';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    (window as any).spotifyState = { track: null };
  });

  it('Romanized on Latin (romanized-fallback) lines shows them as they are once the interceptor settled', async () => {
    const { switchMode } = createModeController({ store });
    await switchMode('romanized');
    expect(store.mode).toBe('romanized');
    expect(store.cache.original).toHaveLength(7);
    expect(processCalls(sendMessage)).toBe(0);
  });

  it('releases isSwitchingMode when a Latin romanized switch supersedes an in-flight translation', async () => {
    let resolveProcess: (v: unknown) => void = () => {};
    sendMessage.mockImplementation((msg: any) =>
      msg?.type === 'PROCESS' ? new Promise(r => { resolveProcess = r; }) : Promise.resolve(undefined));
    const { switchMode } = createModeController({ store });

    const translating = switchMode('translated', 'en');
    await flush();
    expect(store.isSwitchingMode).toBe(true);

    await switchMode('romanized'); // Latin shortcut, newest generation
    const lines = getLyricsLines().map(el => el.textContent ?? '');
    resolveProcess({ translated: lines.map(l => `EN ${l}`), romanized: lines });
    await translating;

    expect(store.mode).toBe('romanized');
    expect(store.isSwitchingMode).toBe(false);
  });

  it('does not let periodic auto-switches re-request lyrics the background just failed on', async () => {
    sendMessage.mockImplementation((msg: any) => Promise.resolve(msg?.type === 'PROCESS' ? null : undefined));
    store.preferredMode = 'translated';
    const { autoSwitchIfNeeded } = createModeController({ store });

    autoSwitchIfNeeded();
    await flush();
    await flush();
    expect(processCalls(sendMessage)).toBe(1);
    expect(store.mode).toBe('original'); // rolled back
    expect(store.isSwitchingMode).toBe(false);
    expect(document.getElementById('sly-toast')?.textContent).toBe('Processing failed. Please try again.');

    // sly:state NATIVE_OK ticks / syncSetup call this repeatedly.
    autoSwitchIfNeeded();
    autoSwitchIfNeeded();
    await flush();
    expect(processCalls(sendMessage)).toBe(1);

    // One-shot forced re-evaluations still retry.
    autoSwitchIfNeeded(true);
    await flush();
    await flush();
    expect(processCalls(sendMessage)).toBe(2);
  });

  it('Translated with a failed translation rolls back and keeps the romanization for Romanized mode', async () => {
    (window as any).spotifyState = { track: null, language: 'ja' };
    const ja = ['きょうはあめです', 'あしたははれです', 'そらがあおいです'];
    document.querySelectorAll('.bm5I7yGVN8NXt6vH9eiC [data-testid="lyrics-line"] > div').forEach((el, i) => {
      el.textContent = ja[i % ja.length];
    });
    const romaji = getLyricsLines().map((_, i) => ['Kyou wa ame desu', 'Ashita wa hare desu', 'Sora ga aoi desu'][i % 3]);
    sendMessage.mockImplementation((msg: any) => Promise.resolve(
      msg?.type === 'PROCESS' ? { translated: null, romanized: romaji, translationFailed: true } : undefined));
    const { switchMode } = createModeController({ store });

    await switchMode('translated', 'en');
    expect(store.mode).toBe('original');
    expect(document.getElementById('sly-toast')?.textContent).toBe('Translation failed. Please try again.');

    await switchMode('romanized');
    expect(store.mode).toBe('romanized');
    expect(processCalls(sendMessage)).toBe(1); // romanization reused from memory
    expect(getLyricsLines()[0].querySelector('.sly-main-line')?.textContent).toBe('Kyou wa ame desu');
  });
});
