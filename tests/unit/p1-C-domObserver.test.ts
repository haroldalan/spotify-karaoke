import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDomObserver, type SlyDomObserver } from '../../lib/dom/domObserver';

const FIXTURE = readFileSync(resolve(__dirname, '../fixtures/spotify-2026-lyrics-panel.html'), 'utf-8');

function loadFixture(): void {
  const parsed = new DOMParser().parseFromString(FIXTURE, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

const flush = () => new Promise(r => setTimeout(r, 0));

function addLine(list: Element, text: string): void {
  const row = document.createElement('div');
  row.setAttribute('data-testid', 'lyrics-line');
  const inner = document.createElement('div');
  inner.textContent = text;
  row.appendChild(inner);
  list.appendChild(row);
}

describe('p1-C domObserver viewport binding (2026 UI)', () => {
  let observer: SlyDomObserver | null = null;
  let onLyricsInjected: ReturnType<typeof vi.fn<() => void>>;
  let consoleLog: ReturnType<typeof vi.spyOn>;

  const overlayList = () =>
    document.querySelector('div[style*="--lyrics-color-active"].bm5I7yGVN8NXt6vH9eiC [data-testid="lyrics-line"]')!.parentElement!;
  const previewList = () =>
    document.querySelector('[data-testid="lyrics-npv-section"] [data-testid="lyrics-line"]')!.parentElement!;

  beforeEach(() => {
    (window as any).browser.runtime.id = 'test-id';
    loadFixture();
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    onLyricsInjected = vi.fn<() => void>();
    observer = createDomObserver({
      onSongChange: vi.fn(),
      onLyricsInjected,
      onControlsRemoved: vi.fn(),
      onInvalidate: vi.fn(),
    });
  });

  afterEach(() => {
    observer?.disconnect();
    observer = null;
    consoleLog.mockRestore();
    document.body.innerHTML = '';
  });

  it('binds to div#main and sees overlay line mounts', async () => {
    // Existing panel lines fire once at bind time.
    expect(onLyricsInjected).toHaveBeenCalledTimes(1);
    onLyricsInjected.mockClear();

    addLine(overlayList(), 'New overlay line');
    await flush();
    expect(onLyricsInjected).toHaveBeenCalledTimes(1);
  });

  it('ignores Now Playing view preview line mounts', async () => {
    onLyricsInjected.mockClear();
    addLine(previewList(), 'New preview line');
    await flush();
    expect(onLyricsInjected).not.toHaveBeenCalled();
  });

  it('does not re-bind to the playlist <main> after a body child mutation', async () => {
    onLyricsInjected.mockClear();
    // e.g. the parked pill, a toast or a Spotify portal appended to <body>.
    document.body.appendChild(document.createElement('div'));
    await flush();
    expect(consoleLog.mock.calls.some((c: unknown[]) => String(c[0]).includes('Re-binding viewport observer'))).toBe(false);

    addLine(overlayList(), 'Still observed');
    await flush();
    expect(onLyricsInjected).toHaveBeenCalledTimes(1);
  });

  it('stays disconnected after disconnectViewport, and reconnects on connectViewport', async () => {
    observer!.disconnectViewport();
    onLyricsInjected.mockClear();

    document.body.appendChild(document.createElement('div'));
    await flush();
    addLine(overlayList(), 'Panel closed');
    await flush();
    expect(onLyricsInjected).not.toHaveBeenCalled();

    observer!.connectViewport();
    expect(onLyricsInjected).toHaveBeenCalledTimes(1); // existing lines on (re)bind
    addLine(overlayList(), 'Panel reopened');
    await flush();
    expect(onLyricsInjected).toHaveBeenCalledTimes(2);
  });
});
