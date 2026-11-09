import { LANGUAGES } from '../../src/shared/languages';
import { call } from '../../src/shared/messages';
import { allLinesShown, loadSettings, onSettingsChanged, saveSettings } from '../../src/shared/settings';
import type { Mode, Settings } from '../../src/shared/types';
import type { PageRequest, PageStatus } from '../../src/content/main';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const BOOLS = ['showOriginal', 'showRomanized', 'showTranslation', 'showPill'] as const;
/** The "also show" switch that would repeat the main line. */
const SAME_AS_MAIN: Record<Mode, (typeof BOOLS)[number]> = { original: 'showOriginal', romanized: 'showRomanized', translated: 'showTranslation' };

// ── Language: a dropdown that opens a searchable list ──
const langButton = $<HTMLButtonElement>('#lang-button');
const langName = $('#lang-name');
const panel = $('#lang-panel');
const search = $<HTMLInputElement>('#lang-search');
const list = $<HTMLUListElement>('#lang-list');
let current = 'en';
let active = -1;

const nameOf = (code: string) => LANGUAGES.find(([c]) => c === code)?.[1] ?? code;

function fillLanguages() {
  const f = search.value.trim().toLowerCase();
  const matches = LANGUAGES.filter(([code, name]) => !f || name.toLowerCase().includes(f) || code.toLowerCase() === f);
  list.replaceChildren(...matches.map(([code, name], i) => {
    const li = document.createElement('li');
    li.id = `lang-${i}`;
    li.role = 'option';
    li.dataset.code = code;
    li.textContent = name;
    li.setAttribute('aria-selected', String(code === current));
    return li;
  }));
  const selected = matches.findIndex(([c]) => c === current);
  setActive(f ? 0 : selected);
}

function setActive(i: number) {
  const items = list.children;
  items[active]?.classList.remove('active');
  active = items.length ? Math.max(0, Math.min(i, items.length - 1)) : -1;
  const el = items[active] as HTMLElement | undefined;
  el?.classList.add('active');
  el?.scrollIntoView({ block: 'nearest' });
  if (el) search.setAttribute('aria-activedescendant', el.id);
  else search.removeAttribute('aria-activedescendant');
}

function openLanguages(open: boolean) {
  panel.hidden = !open;
  langButton.setAttribute('aria-expanded', String(open));
  if (open) {
    search.value = '';
    fillLanguages();
    search.focus();
  } else langButton.focus();
}

function choose(code: string | undefined) {
  if (!code) return;
  current = code;
  langName.textContent = nameOf(code);
  void saveSettings({ targetLang: code });
  openLanguages(false);
}

langButton.addEventListener('click', () => openLanguages(panel.hidden));
search.addEventListener('input', fillLanguages);
search.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') setActive(active + 1);
  else if (e.key === 'ArrowUp') setActive(active - 1);
  else if (e.key === 'Enter') choose((list.children[active] as HTMLElement | undefined)?.dataset.code);
  else if (e.key === 'Escape') openLanguages(false);
  else return;
  e.preventDefault();
});
list.addEventListener('click', (e) => choose((e.target as HTMLElement).closest<HTMLElement>('li')?.dataset.code));

// ── Settings ──
function render(s: Settings) {
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) r.checked = r.value === s.mode;
  for (const k of BOOLS) $<HTMLInputElement>(`input[name="${k}"]`).checked = s[k];
  for (const row of document.querySelectorAll<HTMLElement>('.row[data-for]')) {
    const input = row.querySelector('input')!;
    const same = row.dataset.for === s.mode;
    input.disabled = same;
    // It is on screen (as the main line): shown on, the same way in every mode.
    if (same) input.checked = true;
    row.classList.toggle('disabled', same);
    row.querySelector('.note')?.remove();
    if (same) {
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = 'main line';
      row.firstElementChild!.append(note);
    }
  }
  // With every version on screen the switcher has nothing to switch: it hides itself.
  $('#pill-note').hidden = !allLinesShown(s);
  current = s.targetLang;
  langName.textContent = nameOf(current);
}

void loadSettings().then(render);
onSettingsChanged(render); // a shortcut or the in-page switcher changed something

document.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.name === 'mode') void saveSettings({ mode: el.value as Mode });
  else if ((BOOLS as readonly string[]).includes(el.name)) void saveSettings({ [el.name]: el.checked });
});

// ── Status: one line; the song playing beneath it ──
/** The Spotify tab: this one if it is Spotify, else any open one. */
async function spotifyTab(): Promise<chrome.tabs.Tab | null> {
  const [here] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (here?.url?.startsWith('https://open.spotify.com/')) return here;
  const tabs = await chrome.tabs.query({ url: 'https://open.spotify.com/*' });
  return tabs.find((t) => t.audible) ?? tabs[0] ?? null;
}

let tab: chrome.tabs.Tab | null = null;
const ask = <T>(req: PageRequest) =>
  tab?.id === undefined ? Promise.resolve(null) : (chrome.tabs.sendMessage(tab.id, req).catch(() => null) as Promise<T | null>);

const summary = $('#summary');
const song = $('#song');

function setSummary(state: 'ok' | 'bad' | 'idle', text: string) {
  summary.className = `summary ${state}`;
  summary.textContent = text;
}

type Action = { label: string; run: () => void; primary?: boolean; link?: boolean };

function button(a: Action, group: HTMLElement): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = a.label;
  if (a.primary) b.className = 'primary';
  if (a.link) b.className = 'link';
  b.addEventListener('click', () => { for (const x of group.querySelectorAll('button')) x.disabled = true; a.run(); }, { once: true });
  return b;
}

/**
 * The song row: its title, then one line of text (with an inline link, e.g. Undo) and at
 * most two buttons.
 */
function songRow(title: string, text: string, actions: Action[], inline?: Action) {
  const t = document.createElement('div');
  t.className = 'title';
  t.textContent = title;
  const line = document.createElement('div');
  line.className = 'line';
  const label = document.createElement('span');
  label.textContent = text;
  const buttons = document.createElement('span');
  buttons.className = 'actions';
  if (inline) label.append(' ', button({ ...inline, link: true }, song));
  for (const a of actions) buttons.append(button(a, song));
  line.append(label, buttons);
  song.replaceChildren(t, ...(text || actions.length ? [line] : []));
  song.classList.toggle('stacked', actions.length > 1);
  song.hidden = false;
}

const FROM: Record<string, string> = { found: 'Lyrics from', upgraded: 'Synced lyrics from', restored: 'Original script from' };

function renderSong(page: PageStatus, note = '') {
  const c = page.current;
  if (!c) { song.hidden = true; return; }
  const title = `${c.name} · ${c.artists.join(', ')}`;
  /** Sends the song back to Spotify, or undoes that. */
  const choose = (on: boolean) => () => void ask({ sk: 'not-this-song', on }).then(() => refresh());
  if (page.reload) {
    const reloadNow = { label: 'Reload now', primary: true, run: () => { void ask({ sk: 'reload', when: 'now' }); window.close(); } };
    // A choice made for this song can be undone until the reload.
    const undo = page.reload.reason === 'choice' ? { label: 'Undo', run: choose(!c.spotifyOnly) } : undefined;
    if (page.reload.scheduled) {
      songRow(title, 'Spotify reloads when this song ends.', [
        { label: 'Cancel', run: () => void ask({ sk: 'reload', when: 'cancel' }).then(() => refresh()) },
        reloadNow,
      ], undo);
      return;
    }
    const what = page.reload.reason === 'found'
      ? 'Lyrics found. Spotify shows them after a reload'
      : c.spotifyOnly ? 'Spotify’s own lyrics show after a reload' : 'Ours show again after a reload';
    songRow(title, `${note || what}, which stops the music.`, [
      { label: 'After this song', run: () => void ask({ sk: 'reload', when: 'after-song' }).then(() => refresh()) },
      reloadNow,
    ], undo);
    return;
  }
  if (c.spotifyOnly) {
    songRow(title, 'Showing Spotify’s lyrics for this song.', [], { label: 'Undo', run: choose(false) });
    return;
  }
  if (c.noLyrics) {
    songRow(title, note || 'No lyrics found.', [
      {
        label: 'Search again',
        run: () => {
          songRow(title, 'Searching again…', []);
          void ask<{ found: boolean }>({ sk: 'search-again' }).then((r) => refresh(r?.found ? '' : 'Still none to be found.'));
        },
      },
    ]);
    return;
  }
  if (c.ours) {
    songRow(title, `${FROM[c.ours.kind] ?? 'Lyrics from'} ${c.ours.source}.`, [], { label: 'Not this song?', run: choose(true) });
    return;
  }
  songRow(title, '', []);
}

async function refresh(note = '') {
  const page = await ask<PageStatus>({ sk: 'page-status' });
  if (page?.pageSeenAt) renderSong(page, note);
}

async function renderStatus() {
  tab = await spotifyTab();
  const [page, health] = await Promise.all([ask<PageStatus>({ sk: 'page-status' }), call('health', {}).catch(() => null)]);
  const names = { lrclib: 'LRCLIB', ytm: 'YouTube Music', google: 'Google Translate' } as const;
  let failing = '';
  if (health?.googleBlockedUntil) {
    failing = `Translations paused until ${new Date(health.googleBlockedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } else {
    const down = (Object.keys(names) as (keyof typeof names)[]).find((k) => health?.sources[k] && !health.sources[k]!.ok);
    if (down) failing = `${names[down]} isn’t answering`;
  }
  if (!tab) setSummary('idle', 'Open Spotify in a tab to start');
  else if (!page?.pageSeenAt) setSummary('bad', 'Reload the Spotify tab to start');
  else if (failing) setSummary('bad', failing);
  else setSummary('ok', 'Working');
  if (page?.pageSeenAt) renderSong(page);
}

// ── Cache ──
const clear = $<HTMLButtonElement>('#clear');
const kb = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
async function renderCache() {
  const s = await call('storage', {}).catch(() => null);
  clear.textContent = s ? `Clear cache (${kb(s.bytes)})` : 'Clear cache';
}
let armed = false;
clear.addEventListener('click', async () => {
  if (!armed) {
    armed = true;
    clear.textContent = 'Click again to clear';
    setTimeout(() => { if (armed) { armed = false; void renderCache(); } }, 4000);
    return;
  }
  armed = false;
  clear.disabled = true;
  await call('clearCache', {}).catch(() => null);
  clear.textContent = 'Cleared';
  setTimeout(() => { clear.disabled = false; void renderCache(); }, 1500);
});

void renderStatus();
void renderCache();

$('#version').textContent = `v${chrome.runtime.getManifest().version}`;
$('#shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  // Chrome and Edge; Firefox has its own page (about:addons, gear menu).
  const url = navigator.userAgent.includes('Firefox') ? 'about:addons' : 'chrome://extensions/shortcuts';
  void chrome.tabs.create({ url });
});
