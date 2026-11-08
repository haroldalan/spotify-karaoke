/**
 * Live round 1 replay (integration): the real content-script entrypoint (Pipeline B
 * lifecycle/mode controllers + domObserver + message listener, slyCore state /
 * messaging / detector / content decision engine / takeover) and the real MAIN-world
 * fetch interceptor, wired together on the synthetic 2026-11 fixtures.
 *
 * Mocked boundaries only: browser.runtime.sendMessage (background answers), storage,
 * Spotify's network (window.fetch before the interceptor wraps it), timers, and the
 * MAIN-world bridge, which is replaced by SLY_TRACK_UPDATE messages of the shape
 * entrypoints/slyBridge.ts posts. jsdom's window.postMessage sets no event.source, so
 * it is replaced by an async MessageEvent dispatch with source: window.
 *
 * Every title, id and lyric line below is invented.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PANEL_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-lyrics-panel.html'), 'utf8');
const HOME_HTML = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-11-home.html'), 'utf8');
const w = window as any;

// ---------------------------------------------------------------------------
// Invented tracks
// ---------------------------------------------------------------------------
interface TrackDef { id: string; uri: string; title: string; artist: string; key: string }
const track = (id: string, title: string, artist: string): TrackDef =>
  ({ id, uri: `spotify:track:${id}`, title, artist, key: `Now playing: ${title} by ${artist}` });

/** R: romanized Hindi on Spotify (LINE_SYNCED, tagged 'hi'). */
const R = track('R0manizedHindiTrack001', 'Saath Raho', 'Invented Singer');
/** N: Spotify has no lyrics for it (no color-lyrics request is ever made). */
const N = track('NoLyricsTrackInvented2', 'Engine Room Anthem', 'Made Up Band');
/** K: native-script Korean-like lyrics, LINE_SYNCED; prefetched while N plays. */
const K = track('KoreanNextTrackInvnt03', 'Byeolbit Gil', 'Imaginary Duo');

const R_WORDS = ['Dil mera tera hai yaar', 'Tum saath ho toh sab kuch hai', '♪', 'Kabhi toh aaja mere paas', 'Yaad teri aaj bhi hai', 'Zindagi mein tera naam hai'];
/** Spotify renders two empty padding rows above the lines and one below (none for the trailing ''). */
const R_ROWS = ['', '', ...R_WORDS, ''];
const R_PREVIEW = R_WORDS.filter(l => l !== '♪').slice(0, 3);

const R_NATIVE = ['दिल मेरा तेरा है यार', 'तुम साथ हो तो सब कुछ है', 'कभी तो आजा मेरे पास', 'याद तेरी आज भी है', 'ज़िंदगी में तेरा नाम है'];
/** The fallback (LRC) lines: '♪' intro first, so their layout differs from Spotify's rows. */
const R_TAKEOVER = ['♪', ...R_NATIVE];
const R_LRC = R_TAKEOVER.map((l, i) => `[00:${String(i * 5).padStart(2, '0')}.00]${l === '♪' ? '' : l}`).join('\n');
const R_LOCAL_ROMAN = ['♪', 'dila mera tera hai yara', 'tuma satha ho to saba kucha hai', 'kabhi to aaja mere pasa', 'yada teri aja bhi hai', 'zindagi mem tera nama hai'];
const R_ENGLISH = ['♪', 'my heart is yours, friend', 'with you here I have it all', 'come to me some day', 'I still remember you', 'your name is in my life'];

const K_WORDS = ['별빛 아래 걷는 길', '작은 바람 소리', '♪', '오늘 밤 우리 함께', '노래는 끝나지 않아', '마지막 인사를 해'];
const K_ROWS = ['', '', ...K_WORDS, ''];
const K_ROMAN = ['byeolbit arae geonneun gil', 'jageun baram sori', '♪', 'oneul bam uri hamkke', 'noraeneun kkeutnaji ana', 'majimak insareul hae'];
const K_ENGLISH = ['a road under the starlight', 'the sound of a small wind', '♪', 'tonight we are together', 'the song does not end', 'saying the last goodbye'];

const PROCESS_TABLE = new Map<string, { romanized: string; translated: string }>();
R_TAKEOVER.forEach((l, i) => PROCESS_TABLE.set(l, { romanized: R_LOCAL_ROMAN[i], translated: R_ENGLISH[i] }));
K_WORDS.forEach((l, i) => PROCESS_TABLE.set(l, { romanized: K_ROMAN[i], translated: K_ENGLISH[i] }));

const colorLyricsUrl = (id: string) => `https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}/image/x?format=json&vocalRemoval=false&market=from_token`;
const colorLyricsBody = (words: string[], language: string, isDenseTypeface: boolean) => ({
  lyrics: {
    syncType: 'LINE_SYNCED',
    lines: [...words, ''].map((w, i) => ({ startTimeMs: String(1000 + i * 5000), words: w, syllables: [], endTimeMs: '0', transliteratedWords: '' })),
    provider: 'MusixMatch', providerLyricsId: '90000001', providerDisplayName: 'Musixmatch', syncLyricsUri: '',
    isDenseTypeface, alternatives: [], language, isRtlLanguage: false, capStatus: 'UNCAPPED',
  },
  colors: { background: -13619152, text: -16777216, highlightText: -1 },
  hasVocalRemoval: false,
});

// ---------------------------------------------------------------------------
// Timers / flushing
// ---------------------------------------------------------------------------
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const advance = async (ms: number) => { await flush(); await vi.advanceTimersByTimeAsync(ms); await flush(); };

// ---------------------------------------------------------------------------
// Console capture (lyric text never asserted from logs; logs only for diagnostics)
// ---------------------------------------------------------------------------
const logLines: string[] = [];
const logged = (needle: string) => logLines.filter(l => l.includes(needle)).length;

// ---------------------------------------------------------------------------
// Background (browser.runtime.sendMessage) boundary
// ---------------------------------------------------------------------------
interface SentMessage { type: string; payload?: any; lines?: string[]; [k: string]: unknown }
const sent: SentMessage[] = [];
const sentOf = (type: string) => sent.filter(m => m.type === type);
const fetchLyricsFor = (t: TrackDef) => sentOf('FETCH_LYRICS').filter(m => m.payload?.uri === t.uri);
const reportsFor = (t: TrackDef) => sentOf('SLY_REPORT_NATIVE_STATUS').filter(m => m.payload?.uri === t.uri);
const delayed = <T>(ms: number, value: T) => new Promise<T>(res => setTimeout(() => res(value), ms));

let mxmGeneration = 0;
/** What the background answers for a FETCH_LYRICS of each track. */
const fetchLyricsAnswer = new Map<string, () => Promise<unknown>>();

function background(msg: SentMessage): Promise<unknown> {
  sent.push(JSON.parse(JSON.stringify(msg)));
  switch (msg.type) {
    case 'SLY_NATIVE_NEW_INTERCEPTION':
      return Promise.resolve({ generation: ++mxmGeneration });
    case 'SLY_NATIVE_FETCH':
      // The Musixmatch lookup outlives the 4 s hold budget, then finds nothing.
      return delayed(7000, { ok: false });
    case 'SLY_CHECK_CACHE':
      return Promise.resolve({ found: false });
    case 'FETCH_LYRICS': {
      const answer = fetchLyricsAnswer.get(msg.payload?.uri);
      return answer ? answer() : new Promise(() => {});
    }
    case 'PROCESS': {
      const lines = msg.lines as string[];
      if (!lines.every(l => PROCESS_TABLE.has(l) || !l.trim())) return Promise.resolve(null);
      return delayed(200, {
        romanized: lines.map(l => PROCESS_TABLE.get(l)?.romanized ?? l),
        translated: lines.map(l => PROCESS_TABLE.get(l)?.translated ?? l),
      });
    }
    case 'GET_COLOR':
      return Promise.resolve({ color: 'rgb(40, 20, 60)' });
    default:
      return Promise.resolve(undefined);
  }
}

// ---------------------------------------------------------------------------
// DOM: one page, mutated in place like Spotify's React does
// ---------------------------------------------------------------------------
let overlay: HTMLElement;           // the expanded Now Playing overlay (holds the full lyrics panel)
let overlaySlot: { parent: Element; next: Node | null };
let npvCard: HTMLElement;           // the Now Playing view lyrics preview card
let widget: HTMLElement;            // now-playing-widget-v2 (mounted after boot)
let widgetSlot: { parent: Element; next: Node | null };

/** A Spotify row; empty rows are padding rows (their own last class, as on the live page). */
function rowEl(text: string): HTMLElement {
  const row = document.createElement('div');
  row.setAttribute('dir', 'auto');
  row.setAttribute('data-testid', 'lyrics-line');
  row.className = text === ''
    ? 'MFEBmMwUCW5Qmg8VwGim NToFVceZLenbhmfcDb3s JraMqx9ZQax6C3ZIaMn2'
    : 'MFEBmMwUCW5Qmg8VwGim tixQoLB1xUrPglVJ91J4';
  const inner = document.createElement('div');
  inner.className = 'tUO1WBVA3vpkKoCsTCU_';
  inner.textContent = text;
  row.appendChild(inner);
  return row;
}

let nativeList: HTMLElement;       // Spotify's row list inside the themed panel
let nativeThemed: HTMLElement;     // Spotify's themed lyrics container (--lyrics-color-*)
const panelList = () => nativeList;
const themedPanel = () => nativeThemed;
const panelRows = () => Array.from(panelList().querySelectorAll(':scope > [data-testid="lyrics-line"]')) as HTMLElement[];
const inners = () => panelRows().map(r => r.querySelector(':scope > div') as HTMLElement);
const mainLine = (inner: Element) => inner.querySelector('.sly-main-line')?.textContent ?? null;
const dualLine = (inner: Element) => inner.querySelector('.sly-dual-line')?.textContent ?? null;
const hasOurMarkup = () => inners().some(el => el.hasAttribute('data-sly-original') || el.querySelector('.sly-main-line, .sly-dual-line'));
const takeoverRows = () => Array.from(document.querySelectorAll('#lyrics-root-sync [data-testid="lyrics-line"]')) as HTMLElement[];

function buildPage(): void {
  const panelDoc = new DOMParser().parseFromString(PANEL_HTML, 'text/html');
  document.body.innerHTML = panelDoc.body.innerHTML;
  overlay = document.querySelector('.BKBhMtk7_HSsKiFLJtC_') as HTMLElement;
  overlaySlot = { parent: overlay.parentElement!, next: overlay.nextSibling };
  nativeList = overlay.querySelector('.t3jTARRdoLQZ0LowMbxg > div') as HTMLElement;
  nativeThemed = overlay.querySelector('div[style*="--lyrics-color-active"]') as HTMLElement;
  panelList().replaceChildren();
  overlay.remove();

  const homeDoc = new DOMParser().parseFromString(HOME_HTML, 'text/html');
  npvCard = homeDoc.querySelector('#Desktop_PanelContainer_Id > div') as HTMLElement;
  npvCard.querySelector('.FOuUnTRQ4vzmdpbFOSWp')!.replaceChildren();
  document.getElementById('Desktop_PanelContainer_Id')!.appendChild(document.adoptNode(npvCard));

  widget = document.querySelector('[data-testid="now-playing-widget-v2"]') as HTMLElement;
  widgetSlot = { parent: widget.parentElement!, next: widget.nextSibling };
  widget.remove();
  setLyricsButton(false);
}

function setLyricsButton(active: boolean): void {
  const btn = document.querySelector('[data-testid="lyrics-button"]')!;
  btn.setAttribute('data-active', String(active));
  btn.setAttribute('aria-pressed', String(active));
}

function showWidget(t: TrackDef): void {
  widget.setAttribute('aria-label', t.key);
  widget.querySelector('a[href^="/album/"]')!.textContent = t.title;
  widget.querySelector('[data-testid="now-playing-widget-v2-byline"]')!.innerHTML = `<a href="/artist/0000000000000000000Art">${t.artist}</a>`;
  if (!widget.isConnected) widgetSlot.parent.insertBefore(widget, widgetSlot.next);
}

function showPreviewRows(lines: string[]): void {
  const list = npvCard.querySelector('.FOuUnTRQ4vzmdpbFOSWp')!;
  list.replaceChildren(...lines.map(l => {
    const row = rowEl(l);
    row.className = 'MFEBmMwUCW5Qmg8VwGim D1vLEbYvPMSQij_CFIgh wPtOEa61rezvSPWqMbGw';
    return row;
  }));
}

function openOverlay(): void {
  if (npvCard.isConnected) npvCard.remove(); // the sidebar card unmounts while the overlay is up
  overlaySlot.parent.insertBefore(overlay, overlaySlot.next);
  setLyricsButton(true);
}

// ---------------------------------------------------------------------------
// MAIN-world bridge, at the message level (SLY_TRACK_UPDATE shape of slyBridge.ts)
// ---------------------------------------------------------------------------
interface RowsMeta { trackUri: string; isTimeSynced: boolean; provider: string; language: string }
/** What a lyric line's fiber chain says (the lyrics component's {trackUri, data}). */
const rowsMeta = new WeakMap<Element, RowsMeta>();
const bridge = {
  playing: null as TrackDef | null,
  /** Round-1 build: the Now Playing view preview card fed its isTimeSynced:false to the detector. */
  previewSyncFlag: false,
};

function mountPanelRows(lines: string[], meta: RowsMeta): HTMLElement[] {
  const rows = lines.map(rowEl);
  rows.forEach(r => rowsMeta.set(r, meta));
  panelList().replaceChildren(...rows);
  return rows;
}

/** React re-render of the rows: fresh keyed row nodes in place of the old ones; foreign nodes (our pill) stay. */
function rerenderRows(lines: string[], meta: RowsMeta): HTMLElement[] {
  const list = panelList();
  const old = panelRows();
  const rows = lines.map(rowEl);
  rows.forEach(r => { rowsMeta.set(r, meta); list.insertBefore(r, old[0] ?? null); });
  old.forEach(r => r.remove());
  return rows;
}

function bridgeTick(): void {
  const lines = Array.from(document.querySelectorAll('[data-testid="lyrics-line"]'))
    .filter(el => !el.closest('#lyrics-root-sync') && !el.closest('[data-testid="now-playing-bar"], footer'));
  const isPreview = (el: Element) => !!el.closest('#Desktop_PanelContainer_Id, [data-testid="lyrics-npv-section"]');
  const lineNode = lines.find(el => !isPreview(el)) ?? lines[0];
  const meta = lineNode ? (rowsMeta.get(lineNode) ?? rowsMeta.get(lineNode.closest('[data-testid="lyrics-npv-section"]')!)) : undefined;
  const fullPanel = !!lineNode && !isPreview(lineNode);
  const t = bridge.playing;
  const btn = document.querySelector('[data-testid="lyrics-button"]');
  const payload = {
    type: 'SLY_TRACK_UPDATE',
    track: t ? { type: 'track', uri: t.uri, name: t.title, artists: [{ name: t.artist }], duration: { milliseconds: 354105 } } : null,
    accessToken: undefined,
    lyricsProvider: meta?.provider ?? null,
    isTimeSynced: fullPanel || bridge.previewSyncFlag ? meta?.isTimeSynced : undefined,
    syncType: fullPanel && meta ? 'LINE_SYNCED' : null,
    isDenseTypeface: undefined,
    language: meta?.language ?? null,
    lyricsTrackUri: fullPanel ? meta?.trackUri ?? null : null,
    isPanelActive: btn?.getAttribute('data-active') === 'true',
    nativeHasLyrics: true, // the Genetic Lock makes the button read "has lyrics"
    detectionMethod: 'Fiber Prop (Definitive)',
    lastBridgeChangeTime: Date.now(),
  };
  window.postMessage({ source: 'SLY_ACTION_GATEWAY', action: { type: 'SLY_TRACK_UPDATE', payload } }, '*');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const spotifyNetwork = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes(`/color-lyrics/v2/track/${R.id}`)) return new Response(JSON.stringify(colorLyricsBody(R_WORDS, 'hi', false)), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes(`/color-lyrics/v2/track/${K.id}`)) return new Response(JSON.stringify(colorLyricsBody(K_WORDS, 'ko', true)), { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 404 });
});

let bridgeTimer: ReturnType<typeof setInterval>;

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-07T20:00:00Z'));
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { logLines.push(`[${m}] ${args.map(String).join(' ')}`); });
  }
  for (const m of ['table', 'groupCollapsed', 'group', 'groupEnd'] as const) vi.spyOn(console, m).mockImplementation(() => {});
  sessionStorage.clear();

  // jsdom's postMessage carries no event.source: deliver it as the browser would (async, source = window).
  vi.spyOn(window, 'postMessage').mockImplementation(((message: unknown) => {
    const data = structuredClone(message);
    setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data, source: window as any, origin: 'https://open.spotify.com' })), 0);
  }) as any);

  const b = w.browser;
  b.runtime.id = 'test-id';
  b.runtime.sendMessage = vi.fn((msg: SentMessage) => background(msg));
  b.storage.sync.get = vi.fn(async () => ({ preferredMode: 'romanized', dualLyrics: true, targetLang: 'en', showPill: true }));
  const local: Record<string, unknown> = {};
  b.storage.local.get = vi.fn(async (keys: string | string[] | null) => {
    if (keys === null) return { ...local };
    const list = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.filter(k => k in local).map(k => [k, local[k]]));
  });
  b.storage.local.set = vi.fn(async (obj: Record<string, unknown>) => { Object.assign(local, obj); });
  b.storage.local.remove = vi.fn(async () => {});
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (Element.prototype as any).scrollIntoView = function () {}; // not implemented by jsdom

  buildPage();

  // MAIN world: the fetch interceptor wraps Spotify's fetch.
  w.fetch = spotifyNetwork;
  await import('../../entrypoints/fetchInterceptor');
  // Isolated world: the real content-script entrypoint.
  const def = (await import('../../entrypoints/spotify-lyrics.content/index')).default as any;
  await def.main();
  await advance(50);
  bridgeTimer = setInterval(bridgeTick, 500);
});

afterAll(async () => {
  clearInterval(bridgeTimer);
  // Invalidate the extension context and poke the DOM while it still exists, so every
  // observer that checks the context disconnects before jsdom is torn down.
  w.browser.runtime.id = undefined;
  document.body.appendChild(document.createElement('div')).remove();
  await flush();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Counts how often our spans are (re)written into each row: one per row per applyLinesToDOM. */
function watchRewrites(list: Element) {
  const perInner = new Map<Element, number>();
  const mo = new MutationObserver(records => {
    for (const r of records) {
      for (const n of Array.from(r.addedNodes)) {
        if (n instanceof Element && n.classList.contains('sly-main-line')) {
          perInner.set(r.target as Element, (perInner.get(r.target as Element) ?? 0) + 1);
        }
      }
    }
  });
  mo.observe(list, { childList: true, subtree: true });
  return {
    of: (inner: Element) => perInner.get(inner) ?? 0,
    max: () => Math.max(0, ...perInner.values()),
    clear: () => perInner.clear(),
    stop: () => mo.disconnect(),
  };
}

const registry = (t: TrackDef) => w.slyPreFetchRegistry.getState(t.uri);
const processedLinesSent = () => sentOf('PROCESS').map(m => JSON.stringify(m.lines));

// One timeline, as in the live log: the steps share the page, the modules and the clock,
// and must run in order.
describe('live round 1 replay through both pipelines (R → N → K)', { shuffle: false, sequential: true }, () => {
  // ---------------------------------------------------------------- 1) R
  it('1a) R with the overlay closed: ROMANIZED from the interceptor, late Layer-1 failure, no UNSYNCED from the preview card', async () => {
    // Spotify mounts the now-playing widget for R; the bridge names R a tick later.
    showWidget(R);
    await advance(0);
    bridge.playing = R;
    // The round-1 bridge fed the preview card's isTimeSynced:false to the detector (the
    // fixed bridge posts undefined there): the detector must refuse it on its own.
    bridge.previewSyncFlag = true;
    await advance(600);

    // The preview card requests R's lyrics: the interceptor holds them 4 s, then releases them.
    const response = window.fetch(colorLyricsUrl(R.id));
    await advance(4100);
    await response;
    showPreviewRows(R_PREVIEW);
    rowsMeta.set(npvCard.querySelector('[data-testid="lyrics-npv-section"]')!, { trackUri: R.uri, isTimeSynced: false, provider: 'MusixMatch', language: 'hi' });
    expect(registry(R)?.nativeStatus).toBe('ROMANIZED');
    expect(w.slyInternalState.forceFallback).toBeFalsy();

    await advance(3500); // the Musixmatch lookup fails ~7 s after it started: SLY_FORCE_FALLBACK

    expect(registry(R)?.nativeStatus).toBe('ROMANIZED');
    expect(registry(R)?.nativeReason).toBe('Network Intercept');
    expect(registry(R)?.state).toBe('ROMANIZED');
    expect(reportsFor(R)).toHaveLength(0); // no UNSYNCED (nor anything else) persisted for R
    expect(w.slyInternalState.forceFallback).toBe(true);
    expect(fetchLyricsFor(R)).toHaveLength(0); // overlay closed: nothing fetched yet
    expect(sentOf('SLY_NATIVE_FETCH')).toHaveLength(1);
    expect(npvCard.querySelector('[data-sly-original], .sly-main-line')).toBeNull();
  });

  it('1b) R overlay opens: one fallback fetch, takeover with the native-script lines, Romanized processes them', async () => {
    fetchLyricsAnswer.set(R.uri, () => delayed(300, {
      ok: true,
      data: { isSynced: true, syncedLyrics: R_LRC, plainLyrics: R_TAKEOVER.join('\n'), source: 'Source: Musixmatch', extractedColor: 'rgb(48, 16, 16)' },
      prefetchState: 'SYNCED',
      nativeStatus: 'ROMANIZED',
    }));
    bridge.previewSyncFlag = false;
    mountPanelRows(R_ROWS, { trackUri: R.uri, isTimeSynced: true, provider: 'MusixMatch', language: 'hi' });
    openOverlay();
    await advance(3000);

    const fetches = fetchLyricsFor(R);
    expect(fetches).toHaveLength(1);
    expect(fetches[0].payload.nativeStatus).toBe('ROMANIZED');
    expect(registry(R)?.nativeStatus).toBe('ROMANIZED');
    expect(reportsFor(R)).toHaveLength(0);

    // Takeover live: Spotify's panel hidden, our rows show the romanized native-script lines.
    expect(themedPanel().style.display).toBe('none');
    const lines = takeoverRows().map(r => r.querySelector(':scope > div')!).filter(el => el.textContent);
    expect(lines.map(mainLine)).toEqual(R_LOCAL_ROMAN.map(l => l.charAt(0).toUpperCase() + l.slice(1)));
    expect(lines.slice(1).map(dualLine)).toEqual(R_NATIVE);
    expect(processedLinesSent()).toEqual([JSON.stringify(R_TAKEOVER)]);
  });

  // ---------------------------------------------------------------- 2) N
  let rRows: HTMLElement[] = [];
  let sentBeforeN = 0;
  let nSwitchAt = 0;
  it('2a) skip to N: R\'s rows still mounted are neither snapshotted nor painted for N, and Pipeline A records nothing for N from them', async () => {
    rRows = panelRows();
    sentBeforeN = sent.length;
    fetchLyricsAnswer.set(N.uri, () => delayed(400, { ok: false, error: 'not found' }));

    // The bridge (entityUri) moves to N before the widget label does: slyCore's TRACK SWITCH
    // releases R's takeover, and Pipeline B's setup runs once more under R's key. It must
    // not paint the takeover's (native-script) lines on R's native rows.
    bridge.playing = N;
    nSwitchAt = Date.now();
    await advance(600);
    expect(document.getElementById('lyrics-root-sync')).toBeNull();
    expect(themedPanel().style.display).toBe('');
    expect(inners().map(el => el.textContent)).toEqual(R_ROWS);
    expect(hasOurMarkup()).toBe(false);

    showWidget(N);
    await advance(200);
    // Spotify prefetches the NEXT track's color-lyrics while N plays.
    await window.fetch(colorLyricsUrl(K.id));
    await advance(700);

    // R's rows are still mounted, clean and untouched.
    expect(panelRows()).toEqual(rRows);
    expect(inners().map(el => el.textContent)).toEqual(R_ROWS);
    expect(hasOurMarkup()).toBe(false);
    expect(sent.slice(sentBeforeN).filter(m => m.type === 'PROCESS' || m.type === 'SLY_SAVE_L0_CACHE')).toHaveLength(0);
    expect(sessionStorage.getItem(`sly_proc:${N.key}`)).toBeNull();
    // Pipeline A: nothing recorded or reported for N; K's prefetch is K's.
    expect(registry(N)).toBeUndefined();
    expect(reportsFor(N)).toHaveLength(0);
    expect(w.slyInternalState.colorLyricsSeenAt.has(N.id)).toBe(false);
    expect(w.slyInternalState.colorLyricsSeenAt.has(K.id)).toBe(true);
    expect(registry(K)).toBeUndefined();
    expect(w.slyInternalState.isSpotifyFetching).toBe(false);
  });

  it('2b) R\'s rows unmount; with the overlay open and no request for N, the no-request verdict makes exactly one fallback fetch', async () => {
    panelList().replaceChildren(); // React drops R's rows; the themed panel stays (no lyrics for N)
    while (fetchLyricsFor(N).length === 0 && Date.now() - nSwitchAt < 12_000) await advance(100);

    const fetches = fetchLyricsFor(N);
    expect(fetches).toHaveLength(1);
    // The verdict needs 4 s on its own clock; the first poll after it comes on the 5 s
    // stand-down cadence set by the stale-row decision (A2.4 only resets it on that poll).
    expect(Date.now() - nSwitchAt).toBeGreaterThan(4000);
    // (+0.5 s: the button turning active again runs a check at once, restarting that cadence.)
    expect(Date.now() - nSwitchAt).toBeLessThanOrEqual(6500);
    expect(fetches[0].payload.nativeStatus).toBeUndefined(); // the guess is never forwarded
    expect(registry(N)?.nativeStatus).toBe('MISSING');
    expect(registry(N)?.heuristic).toBe(true);
    expect(reportsFor(N)).toHaveLength(0);

    await advance(3000); // the background found nothing: no retry, no loop
    expect(fetchLyricsFor(N)).toHaveLength(1);
    expect(fetchLyricsFor(R)).toHaveLength(1);
    expect(reportsFor(N)).toHaveLength(0);
    expect(sent.slice(sentBeforeN).filter(m => m.type === 'PROCESS')).toHaveLength(0);
  });

  // ---------------------------------------------------------------- 3) K
  let kRows: HTMLElement[] = [];
  let processBeforeK = 0;
  it('3a) K\'s rows mount while the widget still says N: nothing from N is painted on them, they are not snapshotted under N', async () => {
    processBeforeK = sentOf('PROCESS').length;
    kRows = mountPanelRows(K_ROWS, { trackUri: K.uri, isTimeSynced: true, provider: 'MusixMatch', language: 'ko' });
    await advance(1200);

    // slyCore releases N's error HUD over them (the bridge reads K's rows as synced), so
    // Pipeline B's setup paths do run on these rows under N's key.
    expect(document.getElementById('lyrics-root-sync')).toBeNull();
    expect(themedPanel().style.display).toBe('');
    expect(panelRows()).toEqual(kRows);
    expect(inners().map(el => el.textContent)).toEqual(K_ROWS);
    expect(hasOurMarkup()).toBe(false); // no snapshot attribute, no painted spans
    expect(sentOf('PROCESS')).toHaveLength(processBeforeK);
    expect(sessionStorage.getItem(`sly_proc:${N.key}`)).toBeNull();
    expect(logged('Snapshot refused: rows belong to another track')).toBe(1); // diagnostic: the reverse-hash guard did it
    // Pipeline A: N keeps its guessed MISSING (K's rows are not N's), nothing reported for N.
    expect(registry(N)?.nativeStatus).toBe('MISSING');
    expect(registry(N)?.heuristic).toBe(true);
    expect(reportsFor(N)).toHaveLength(0);
    expect(fetchLyricsFor(N)).toHaveLength(1);
  });

  let rewrites: ReturnType<typeof watchRewrites>;
  it('3b) the widget switches to K: canonical hash gate passes, Romanized processing applies once', async () => {
    rewrites = watchRewrites(panelList());
    const refusalsBefore = logged('Snapshot refused');
    bridge.playing = K;
    await advance(5); // let a periodic tick posted just before (still naming N) land first
    bridgeTick(); // the bridge already names K when the label changes (Pipeline B sees the switch first)
    await advance(5);
    expect(w.spotifyState.track?.uri).toBe(K.uri);
    showWidget(K);
    await advance(1500);

    const kProcess = sentOf('PROCESS').slice(processBeforeK);
    expect(kProcess).toHaveLength(1);
    expect(kProcess[0].lines).toEqual(K_ROWS);
    // The rows are K's own (their hash is K's canonical hash): accepted and painted once.
    expect(logged('Snapshot refused')).toBe(refusalsBefore);
    expect(panelRows()).toEqual(kRows);
    const lines = inners();
    K_WORDS.forEach((word, i) => {
      const inner = lines[i + 2];
      expect(dualLine(inner)).toBe(word === '♪' ? null : word);
      expect(mainLine(inner)).toBe(K_ROMAN[i] === '♪' ? '♪' : K_ROMAN[i].charAt(0).toUpperCase() + K_ROMAN[i].slice(1));
    });
    expect(rewrites.max()).toBe(1);
    expect(document.getElementById('lyrics-root-sync')).toBeNull();
    expect(themedPanel().style.display).toBe('');
  });

  it('3c) slyCore stands down for K: SYNCED recorded and reported once, no fetch, no re-apply on its NATIVE_OK ticks', async () => {
    await advance(12_000);
    expect(registry(K)?.nativeStatus).toBe('SYNCED');
    expect(reportsFor(K).map(m => m.payload.status)).toEqual(['SYNCED']);
    expect(fetchLyricsFor(K)).toHaveLength(0);
    expect(sentOf('PROCESS').slice(processBeforeK)).toHaveLength(1);
    expect(rewrites.max()).toBe(1);
  });

  // ---------------------------------------------------------------- 4) K re-renders
  it('4a-c) Spotify re-renders K\'s rows: one apply per genuinely new native row, no loop, same lyricsObserver', async () => {
    const observersBefore = logged('createLyricsObserver: observing');
    const list = panelList();

    // (a) Moving processed rows (React re-inserting keyed rows) brings no new row.
    rewrites.clear();
    list.insertBefore(panelRows()[5], panelRows()[4]);
    list.insertBefore(panelRows()[5], panelRows()[4]);
    await advance(600);
    expect(rewrites.max()).toBe(0);

    // (b) One fresh native row in place of a processed one: exactly one apply.
    const sentinel = inners()[3]; // a processed row Spotify keeps
    const fresh = rowEl(K_WORDS[3]);
    rowsMeta.set(fresh, rowsMeta.get(kRows[0])!);
    panelRows()[5].replaceWith(fresh);
    await advance(600);
    const freshInner = fresh.querySelector(':scope > div')!;
    expect(mainLine(freshInner)).toBe('Oneul bam uri hamkke');
    expect(dualLine(freshInner)).toBe(K_WORDS[3]);
    expect(rewrites.of(sentinel)).toBe(1);

    // (c) Five re-renders of every row with fresh nodes: each fresh row written once, then quiet.
    rewrites.clear();
    for (let i = 0; i < 5; i++) {
      rerenderRows(K_ROWS, rowsMeta.get(kRows[0])!);
      await advance(300);
      expect(inners().filter(el => el.textContent).every(el => el.querySelector('.sly-main-line'))).toBe(true);
    }
    expect(rewrites.max()).toBe(1);
    await advance(5000);
    expect(rewrites.max()).toBe(1);

    expect(logged('createLyricsObserver: observing')).toBe(observersBefore); // same container: not rebuilt
    expect(sentOf('PROCESS').slice(processBeforeK)).toHaveLength(1);
    expect(fetchLyricsFor(K)).toHaveLength(0);
  });

  // When Spotify re-mounts the row list element itself, our pill leaves with the old list,
  // so one mutation batch fires both onControlsRemoved (→ trySetup's hot-cache fast path)
  // and onLyricsInjected (→ quickApply). Both skip rows that are already painted, so every
  // fresh row is written once.
  it('4d) Spotify re-mounts the whole row list (new list element; the pill, on the view, stays): the fresh rows are written once', async () => {
    const pillBefore = document.getElementById('sly-lyrics-controls');
    const oldList = panelList();
    const freshList = document.createElement('div');
    freshList.className = oldList.className;
    const rows = K_ROWS.map(rowEl);
    rows.forEach(r => rowsMeta.set(r, rowsMeta.get(kRows[0])!));
    freshList.append(...rows);
    rewrites.stop();
    rewrites = watchRewrites(freshList);
    const observersBefore = logged('createLyricsObserver: observing');
    oldList.replaceWith(freshList);
    nativeList = freshList;
    await advance(600);

    expect(inners().filter(el => el.textContent).every(el => el.querySelector('.sly-main-line'))).toBe(true);
    // The pill's home is the view itself (lyricsControls): the list's re-mount does not touch it.
    expect(document.getElementById('sly-lyrics-controls')).toBe(pillBefore);
    expect(pillBefore?.isConnected).toBe(true);
    expect(logged('createLyricsObserver: observing') - observersBefore).toBe(1); // new container: rebuilt once
    expect(rewrites.max()).toBe(1); // fails: 2
    await advance(5000);
    expect(rewrites.max()).toBe(1);
  });
});
