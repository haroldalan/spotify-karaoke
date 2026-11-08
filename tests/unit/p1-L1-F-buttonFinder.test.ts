import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const overlayHtml = `<div id="main"><div data-testid="root"><div><div class="overlay">
  <div role="radiogroup"><button role="radio" value="lyrics" aria-checked="true"></button></div>
</div></div></div></div>`;

let closes = 0;
const onClose = () => { closes++; };
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const closeButton = () => {
  const b = document.querySelector('[data-testid="lyrics-button"]')!;
  b.setAttribute('data-active', 'false');
  b.setAttribute('aria-pressed', 'false');
};

beforeEach(() => { closes = 0; document.addEventListener('sly:panel_close', onClose); });
afterEach(() => { document.removeEventListener('sly:panel_close', onClose); });

// Live 2026-11-07: the script starts before the now-playing bar exists, and Spotify
// replaces the lyrics button right after each close. The finder used to watch only the
// body's own children then, so it never saw the new button: reopen and the next close
// went unnoticed until the poll (our lyrics came 0.2–0.4 s after the view).
describe('lyrics button finder (script started before the bar existed)', () => {
  const nestedBar = (active: boolean) =>
    `<div class="Root"><div class="wrap"><aside data-testid="now-playing-bar"><div><div>
      <button data-testid="lyrics-button" data-active="${active}" aria-pressed="${active}"></button>
    </div></div></aside></div></div>`;

  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = '<div id="loading"></div>';
    await import('../../lib/slyCore/events');
  });

  it('follows a button that appears and is replaced deep inside the bar', async () => {
    document.body.innerHTML = overlayHtml + nestedBar(true);
    await settle();
    // Spotify swaps the button for a new node after the view closes; the new one is watched.
    const holder = document.querySelector('[data-testid="lyrics-button"]')!.parentElement!;
    holder.innerHTML = '<button data-testid="lyrics-button" data-active="true" aria-pressed="true"></button>';
    await settle();
    closeButton();
    document.querySelector('.overlay')!.remove();
    await settle();
    expect(closes).toBe(1);
  });

  it('reopen: the check runs once the expanded view\'s panel mounts, not for the sidebar preview', async () => {
    const kick = vi.fn();
    (window as any).slyKickPoll = kick;
    // Closed: no expanded view; the Now Playing sidebar shows its lyrics preview card.
    document.body.innerHTML = `<div data-testid="root"><div id="Desktop_PanelContainer_Id"><div style="--lyrics-color-active: #fff">preview</div></div></div>` + nestedBar(false);
    await settle();
    const b = document.querySelector('[data-testid="lyrics-button"]')!;
    b.setAttribute('data-active', 'true');
    b.setAttribute('aria-pressed', 'true');
    await settle();
    expect(kick).not.toHaveBeenCalled();
    // Spotify mounts the expanded view with its lyrics panel.
    const root = document.querySelector('[data-testid="root"]')!;
    root.insertAdjacentHTML('beforeend', `<div><div class="overlay">
      <div role="radiogroup"><button role="radio" value="lyrics" aria-checked="true"></button></div>
      <div style="--lyrics-color-active: #fff">panel</div></div></div>`);
    await settle();
    expect(kick).toHaveBeenCalledTimes(1);
    delete (window as any).slyKickPoll;
  });
  it('reopen on a new button node (born active, no attribute change): the check still runs', async () => {
    const kick = vi.fn();
    (window as any).slyKickPoll = kick;
    document.body.innerHTML = overlayHtml + nestedBar(true);
    await settle();
    // Close: Spotify flips the button, removes the view, then swaps in an inactive button.
    closeButton();
    document.querySelector('.overlay')!.parentElement!.remove();
    await settle();
    expect(closes).toBe(1);
    const holder = () => document.querySelector('[data-testid="lyrics-button"]')!.parentElement!;
    holder().innerHTML = '<button data-testid="lyrics-button" data-active="false" aria-pressed="false"></button>';
    await settle();
    expect(kick).not.toHaveBeenCalled();
    // Open: a new button that is active from the start, then the view with its panel.
    holder().innerHTML = '<button data-testid="lyrics-button" data-active="true" aria-pressed="true"></button>';
    await settle();
    document.querySelector('[data-testid="root"]')!.insertAdjacentHTML('beforeend', `<div><div class="overlay">
      <div role="radiogroup"><button role="radio" value="lyrics" aria-checked="true"></button></div>
      <div style="--lyrics-color-active: #fff">panel</div></div></div>`);
    await settle();
    expect(kick).toHaveBeenCalledTimes(1);
    expect(closes).toBe(1);
    delete (window as any).slyKickPoll;
  });
});
