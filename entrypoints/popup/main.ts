import { LANGUAGES } from '../../src/shared/languages';
import { call } from '../../src/shared/messages';
import { loadSettings, saveSettings } from '../../src/shared/settings';
import type { Mode, Settings } from '../../src/shared/types';
import type { PageStatus } from '../../src/content/main';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const BOOLS = ['showOriginal', 'showRomanized', 'showTranslation', 'fillMissing', 'restoreNative', 'showPill'] as const;

// ── Language: a searchable list ──
const lang = $<HTMLSelectElement>('#lang');
const search = $<HTMLInputElement>('#lang-search');
let current = 'en';

function fillLanguages(filter = '') {
  const f = filter.trim().toLowerCase();
  const matches = LANGUAGES.filter(([code, name]) => !f || name.toLowerCase().includes(f) || code.toLowerCase() === f);
  lang.replaceChildren(...matches.map(([code, name]) => new Option(name, code, false, code === current)));
  if (!matches.some(([c]) => c === current) && matches[0]) lang.selectedIndex = -1;
}

search.addEventListener('input', () => fillLanguages(search.value));
search.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { lang.focus(); if (lang.selectedIndex < 0) lang.selectedIndex = 0; e.preventDefault(); }
  if (e.key === 'Enter' && lang.options.length) { lang.selectedIndex = Math.max(0, lang.selectedIndex); lang.dispatchEvent(new Event('change', { bubbles: true })); }
});

function render(s: Settings) {
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) r.checked = r.value === s.mode;
  for (const k of BOOLS) $<HTMLInputElement>(`input[name="${k}"]`).checked = s[k];
  current = s.targetLang;
  fillLanguages(search.value);
  lang.querySelector<HTMLOptionElement>(`option[value="${CSS.escape(current)}"]`)?.scrollIntoView({ block: 'nearest' });
}

void loadSettings().then(render);

document.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if (el.name === 'mode') void saveSettings({ mode: el.value as Mode });
  else if (el.name === 'targetLang' && el.value) {
    current = el.value;
    void saveSettings({ targetLang: el.value });
  } else if ((BOOLS as readonly string[]).includes(el.name)) void saveSettings({ [el.name]: (el as HTMLInputElement).checked });
});

// ── Status ──
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

async function pageStatus(): Promise<PageStatus | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return null;
  return (await chrome.tabs.sendMessage(tab.id, { sk: 'page-status' }).catch(() => null)) as PageStatus | null;
}

async function renderStatus() {
  const [page, health] = await Promise.all([pageStatus(), call('health', {}).catch(() => null)]);
  const rows: HTMLLIElement[] = [];
  if (!page) rows.push(row('Spotify', 'idle', 'Open open.spotify.com in this tab'));
  else if (!page.pageSeenAt) rows.push(row('Spotify', 'bad', 'Not seen yet: reload the Spotify tab'));
  else rows.push(row('Spotify', 'ok', page.lyricsSeenAt ? `lyrics seen ${ago(page.lyricsSeenAt)}` : 'connected'));
  const names = { lrclib: 'LRCLIB', ytm: 'YouTube Music', google: 'Google Translate' } as const;
  for (const key of Object.keys(names) as (keyof typeof names)[]) {
    const h = health?.sources[key];
    if (key === 'google' && health?.googleBlockedUntil) rows.push(row(names[key], 'bad', `rate-limited; retrying at ${new Date(health.googleBlockedUntil).toLocaleTimeString()}`));
    else if (!h) rows.push(row(names[key], 'idle', 'not used yet'));
    else rows.push(row(names[key], h.ok ? 'ok' : 'bad', h.ok ? `answered ${ago(h.at)}` : `failing: ${h.detail ?? 'error'}`));
  }
  $('#status').replaceChildren(...rows);
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
