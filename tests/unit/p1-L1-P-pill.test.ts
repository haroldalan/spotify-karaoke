/**
 * Live round 2: a scrolled (sticky) pill pinned under Spotify's overlay header could not
 * be clicked. It is pinned below the header. Synthetic DOM; jsdom has no layout, so the
 * header height is stubbed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { alignPillBelowHeader } from '../../lib/dom/lyricsControls';

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('mode pill below Spotify\'s overlay header', () => {
  it('pins below the header height plus a gap', () => {
    document.body.innerHTML = `<div data-testid="root"><div><div class="overlay">
      <div class="header"><div role="radiogroup"><button role="radio" value="lyrics"></button></div></div>
      <div class="content"><div class="list"><div id="sly-lyrics-controls"></div></div></div>
    </div></div></div>`;
    const header = document.querySelector('.header') as HTMLElement;
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ height: 72 } as DOMRect);
    const pill = document.getElementById('sly-lyrics-controls')!;
    alignPillBelowHeader(pill);
    expect(pill.style.top).toBe('84px');
  });

  it('outside the overlay (legacy layout) keeps the stylesheet position', () => {
    document.body.innerHTML = '<main><div id="sly-lyrics-controls" style="top: 50px"></div></main>';
    const pill = document.getElementById('sly-lyrics-controls')!;
    alignPillBelowHeader(pill);
    expect(pill.style.top).toBe('');
  });
});
