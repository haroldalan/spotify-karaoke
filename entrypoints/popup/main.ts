import { LANGUAGES } from '../../src/shared/languages';
import { call } from '../../src/shared/messages';
import { loadSettings, onSettingsChanged, saveSettings } from '../../src/shared/settings';
import type { Mode, Settings } from '../../src/shared/types';
import type { PageStatus } from '../../src/content/main';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const BOOLS = ['showOriginal', 'showRomanized', 'showTranslation', 'fillMissing', 'restoreNative', 'showPill'] as const;
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
    row.classList.toggle('disabled', same);
    row.querySelector('.note')?.remove();
    if (same) {
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = 'main line';
      row.firstElementChild!.append(note);
    }
  }
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

// ── Status: one line, the details folded away unless something is wrong ──
const ago = (t: number) => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

function row(label: string, state: 'ok' | 'bad' | 'idle', text: string) {
  const li = document.createElement('li');
  li.className = state;
  const name = document.createElement('span');
  name.textContent = label;
  const value = document.createElement('span');
  value.textContent = text;
  li.append(name, value);
  return li;
}

/** The Spotify tab: this one if it is Spotify, else any open one. */
async function spotifyTab(): Promise<chrome.tabs.Tab | null> {
  const [here] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (here?.url?.startsWith('https://open.spotify.com/')) return here;
  const tabs = await chrome.tabs.query({ url: 'https://open.spotify.com/*' });
  return tabs.find((t) => t.audible) ?? tabs[0] ?? null;
}

async function pageStatus(tab: chrome.tabs.Tab | null): Promise<PageStatus | null> {
  if (tab?.id === undefined) return null;
  return (await chrome.tabs.sendMessage(tab.id, { sk: 'page-status' }).catch(() => null)) as PageStatus | null;
}

const summary = $('#summary');
const song = $('#song');
const details = $<HTMLDetailsElement>('details');

function setSummary(state: 'ok' | 'bad' | 'idle', text: string) {
  summary.className = `summary ${state}`;
  summary.textContent = text;
}

function renderSong(tab: chrome.tabs.Tab, page: PageStatus) {
  const c = page.current;
  if (!c) { song.hidden = true; return; }
  const label = document.createElement('span');
  label.textContent = `${c.name} · ${c.artists.join(', ')}`;
  song.replaceChildren(label);
  song.hidden = false;
  if (!c.noLyrics) return;
  label.textContent = `No lyrics for ${c.name}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Search again';
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Searching…';
    const r = (await chrome.tabs.sendMessage(tab.id!, { sk: 'search-again' }).catch(() => null)) as { found: boolean } | null;
    if (r?.found) {
      label.textContent = 'Lyrics found. Spotify shows them after a reload.';
      button.textContent = 'Reload Spotify';
      button.disabled = false;
      button.onclick = () => { void chrome.tabs.reload(tab.id!); window.close(); };
    } else {
      label.textContent = 'Still none to be found.';
      button.remove();
    }
  }, { once: true });
  song.append(button);
}

async function renderStatus() {
  const tab = await spotifyTab();
  const [page, health] = await Promise.all([pageStatus(tab), call('health', {}).catch(() => null)]);
  const rows: HTMLLIElement[] = [];
  const failing: string[] = [];

  if (!tab) rows.push(row('Spotify', 'idle', 'not open'));
  else if (!page?.pageSeenAt) rows.push(row('Spotify', 'bad', 'reload the Spotify tab'));
  else rows.push(row('Spotify', 'ok', page.lyricsSeenAt ? `lyrics seen ${ago(page.lyricsSeenAt)}` : 'connected'));

  const names = { lrclib: 'LRCLIB', ytm: 'YouTube Music', google: 'Google Translate' } as const;
  for (const key of Object.keys(names) as (keyof typeof names)[]) {
    const h = health?.sources[key];
    if (key === 'google' && health?.googleBlockedUntil) {
      rows.push(row(names[key], 'bad', `paused until ${new Date(health.googleBlockedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`));
      failing.push('Translations are paused for a few minutes');
    } else if (!h) rows.push(row(names[key], 'idle', 'not used yet'));
    else {
      rows.push(row(names[key], h.ok ? 'ok' : 'bad', h.ok ? `answered ${ago(h.at)}` : `failing: ${h.detail ?? 'error'}`));
      if (!h.ok) failing.push(`${names[key]} isn’t answering`);
    }
  }
  $('#status').replaceChildren(...rows);

  if (!tab) setSummary('idle', 'Open Spotify in a tab to start');
  else if (!page?.pageSeenAt) setSummary('bad', 'Reload the Spotify tab to start');
  else if (failing.length) setSummary('bad', failing[0]);
  else setSummary('ok', 'Working');
  if (failing.length) details.open = true;
  if (tab && page?.pageSeenAt) renderSong(tab, page);
}

// ── Cache ──
const size = $('#cache-size');
const clear = $<HTMLButtonElement>('#clear');
const kb = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
async function renderCache() {
  const s = await call('storage', {}).catch(() => null);
  size.textContent = s ? `Cache: ${kb(s.bytes)}` : 'Cache: unknown';
}
let armed = false;
clear.addEventListener('click', async () => {
  if (!armed) {
    armed = true;
    clear.textContent = 'Click again to clear';
    setTimeout(() => { armed = false; clear.textContent = 'Clear cache'; }, 4000);
    return;
  }
  armed = false;
  clear.disabled = true;
  await call('clearCache', {}).catch(() => null);
  clear.textContent = 'Cleared';
  await renderCache();
  setTimeout(() => { clear.disabled = false; clear.textContent = 'Clear cache'; }, 1500);
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
