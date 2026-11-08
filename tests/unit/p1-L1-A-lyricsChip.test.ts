/**
 * Live round 2 UX: our lyrics inside Spotify's expanded Now Playing view follow its
 * media switch. Synthetic DOM shaped like the 2026-11 overlay (labels invented).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LYRICS_CHIP_ID, resetLyricsChip, syncLyricsChip } from '../../lib/slyCore/lyricsChip';

const icon = '<svg viewBox="0 0 16 16"><path d="M1 1h14v14H1z"></path></svg>';

function loadOverlay({ lyricsDisabled = true, rootKind = 'lyrics' as 'lyrics' | 'notice' | 'none' } = {}): void {
  const rootClass = rootKind === 'notice' ? 'sly-root-overlay sly-root-notice' : 'sly-root-overlay';
  document.body.innerHTML = `<div id="main"><div data-testid="root"><div class="wrap">
    <div class="overlay">
      <div class="header"><div role="radiogroup" class="switch">
        <button role="radio" value="artwork" aria-checked="true" class="radio selmark">${icon}</button>
        <button role="radio" value="canvas" aria-checked="false" class="radio">${icon}</button>
        <button role="radio" value="hero" aria-checked="false" class="radio">${icon}</button>
        <button role="radio" value="lyrics" aria-checked="false" class="radio"${lyricsDisabled ? ' disabled' : ''}>${icon}</button>
      </div></div>
      ${rootKind === 'none' ? '' : `<div id="lyrics-root-sync" class="${rootClass}"><div data-testid="lyrics-line">Invented line</div></div>`}
    </div></div></div></div>`;
}

const chip = () => document.getElementById(LYRICS_CHIP_ID) as HTMLButtonElement | null;
const root = () => document.getElementById('lyrics-root-sync')!;
const radio = (value: string) => document.querySelector<HTMLButtonElement>(`button[role="radio"][value="${value}"]`)!;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { resetLyricsChip(); vi.useRealTimers(); document.body.innerHTML = ''; });

describe('our Lyrics button in Spotify\'s media switch', () => {
  it('shows one selected option, with Spotify\'s own selection mark, and gives it back', () => {
    loadOverlay();
    syncLyricsChip();
    expect(chip()!.classList.contains('selmark')).toBe(true); // learned: checked minus unchecked
    expect(radio('artwork').classList.contains('selmark')).toBe(false);
    radio('canvas').click(); // step aside: Spotify's own choice
    expect(chip()!.classList.contains('selmark')).toBe(false);
    expect(radio('artwork').getAttribute('data-sly-deselected')).toBeNull();
  });

  it('stands in for Spotify\'s disabled Lyrics option while our lyrics are showing', () => {
    loadOverlay();
    syncLyricsChip();
    expect(chip()).not.toBeNull();
    expect(chip()!.previousElementSibling).toBe(radio('lyrics')); // the CSS hides the disabled original next to it
    expect(chip()!.className).toContain('radio'); // Spotify's own look
    expect(chip()!.querySelector('svg')).not.toBeNull();
    expect(chip()!.getAttribute('aria-pressed')).toBe('true');
    expect(root().classList.contains('sly-stepped-aside')).toBe(false);
  });

  it('another media option steps our lyrics aside; our button brings them back', () => {
    loadOverlay();
    syncLyricsChip();
    radio('canvas').click();
    expect(root().classList.contains('sly-stepped-aside')).toBe(true);
    expect(chip()!.getAttribute('aria-pressed')).toBe('false');
    chip()!.click();
    expect(root().classList.contains('sly-stepped-aside')).toBe(false);
    expect(chip()!.getAttribute('aria-pressed')).toBe('true');
  });

  it('the choice survives re-renders (ticks) until the overlay closes', async () => {
    loadOverlay();
    syncLyricsChip();
    radio('artwork').click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(root().classList.contains('sly-stepped-aside')).toBe(true);
    document.querySelector('.overlay')!.remove(); // overlay closed
    await vi.advanceTimersByTimeAsync(600);
    expect(chip()).toBeNull();
    loadOverlay();
    syncLyricsChip();
    expect(root().classList.contains('sly-stepped-aside')).toBe(false); // a new overlay starts on our lyrics
  });

  it('no button while only a status notice is showing', () => {
    loadOverlay({ rootKind: 'notice' });
    syncLyricsChip();
    expect(chip()).toBeNull();
  });

  it('Spotify\'s own Lyrics option is left alone once it has lyrics (enabled): our button goes', async () => {
    loadOverlay();
    syncLyricsChip();
    expect(chip()).not.toBeNull();
    radio('lyrics').disabled = false; // next track has Spotify lyrics
    await vi.advanceTimersByTimeAsync(600);
    expect(chip()).toBeNull();
  });

  it('our button is re-added when Spotify re-renders the switch', async () => {
    loadOverlay();
    syncLyricsChip();
    chip()!.remove();
    await vi.advanceTimersByTimeAsync(600);
    expect(chip()).not.toBeNull();
  });
});
