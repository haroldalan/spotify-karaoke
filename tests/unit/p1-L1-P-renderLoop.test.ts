/**
 * Live round 1, group P1: the render loop.
 * Every Spotify row addition under div#main ran quickApply() + syncSetup(), and
 * both rewrote every row even when the rows already showed processed text;
 * syncSetup also rebuilt the lyricsObserver each time.
 *
 * Real createDomObserver + lifecycle controller on the synthetic 2026-11 panel
 * fixture. Row texts are invented (non-Latin, two empty leading spacer rows).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDomObserver, type SlyDomObserver } from '../../lib/dom/domObserver';
import { createModeController } from '../../lib/core/modeController';
import { createLifecycleController } from '../../lib/core/lifecycleController';
import { StateStore } from '../../lib/core/store';
import { getLyricsContainer, getLyricsLines, innerNeedsProcessing, rowNeedsProcessing } from '../../lib/dom/domQueries';
import { purgeSlyDOM } from '../../lib/dom/lyricsDOM';
import { hashString } from '../../lib/utils/hashUtils';
import { slyInternalState, spotifyState } from '../../lib/slyCore/state';

const FIXTURE = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-lyrics-panel.html'), 'utf-8');
const SONG_KEY = 'Now playing: Test Song by Test Artist, Second Artist';

// Invented text (not lyrics of any real song).
const NATIVE = ['', '', '하늘 아래 작은 길', '바람 소리 들려요', '♪', '오늘 밤 별이 빛나', '우리 함께 걸어요', '노래는 계속돼요', '마지막 인사를 해요'];
const ROMAN = ['', '', 'haneul arae jageun gil', 'baram sori deullyeoyo', '♪', 'oneul bam byeori binna', 'uri hamkke georeoyo', 'noraeneun gyesokdwaeyo', 'majimak insareul haeyo'];
const ENGLISH = ['', '', 'a small road under the sky', 'i hear the wind', '♪', 'tonight the stars shine', 'we walk together', 'the song goes on', 'we say goodbye'];

function makeRow(text: string): HTMLElement {
  const row = document.createElement('div');
  row.setAttribute('dir', 'auto');
  row.setAttribute('data-testid', 'lyrics-line');
  // Spotify marks empty spacer rows with their own class (its stylesheet:
  // .<line>:not(.<spacer>){margin-bottom:.6em}); the class learner relies on it.
  row.className = text ? 'MFEBmMwUCW5Qmg8VwGim tixQoLB1xUrPglVJ91J4' : 'MFEBmMwUCW5Qmg8VwGim tixQoLB1xUrPglVJ91J4 JraMqx9ZQax6C3ZIaMn2';
  const inner = document.createElement('div');
  inner.className = 'tUO1WBVA3vpkKoCsTCU_';
  inner.textContent = text;
  row.appendChild(inner);
  return row;
}

function loadFixture(): void {
  const parsed = new DOMParser().parseFromString(FIXTURE, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
  const list = getLyricsContainer()!;
  list.replaceChildren(...NATIVE.map(makeRow));
}

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const panelRows = () => Array.from(getLyricsContainer()!.querySelectorAll(':scope > [data-testid="lyrics-line"]'));

describe('p1-L1-P render loop: viewport filter, one rewrite per trigger, observer reuse', () => {
  let store: StateStore;
  let lifecycle: ReturnType<typeof createLifecycleController>;
  let observer: SlyDomObserver | null = null;
  let injected: number;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const logCount = (needle: string) => logSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes(needle)).length;
  const applies = () => logCount('applyLinesToDOM invoked');
  const observersCreated = () => logCount('createLyricsObserver: observing');

  function wire(mode: 'romanized' | 'original' = 'romanized'): void {
    store = new StateStore();
    store.songKey = SONG_KEY;
    store.preferredMode = mode;
    store.mode = mode;
    store.dualLyricsEnabled = true;
    store.godState = 'NATIVE_OK';
    store.currentActiveLang = 'en';
    store.lyricsAppliedForKey = SONG_KEY;
    store.cache.original = [...NATIVE];
    store.cache.processed.set('en', { romanized: [...ROMAN], translated: [...ENGLISH], sourceHash: hashString(NATIVE.join('|')) });
    const mc = createModeController({ store });
    lifecycle = createLifecycleController({ store, switchMode: mc.switchMode, reapplyMode: mc.reapplyMode, autoSwitchIfNeeded: mc.autoSwitchIfNeeded });
    injected = 0;
    observer = createDomObserver({
      onSongChange: (key) => lifecycle.onSongChange(key),
      onLyricsInjected: () => { injected++; lifecycle.quickApply(); lifecycle.syncSetup(); },
      onControlsRemoved: () => { lifecycle.syncPill(true); lifecycle.trySetupOrPoll(); },
      onInvalidate: () => {},
    });
    store.domObserver = observer;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    (window as any).browser.runtime.id = 'test-id';
    loadFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const m of ['warn', 'table', 'groupCollapsed', 'groupEnd', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => {});
    sessionStorage.clear();
    spotifyState.track = null;
    spotifyState.language = null;
    slyInternalState.interceptorActive = false;
    slyInternalState.isTransitioning = false;
    slyInternalState.currentLyrics = null;
    slyInternalState.pendingLyricsData = null;
  });

  afterEach(() => {
    observer?.disconnect();
    observer = null;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('first checks: Original mode leaves rows span-free, the Latin fallback does not', () => {
    // Original mode purges our markup: every Spotify row addition still counts there.
    getLyricsLines()[2].innerHTML = '<span class="sly-main-line">x</span>';
    getLyricsLines()[2].setAttribute('data-sly-original', NATIVE[2]);
    purgeSlyDOM();
    expect(getLyricsLines().some(el => el.querySelector('.sly-main-line, .sly-dual-line'))).toBe(false);
    expect(panelRows().filter(rowNeedsProcessing)).toHaveLength(7);
    expect(innerNeedsProcessing(getLyricsLines()[0])).toBe(false); // empty spacer
  });

  it('(a) binds with exactly one call and one apply, then stays quiet', async () => {
    wire();
    expect(injected).toBe(1);
    await flush();
    await vi.advanceTimersByTimeAsync(300);
    expect(injected).toBe(1);
    expect(applies()).toBe(1); // quickApply; syncSetup's fast path skips the identical rewrite
    expect(observersCreated()).toBe(1);
    const lines = getLyricsLines();
    expect(lines[2].querySelector('.sly-main-line')?.textContent).toBe('Haneul arae jageun gil');
    expect(lines[2].querySelector('.sly-dual-line')?.textContent).toBe(NATIVE[2]);
    expect(store.mode).toBe('romanized');
  });

  it('(b) moving a processed row does not fire', async () => {
    wire();
    await vi.advanceTimersByTimeAsync(300);
    const rows = panelRows();
    // React re-inserting a keyed row in place: a remove + add of the same element.
    rows[5].parentElement!.insertBefore(rows[5], rows[6]);
    await flush();
    await vi.advanceTimersByTimeAsync(300);
    expect(injected).toBe(1);
    expect(applies()).toBe(1);
  });

  it('(c) detaching and re-attaching the processed list does not fire onLyricsInjected', async () => {
    wire();
    await vi.advanceTimersByTimeAsync(300);
    const list = getLyricsContainer()!;
    const parent = list.parentElement!;
    list.remove();
    parent.appendChild(list);
    await flush();
    await vi.advanceTimersByTimeAsync(300);
    expect(injected).toBe(1);
    // Same container element: the lyricsObserver is kept.
    expect(observersCreated()).toBe(1);
  });

  it('(d) a fresh native row fires once, ends processed, with one apply and no new observer', async () => {
    wire();
    await vi.advanceTimersByTimeAsync(300);
    const before = applies();
    const fresh = makeRow(NATIVE[5]);
    panelRows()[5].replaceWith(fresh);
    await flush();
    expect(injected).toBe(2);
    const inner = fresh.querySelector(':scope > div')!;
    expect(inner.querySelector('.sly-main-line')?.textContent).toBe('Oneul bam byeori binna');
    expect(inner.querySelector('.sly-dual-line')?.textContent).toBe(NATIVE[5]);
    expect(applies() - before).toBe(1);
    expect(observersCreated()).toBe(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(injected).toBe(2);
    expect(applies() - before).toBe(1);
  });

  it('(e) a fresh empty spacer row does not fire', async () => {
    wire();
    await vi.advanceTimersByTimeAsync(300);
    const list = getLyricsContainer()!;
    list.insertBefore(makeRow(''), panelRows()[0]);
    await flush();
    await vi.advanceTimersByTimeAsync(300);
    expect(injected).toBe(1);
  });

  it('(f) a re-attached row with data-sly-original but native text and no spans DOES fire', async () => {
    wire();
    await vi.advanceTimersByTimeAsync(300);
    const row = panelRows()[6];
    const inner = row.querySelector(':scope > div')!;
    expect(inner.getAttribute('data-sly-original')).toBe(NATIVE[6]);
    row.remove();
    inner.textContent = NATIVE[6]; // Spotify's text back, our attribute left behind
    getLyricsContainer()!.appendChild(row);
    await flush();
    expect(injected).toBe(2);
    expect(inner.querySelector('.sly-main-line')).not.toBeNull();
  });

  it('(g) rows added under #Desktop_PanelContainer_Id or in an added NPV preview ancestor do not fire', async () => {
    wire();
    await vi.advanceTimersByTimeAsync(300);
    const aside = document.getElementById('Desktop_PanelContainer_Id')!;
    const card = document.createElement('div');
    card.setAttribute('data-testid', 'lyrics-npv-section');
    card.append(makeRow('미리보기 한 줄'), makeRow('미리보기 두 줄'));
    aside.appendChild(card);
    await flush();
    expect(injected).toBe(1);

    // An added ancestor that holds a preview card: the check is per row, not per added node.
    const wrapper = document.createElement('div');
    const card2 = document.createElement('div');
    card2.setAttribute('data-testid', 'lyrics-npv-section');
    card2.append(makeRow('미리보기 세 줄'));
    wrapper.appendChild(card2);
    document.querySelector('[data-testid="root"]')!.appendChild(wrapper);
    await flush();
    await vi.advanceTimersByTimeAsync(300);
    expect(injected).toBe(1);
  });

  it('(h) Original mode: a fresh row fires, nothing is applied and the observer is not rebuilt', async () => {
    wire('original');
    await vi.advanceTimersByTimeAsync(300);
    expect(injected).toBe(1);
    const appliesBefore = applies();
    const observersBefore = observersCreated();
    getLyricsContainer()!.appendChild(makeRow('새로운 줄 하나'));
    await flush();
    expect(injected).toBe(2);
    await vi.advanceTimersByTimeAsync(300);
    expect(applies()).toBe(appliesBefore);
    expect(observersCreated()).toBe(observersBefore);
    expect(getLyricsLines().some(el => el.querySelector('.sly-main-line'))).toBe(false);
  });

  it('logs at most one aggregated row-mount line per second, with structure only', async () => {
    wire();
    await vi.advanceTimersByTimeAsync(1500);
    const lineCount = () => logCount('[sly-perf] Panel row mounts');
    const start = lineCount();
    for (let i = 0; i < 5; i++) {
      panelRows()[5].replaceWith(makeRow(NATIVE[5]));
      await flush();
    }
    expect(lineCount() - start).toBeLessThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(lineCount() - start).toBe(2); // trailing flush of the aggregated window
    const lines = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((s: string) => s.includes('[sly-perf] Panel row mounts'));
    expect(lines[lines.length - 1]).toMatch(/batches=\d+ fired=\d+ nodes=\d+ rows=\d+ processed=\d+ empty=\d+/);
    expect(lines.some((s: string) => s.includes('div[lyrics-line]'))).toBe(true);
    for (const text of NATIVE.filter(Boolean)) expect(lines.some((s: string) => s.includes(text))).toBe(false);
  });
});
