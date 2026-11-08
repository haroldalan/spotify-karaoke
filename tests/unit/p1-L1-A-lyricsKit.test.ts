/**
 * Live round 2: lyrics the extension shows where Spotify has none must look exactly
 * like Spotify's (the extension renders with Spotify's own classes). Lines take
 * Spotify's typography only inside its lyrics wrapper + list classes, which are learned
 * from a live panel, kept per Spotify build, or read from Spotify's stylesheet.
 * Synthetic DOM and CSS shaped like the 2026-11 web player; class names invented.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getLyricsKitSource, isLyricsKitWorking, loadLyricsKitSnapshot, resetLyricsKit, slyDeepScavengeStyles, slyScavengeClasses,
} from '../../lib/slyCore/scavenger';
import '../../lib/slyCore/styles';
import '../../lib/slyCore/domEngine';
import { slyFindOverlayLyricsSlot, slyRestoreOverlayContent } from '../../lib/slyCore/domEngine';
import { StatusEngine } from '../../lib/slyCore/statusEngine';
import { TakeoverEngine } from '../../lib/slyCore/takeoverEngine';
import { resetLyricsChip, syncLyricsChip } from '../../lib/slyCore/lyricsChip';
import { slyInternalState, spotifyState } from '../../lib/slyCore/state';

const w = window as any;
const CSS_HREF = 'https://open.spotifycdn.com/cdn/build/web-player/web-player.inventedhash.css';
// Rules shaped like Spotify's (seen live 2026-11-07), with invented class names.
const SPOTIFY_CSS = [
  '.InvContainerAaaaaaa{grid-template-rows:1fr;width:100%;height:calc(100vh - 73px);margin-top:0;display:grid}',
  '.InvSlotBbbbbbbbbbbb{flex-shrink:0;height:100%;position:relative}',
  '.InvWrapperCcccccccc{flex-direction:column;align-items:center;width:100%;margin-top:64px;display:flex}',
  '.InvWrapperCcccccccc.InvWrapModDddddddd{padding-block-start:25vh}',
  '.InvWrapperCcccccccc .InvListEeeeeeeeeee{width:min(100% - 128px,1024px);font-size:var(--encore-text-size-larger-2);font-family:var(--encore-title-font-stack);flex-direction:column;margin:0;font-weight:700;display:flex}',
  '.InvLineFffffffffff{color:var(--lyrics-color-inactive)}',
  '.InvContainerAaaaaaa.InvContModGggggggg{height:100vh}',
  '.InvSpacerHhhhhhhhhh{background-color:var(--lyrics-color-background);grid-area:1/1/-1/-1;transition:background-color .25s ease-out}',
  '.InvLineFffffffffff:not(.InvPadIiiiiiiiiiii){margin-bottom:.6em}',
  '.InvFooterJjjjjjjjj{z-index:1;opacity:0;width:100%;margin-top:-40px;padding:0 32px;transition:opacity .2s;display:flex;position:sticky;bottom:32px}',
  '.InvFootAKkkkkkkkkk{margin-inline-end:auto;display:flex}',
  '.InvFootBLlllllllll{margin-inline-start:auto;display:flex}',
].join('');
// What the measurement needs in jsdom: the same typography rule as a real <style>.
const TYPOGRAPHY_STYLE = '.InvWrapperCcccccccc .InvListEeeeeeeeeee{font-size:32px;font-weight:700}';

function addStylesheetLink(href = CSS_HREF): void {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function addTypography(): void {
  const style = document.createElement('style');
  style.id = 'kit-typography';
  style.textContent = TYPOGRAPHY_STYLE;
  document.head.appendChild(style);
}

const icon = '<svg viewBox="0 0 16 16"><path d="M1 1h14v14H1z"></path></svg>';
/** Spotify's expanded Now Playing view for a track without lyrics (artwork in the slot). */
function loadNoLyricsOverlay(): void {
  document.body.innerHTML = `<div id="main"><div data-testid="root"><div class="wrap">
    <div class="overlay">
      <div class="header"><div role="radiogroup">
        <button role="radio" value="artwork" aria-checked="true" class="radio">${icon}</button>
        <button role="radio" value="canvas" aria-checked="false" class="radio">${icon}</button>
        <button role="radio" value="lyrics" aria-checked="false" class="radio" disabled>${icon}</button>
      </div></div>
      <div class="content"><div class="scroll">
        <div class="branch"><div class="m"><div class="j"><div class="InvSlotBbbbbbbbbbbb">
          <div class="bg" style="position:absolute"></div>
          <div class="art"><img alt=""></div>
        </div></div></div></div>
        <div class="cards">About the artist</div>
      </div></div>
    </div>
    <aside data-testid="now-playing-bar"><button data-testid="lyrics-button" data-active="true" aria-pressed="true"></button></aside>
  </div></div></div>`;
}

const fetchCssWith = (cssText: string) => vi.fn((msg: any) => Promise.resolve(msg?.type === 'SLY_FETCH_CSS' ? { success: true, cssText } : undefined));
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

let store: Record<string, any>;
beforeEach(() => {
  resetLyricsKit();
  resetLyricsChip();
  document.head.querySelectorAll('link[rel="stylesheet"], #kit-typography').forEach((n) => n.remove());
  store = {};
  w.browser.storage.local.get = vi.fn(async (k: string) => (k in store ? { [k]: store[k] } : {}));
  w.browser.storage.local.set = vi.fn(async (items: Record<string, any>) => { Object.assign(store, items); });
  for (const m of ['log', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => {});
  w.SPOTIFY_CLASSES.wrapperClasses = undefined;
  w.SPOTIFY_CLASSES.lyricsListClasses = undefined;
  w.SPOTIFY_CLASSES.slotClass = undefined;
  w.SPOTIFY_CLASSES.slotCandidates = undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('learning Spotify\'s lyrics classes from its stylesheet', () => {
  it('reads the wrapper (+modifier), list, container, line and slot classes', async () => {
    addStylesheetLink();
    w.browser.runtime.sendMessage = fetchCssWith(SPOTIFY_CSS);
    slyDeepScavengeStyles();
    await settle();
    expect(w.SPOTIFY_CLASSES.wrapperClasses).toBe('InvWrapperCcccccccc InvWrapModDddddddd');
    expect(w.SPOTIFY_CLASSES.lyricsListClasses).toBe('InvListEeeeeeeeeee');
    expect(w.SPOTIFY_CLASSES.containerClasses).toBe('InvContainerAaaaaaa InvContModGggggggg');
    expect(w.SPOTIFY_CLASSES.lineBase).toBe('InvLineFffffffffff');
    expect(w.SPOTIFY_CLASSES.topSpacer).toBe('InvSpacerHhhhhhhhhh'); // paints Spotify's lyrics background
    expect(w.SPOTIFY_CLASSES.paddingLineHelper).toBe('InvPadIiiiiiiiiiii');
    expect(w.SPOTIFY_CLASSES.footerGrid).toBe('InvFooterJjjjjjjjj');
    expect(w.SPOTIFY_CLASSES.footerInner1).toBe('InvFootAKkkkkkkkkk');
    expect(w.SPOTIFY_CLASSES.footerInner2).toBe('InvFootBLlllllllll');
    expect(w.SPOTIFY_CLASSES.slotCandidates).toEqual(['InvSlotBbbbbbbbbbbb']);
    expect(getLyricsKitSource()).toBe('css');
  });

  it('never overrides names learned from a live panel or restored for this build', async () => {
    store.sly_lyrics_kit = { build: CSS_HREF, classes: { wrapperClasses: 'LiveWrapper LiveMod', lyricsListClasses: 'LiveList' } };
    addStylesheetLink();
    await loadLyricsKitSnapshot();
    expect(getLyricsKitSource()).toBe('snapshot');
    w.browser.runtime.sendMessage = fetchCssWith(SPOTIFY_CSS);
    slyDeepScavengeStyles();
    await settle();
    expect(w.SPOTIFY_CLASSES.wrapperClasses).toBe('LiveWrapper LiveMod');
    expect(w.SPOTIFY_CLASSES.lyricsListClasses).toBe('LiveList');
  });
});

describe('the snapshot of the last live panel', () => {
  it('is saved per Spotify build when a live panel is learned', () => {
    addStylesheetLink();
    document.body.innerHTML = `<div id="main"><div data-testid="root"><div class="InvSlotBbbbbbbbbbbb">
      <div class="InvContainerAaaaaaa Mod2" style="--lyrics-color-active: #fff">
        <div class="Spacer11111111"></div>
        <div class="InvWrapperCcccccccc InvWrapModDddddddd"><div class="InvListEeeeeeeeeee"><div>
          <div data-testid="lyrics-line" class="InvLineFffffffffff Future111111"><div class="Inner1111111">Invented line</div></div>
          <div data-testid="lyrics-line" class="InvLineFffffffffff Future111111 Spacer222222"><div class="Inner1111111"></div></div>
        </div></div></div>
      </div></div></div></div>`;
    slyScavengeClasses();
    expect(getLyricsKitSource()).toBe('live');
    expect(store.sly_lyrics_kit.build).toBe(CSS_HREF);
    expect(store.sly_lyrics_kit.classes.wrapperClasses).toBe('InvWrapperCcccccccc InvWrapModDddddddd');
    expect(store.sly_lyrics_kit.classes.slotClass).toBe('InvSlotBbbbbbbbbbbb');
  });

  it('an unsynced panel (lines directly in the list) gives the same wrapper and list as a synced one', () => {
    addStylesheetLink();
    document.body.innerHTML = `<div id="main"><div data-testid="root"><div class="InvSlotBbbbbbbbbbbb">
      <div class="InvContainerAaaaaaa Mod2" style="--lyrics-color-active: #fff">
        <div class="Spacer11111111"></div>
        <div class="InvWrapperCcccccccc InvWrapModDddddddd"><div class="InvListEeeeeeeeeee">
          <div data-testid="lyrics-line" class="InvLineFffffffffff Unsynced1111"><div class="Inner1111111">Invented line</div></div>
          <div data-testid="lyrics-line" class="InvLineFffffffffff Unsynced1111"><div class="Inner1111111">Invented line two</div></div>
        </div></div>
      </div></div></div></div>`;
    slyScavengeClasses();
    expect(w.SPOTIFY_CLASSES.wrapperClasses).toBe('InvWrapperCcccccccc InvWrapModDddddddd');
    expect(w.SPOTIFY_CLASSES.lyricsListClasses).toBe('InvListEeeeeeeeeee');
  });

  it('names from a panel that do not give Spotify\'s typography never replace ones that do', () => {
    addStylesheetLink();
    addTypography(); // the typography rule of the known names (InvWrapper… InvList…)
    w.SPOTIFY_CLASSES.wrapperClasses = 'InvWrapperCcccccccc InvWrapModDddddddd';
    w.SPOTIFY_CLASSES.lyricsListClasses = 'InvListEeeeeeeeeee';
    document.body.innerHTML = `<div id="main"><div data-testid="root"><div class="InvSlotBbbbbbbbbbbb">
      <div class="InvContainerAaaaaaa Mod2" style="--lyrics-color-active: #fff">
        <div class="Spacer11111111"></div>
        <div class="OtherWrapperZzzzzzzz"><div class="OtherListYyyyyyyyyy">
          <div data-testid="lyrics-line" class="InvLineFffffffffff"><div class="Inner1111111">Invented line</div></div>
        </div></div>
      </div></div></div></div>`;
    slyScavengeClasses();
    expect(w.SPOTIFY_CLASSES.wrapperClasses).toBe('InvWrapperCcccccccc InvWrapModDddddddd');
    expect(w.SPOTIFY_CLASSES.lyricsListClasses).toBe('InvListEeeeeeeeeee');
    expect(store.sly_lyrics_kit).toBeUndefined(); // nothing saved from that panel
  });

  it('is ignored after a Spotify update (another stylesheet build)', async () => {
    store.sly_lyrics_kit = { build: 'https://open.spotifycdn.com/cdn/build/web-player/web-player.oldhash.css', classes: { wrapperClasses: 'Old' } };
    addStylesheetLink();
    await loadLyricsKitSnapshot();
    expect(getLyricsKitSource()).toBe('default');
    expect(w.SPOTIFY_CLASSES.wrapperClasses).not.toBe('Old');
  });
});

describe('the measurement', () => {
  it('passes only when the names really give lines Spotify\'s typography', () => {
    w.SPOTIFY_CLASSES.wrapperClasses = 'InvWrapperCcccccccc InvWrapModDddddddd';
    w.SPOTIFY_CLASSES.lyricsListClasses = 'InvListEeeeeeeeeee';
    w.SPOTIFY_CLASSES.lineBase = 'InvLineFffffffffff';
    expect(isLyricsKitWorking()).toBe(false); // stylesheet not there
    resetLyricsKit();
    addTypography();
    expect(isLyricsKitWorking()).toBe(true);
  });
});

describe('fetched lyrics in Spotify\'s own slot (track without Spotify lyrics)', () => {
  function kitReady(): void {
    w.SPOTIFY_CLASSES.wrapperClasses = 'InvWrapperCcccccccc InvWrapModDddddddd';
    w.SPOTIFY_CLASSES.lyricsListClasses = 'InvListEeeeeeeeeee';
    w.SPOTIFY_CLASSES.lineBase = 'InvLineFffffffffff';
    w.SPOTIFY_CLASSES.containerClasses = 'InvContainerAaaaaaa';
    w.SPOTIFY_CLASSES.slotCandidates = ['InvSlotBbbbbbbbbbbb'];
    addTypography();
  }

  it('takes the lyrics panel\'s place before the artwork; artwork and cards are hidden by CSS only', () => {
    kitReady();
    loadNoLyricsOverlay();
    const slot = slyFindOverlayLyricsSlot()!;
    expect(slot.className).toBe('InvSlotBbbbbbbbbbbb');
    const root = w.slyPrepareContainer({ forLyrics: true });
    expect(root.parentElement).toBe(slot);
    expect(root.nextElementSibling).toBe(document.querySelector('.art'));
    expect(root.className).toContain('InvContainerAaaaaaa'); // Spotify's container
    expect(root.classList.contains('sly-root-overlay')).toBe(false);
    expect(document.querySelector('.art')!.getAttribute('data-sly-hide')).toBe('content');
    expect(document.querySelector('.cards')!.getAttribute('data-sly-hide')).toBe('collapse');
    expect(document.querySelector('.overlay')!.classList.contains('sly-lyrics-on')).toBe(true);
  });

  it('a status notice afterwards, or a purge, gives Spotify\'s content back', () => {
    kitReady();
    loadNoLyricsOverlay();
    w.slyPrepareContainer({ forLyrics: true });
    StatusEngine.show('Fetching [Title]', 'Searching...', false, {});
    expect(document.querySelector('[data-sly-hide]')).toBeNull();
    expect(document.querySelector('.sly-lyrics-on')).toBeNull();
    w.slyPrepareContainer({ forLyrics: true });
    expect(document.querySelector('[data-sly-hide]')).not.toBeNull();
    TakeoverEngine.purge();
    expect(document.getElementById('lyrics-root-sync')).toBeNull();
    expect(document.querySelector('[data-sly-hide]')).toBeNull();
    expect(document.querySelector('.sly-lyrics-on')).toBeNull();
  });

  it('picking Artwork steps aside and gives the artwork and cards back; our Lyrics button returns to them', () => {
    kitReady();
    loadNoLyricsOverlay();
    const root = w.slyPrepareContainer({ forLyrics: true });
    root.innerHTML = '<div data-testid="lyrics-line">Invented line</div>';
    syncLyricsChip();
    const overlay = document.querySelector('.overlay')!;
    document.querySelector<HTMLButtonElement>('button[role="radio"][value="artwork"]')!.click();
    expect(overlay.classList.contains('sly-lyrics-on')).toBe(false);
    expect(root.classList.contains('sly-stepped-aside')).toBe(true);
    document.getElementById('sly-lyrics-chip')!.click();
    expect(overlay.classList.contains('sly-lyrics-on')).toBe(true);
    expect(root.classList.contains('sly-stepped-aside')).toBe(false);
  });

  it('without Spotify\'s lyrics classes nothing is rendered in another look', () => {
    loadNoLyricsOverlay(); // no typography rule: the measurement fails
    expect(w.slyPrepareContainer({ forLyrics: true })).toBeNull();
    expect(slyInternalState.lastPrepareRefusal).toBe('lyrics-style-unknown');
    expect(document.getElementById('lyrics-root-sync')).toBeNull();
    slyRestoreOverlayContent();
  });

  it('without Spotify\'s slot (unknown layout) lyrics are refused, never shown as a layer in another look', () => {
    kitReady();
    w.SPOTIFY_CLASSES.slotCandidates = ['SomethingElse1234'];
    loadNoLyricsOverlay();
    expect(w.slyPrepareContainer({ forLyrics: true })).toBeNull();
    // The style is known; the place for the lyrics is not (its own notice wording).
    expect(slyInternalState.lastPrepareRefusal).toBe('lyrics-slot-unknown');
    expect(document.querySelector('[data-sly-hide]')).toBeNull();
  });

  it('the Artist image view (background, spacer, positioned image): lyrics before the spacer, image hidden', () => {
    kitReady();
    loadNoLyricsOverlay();
    const slot = document.querySelector('.InvSlotBbbbbbbbbbbb') as HTMLElement;
    slot.innerHTML = '<div class="bg" style="position:absolute"></div><div class="spacer"></div><div class="hero" style="position:absolute"><img alt=""></div>';
    const root = w.slyPrepareContainer({ forLyrics: true }) as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.parentElement).toBe(slot);
    expect(root.nextElementSibling?.className).toBe('spacer');
    expect(slot.querySelector('.hero')!.getAttribute('data-sly-hide')).toBe('content');
    expect(slot.querySelector('.spacer')!.hasAttribute('data-sly-hide')).toBe(false);
    slyRestoreOverlayContent();
    expect(document.querySelector('[data-sly-hide]')).toBeNull();
  });

  it('the Canvas view (a positioned video): lyrics in the slot, video hidden', () => {
    kitReady();
    loadNoLyricsOverlay();
    const slot = document.querySelector('.InvSlotBbbbbbbbbbbb') as HTMLElement;
    slot.innerHTML = '<div class="bg" style="position:absolute"></div><div class="canvas" style="position:absolute"><video></video></div>';
    const root = w.slyPrepareContainer({ forLyrics: true }) as HTMLElement;
    expect(root?.parentElement).toBe(slot);
    expect(slot.querySelector('.canvas')!.getAttribute('data-sly-hide')).toBe('content');
    slyRestoreOverlayContent();
  });

  it('a slot candidate that is not the artwork slot is never filled', () => {
    kitReady();
    loadNoLyricsOverlay();
    document.querySelector('.art img')!.remove(); // no artwork image: not Spotify's slot
    expect(slyFindOverlayLyricsSlot()).toBeNull();
    expect(w.slyPrepareContainer({ forLyrics: true })).toBeNull();
  });

  it('a track WITH Spotify lyrics (option enabled) whose panel is still mounting: no slot, no notice, Spotify content untouched', () => {
    kitReady();
    loadNoLyricsOverlay();
    document.querySelector<HTMLButtonElement>('button[role="radio"][value="lyrics"]')!.disabled = false;
    expect(w.slyPrepareContainer({ forLyrics: true })).toBeNull();
    expect(slyInternalState.lastPrepareRefusal).toBe('spotify-panel-pending');
    expect(document.querySelector('[data-sly-hide]')).toBeNull();
  });

  it('Spotify swapping the slot\'s media (Canvas) while stepped aside: our Lyrics button hides the new node too', () => {
    kitReady();
    loadNoLyricsOverlay();
    const root = w.slyPrepareContainer({ forLyrics: true });
    root.innerHTML = '<div data-testid="lyrics-line">Invented line</div>';
    syncLyricsChip();
    document.querySelector<HTMLButtonElement>('button[role="radio"][value="canvas"]')!.click();
    const slot = slyFindOverlayLyricsSlot()!;
    slot.querySelector('.art')!.remove();
    slot.insertAdjacentHTML('beforeend', '<div class="canvas"><img alt=""></div>'); // React's canvas node
    document.getElementById('sly-lyrics-chip')!.click();
    expect(document.querySelector('.canvas')!.getAttribute('data-sly-hide')).toBe('content');
    expect(document.querySelector('.overlay')!.classList.contains('sly-lyrics-on')).toBe(true);
  });

  it('choosing Spotify\'s own Lyrics option clears an earlier step-aside', () => {
    kitReady();
    loadNoLyricsOverlay();
    const root = w.slyPrepareContainer({ forLyrics: true });
    root.innerHTML = '<div data-testid="lyrics-line">Invented line</div>';
    syncLyricsChip();
    document.querySelector<HTMLButtonElement>('button[role="radio"][value="artwork"]')!.click();
    expect(root.classList.contains('sly-stepped-aside')).toBe(true);
    const option = document.querySelector<HTMLButtonElement>('button[role="radio"][value="lyrics"]')!;
    option.disabled = false;
    option.click();
    option.disabled = true; // next track without lyrics
    syncLyricsChip();
    expect(root.classList.contains('sly-stepped-aside')).toBe(false);
  });

  it('the app grid is never taken for the overlay (a future extra wrapper level)', () => {
    kitReady();
    loadNoLyricsOverlay();
    // Move the player bar into the "overlay" to simulate the grid matching the selector.
    document.querySelector('.overlay')!.appendChild(document.querySelector('[data-testid="now-playing-bar"]')!);
    expect(slyFindOverlayLyricsSlot()).toBeNull();
    expect(w.slyGetLayoutHost()).toBeNull();
  });
});

describe('mid-slide between two songs (live 2026-11-08: two slots, refused once, never shown)', () => {
  const IMG = (id: string, size = '0000aa54') => `https://i.scdn.co/image/ab67616d${size}${id}`;
  const OLD_ART = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const NEW_ART = 'bbbbbbbbbbbbbbbbbbbbbbbb';

  function kitReady(): void {
    w.SPOTIFY_CLASSES.wrapperClasses = 'InvWrapperCcccccccc InvWrapModDddddddd';
    w.SPOTIFY_CLASSES.lyricsListClasses = 'InvListEeeeeeeeeee';
    w.SPOTIFY_CLASSES.lineBase = 'InvLineFffffffffff';
    w.SPOTIFY_CLASSES.containerClasses = 'InvContainerAaaaaaa';
    w.SPOTIFY_CLASSES.slotCandidates = ['InvSlotBbbbbbbbbbbb'];
    addTypography();
  }
  /** The overlay with the leaving song's slide and the next one, each with its slot and artwork. */
  function twoSlides(oldArt: string, newArt: string, coverArt: string | null): { oldSlot: HTMLElement; newSlot: HTMLElement } {
    loadNoLyricsOverlay();
    const scroll = document.querySelector('.scroll')!;
    scroll.innerHTML = `<div class="slides">
      <div class="slide old" style="transform: translateX(-40%)"><div class="InvSlotBbbbbbbbbbbb"><div class="art"><img src="${IMG(oldArt)}" alt=""></div></div></div>
      <div class="slide new" style="transform: translateX(60%)"><div class="InvSlotBbbbbbbbbbbb"><div class="art"><img src="${IMG(newArt)}" alt=""></div></div></div>
    </div><div class="cards">About the artist</div>`;
    if (coverArt) {
      document.querySelector('[data-testid="now-playing-bar"]')!.insertAdjacentHTML('afterbegin',
        `<div data-testid="cover-art-image-wrap"><img data-testid="cover-art-image" src="${IMG(coverArt, '0000e1a3')}" alt=""></div>`);
    }
    return { oldSlot: document.querySelector('.old .InvSlotBbbbbbbbbbbb')!, newSlot: document.querySelector('.new .InvSlotBbbbbbbbbbbb')! };
  }

  it('the slot showing the player bar\'s artwork is the playing song\'s (size codes differ)', () => {
    kitReady();
    const { newSlot } = twoSlides(OLD_ART, NEW_ART, NEW_ART);
    expect(slyFindOverlayLyricsSlot()).toBe(newSlot);
    const root = w.slyPrepareContainer({ forLyrics: true });
    expect(root?.parentElement).toBe(newSlot);
  });

  it('mid-slide with the playing song\'s slide first: the cards are collapsed, never the other song\'s slide (live)', () => {
    kitReady();
    loadNoLyricsOverlay();
    document.querySelector('.scroll')!.innerHTML = `<div class="branch"><div class="slides">
      <div class="slide new" style="transform: translateX(0%)"><div class="j"><div class="InvSlotBbbbbbbbbbbb"><div class="art"><img src="${IMG(NEW_ART)}" alt=""></div></div></div></div>
      <div class="slide old" style="transform: translateX(-100%)"><div class="j"><div class="InvSlotBbbbbbbbbbbb"><div class="art"><img src="${IMG(OLD_ART)}" alt=""></div></div></div></div>
    </div></div><div class="cards">About the artist</div>`;
    document.querySelector('[data-testid="now-playing-bar"]')!.insertAdjacentHTML('afterbegin',
      `<img data-testid="cover-art-image" src="${IMG(NEW_ART, '0000e1a3')}" alt="">`);
    const root = w.slyPrepareContainer({ forLyrics: true });
    expect(root?.parentElement).toBe(document.querySelector('.new .InvSlotBbbbbbbbbbbb'));
    expect(document.querySelector('.cards')!.getAttribute('data-sly-hide')).toBe('collapse');
    expect(document.querySelector('.slide.old')!.hasAttribute('data-sly-hide')).toBe(false);
    slyRestoreOverlayContent();
  });

  it('a slot on the leaving slide is never the one', () => {
    kitReady();
    const { newSlot } = twoSlides(OLD_ART, OLD_ART, null);
    document.querySelector('.old')!.setAttribute('data-sly-leaving', 'spotify');
    expect(slyFindOverlayLyricsSlot()).toBe(newSlot);
  });

  it('nothing tells them apart (one album): refused as busy, not as an unknown layout, no status', () => {
    kitReady();
    twoSlides(OLD_ART, OLD_ART, OLD_ART);
    expect(w.slyPrepareContainer({ forLyrics: true })).toBeNull();
    expect(slyInternalState.lastPrepareRefusal).toBe('lyrics-slot-busy');
    expect(document.querySelector('[data-sly-hide]')).toBeNull();
  });

  it('after a busy refusal the takeover runs again once the slide is over, for the same song only', async () => {
    vi.useFakeTimers();
    try {
      kitReady();
      twoSlides(OLD_ART, OLD_ART, OLD_ART);
      const uri = 'spotify:track:0000000000000000000New';
      const prevTrack = spotifyState.track;
      spotifyState.track = { uri, name: 'New Invented Song' } as any;
      const run = vi.spyOn(TakeoverEngine, 'executeTakeover').mockResolvedValue(undefined as any);
      TakeoverEngine._retryWhenSlotSettles({ _slyUri: uri }, {}, () => {}, true);
      vi.advanceTimersByTime(300);
      expect(run).not.toHaveBeenCalled(); // still two slots
      document.querySelector('.old')!.remove(); // Spotify unmounts the leaving slide
      vi.advanceTimersByTime(150);
      expect(run).toHaveBeenCalledTimes(1);

      // Another song by then: no retry.
      run.mockClear();
      twoSlides(OLD_ART, OLD_ART, OLD_ART);
      TakeoverEngine._retryWhenSlotSettles({ _slyUri: 'spotify:track:0000000000000000000Old' }, {}, () => {}, true);
      document.querySelector('.old')!.remove();
      vi.advanceTimersByTime(500);
      expect(run).not.toHaveBeenCalled();
      run.mockRestore();
      spotifyState.track = prevTrack;
    } finally {
      vi.useRealTimers();
    }
  });
});
