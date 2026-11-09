import { LANGUAGES } from '../../src/shared/languages';
import { call } from '../../src/shared/messages';
import { loadSettings, onSettingsChanged, saveSettings } from '../../src/shared/settings';
import type { Mode, Settings } from '../../src/shared/types';
import type { PageStatus } from '../../src/content/main';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

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
  current = s.targetLang;
  langName.textContent = nameOf(current);
}

void loadSettings().then(render);
onSettingsChanged(render); // a key or the switcher on the page changed something

document.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.name === 'mode') void saveSettings({ mode: el.value as Mode });
});

// ── Status: one line, naming the problem when there is one ──
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

const NAMES = { lrclib: 'LRCLIB', ytm: 'YouTube Music', google: 'Google Translate' } as const;

async function renderStatus() {
  const tab = await spotifyTab();
  const [page, health] = await Promise.all([pageStatus(tab), call('health', {}).catch(() => null)]);
  const summary = $('#summary');
  let state: 'ok' | 'bad' | 'idle' = 'ok';
  let text = 'Working';
  const down = (Object.keys(NAMES) as (keyof typeof NAMES)[]).find((k) => health?.sources[k] && !health.sources[k]!.ok);
  if (!tab) [state, text] = ['idle', 'Open Spotify in a tab to start'];
  else if (!page) [state, text] = ['bad', 'Reload the Spotify tab to start'];
  else if (health?.googleBlockedUntil) [state, text] = ['bad', 'Translations are paused for a few minutes'];
  else if (down) [state, text] = ['bad', `${NAMES[down]} isn’t answering`];
  summary.className = `summary ${state}`;
  summary.textContent = text;
}

void renderStatus();

$('#version').textContent = `v${chrome.runtime.getManifest().version}`;
