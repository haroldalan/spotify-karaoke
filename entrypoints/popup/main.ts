import { LANGUAGES } from '../../src/shared/languages';
import { call } from '../../src/shared/messages';
import { loadSettings, onSettingsChanged, resetSettings, saveSettings } from '../../src/shared/settings';
import type { Mode, Settings } from '../../src/shared/types';
import type { PageRequest, PageStatus } from '../../src/content/main';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ── "Saved" ──
const saved = $('#saved');
let savedTimer: ReturnType<typeof setTimeout> | undefined;
async function save(patch: Partial<Settings>) {
  await saveSettings(patch);
  saved.classList.add('visible');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => saved.classList.remove('visible'), 2000);
}

// ── Active mode ──
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('.sly-lyrics-btn')];
for (const b of modeButtons) b.addEventListener('click', () => void save({ mode: b.dataset.mode as Mode }));

// ── Target language: common languages first, then all, searchable ──
const QUICK = ['en', 'es', 'zh-CN', 'hi', 'fr', 'de', 'ja', 'ko', 'pt', 'ru'];
const picker = $('#picker');
const langButton = $<HTMLButtonElement>('#lang-button');
const langName = $('#lang-name');
const panel = $('#lang-panel');
const search = $<HTMLInputElement>('#lang-search');
const list = $('#lang-list');
let current = 'en';
let active = -1;

const nameOf = (code: string) => LANGUAGES.find(([c]) => c === code)?.[1] ?? code;

function fillLanguages() {
  const f = search.value.trim().toLowerCase();
  const match = ([code, name]: [string, string]) => !f || name.toLowerCase().includes(f) || code.toLowerCase() === f;
  const common = QUICK.map((c) => LANGUAGES.find(([code]) => code === c)!).filter(Boolean).filter(match);
  const rest = LANGUAGES.filter(([c]) => !QUICK.includes(c)).filter(match);
  const groups: [string, [string, string][]][] = [['Common', common], ['All Languages', rest]];
  const nodes: HTMLElement[] = [];
  let i = 0;
  for (const [label, langs] of groups) {
    if (!langs.length) continue;
    const g = document.createElement('div');
    g.className = 'sly-picker-group-label';
    g.textContent = label;
    nodes.push(g);
    for (const [code, name] of langs) {
      const item = document.createElement('div');
      item.className = `sly-picker-item${code === current ? ' selected' : ''}`;
      item.id = `lang-${i++}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(code === current));
      item.dataset.code = code;
      item.textContent = name;
      if (code === current) {
        const check = document.createElement('span');
        check.className = 'sly-picker-check';
        check.textContent = '✓';
        item.append(check);
      }
      nodes.push(item);
    }
  }
  if (!i) {
    const none = document.createElement('div');
    none.className = 'sly-picker-no-results';
    none.textContent = 'No languages found';
    nodes.push(none);
  }
  list.replaceChildren(...nodes);
  const items = options();
  setActive(f ? 0 : items.findIndex((el) => el.dataset.code === current));
}

const options = () => [...list.querySelectorAll<HTMLElement>('.sly-picker-item')];

function setActive(i: number) {
  const items = options();
  items[active]?.classList.remove('active');
  active = items.length ? Math.max(0, Math.min(i, items.length - 1)) : -1;
  const el = items[active];
  el?.classList.add('active');
  el?.scrollIntoView({ block: 'nearest' });
  if (el) search.setAttribute('aria-activedescendant', el.id);
  else search.removeAttribute('aria-activedescendant');
}

function openLanguages(open: boolean) {
  panel.hidden = !open;
  langButton.classList.toggle('active', open);
  langButton.setAttribute('aria-expanded', String(open));
  if (open) {
    search.value = '';
    fillLanguages();
    search.focus();
  }
}

function choose(code: string | undefined) {
  if (!code) return;
  current = code;
  langName.textContent = nameOf(code);
  void save({ targetLang: code });
  openLanguages(false);
  langButton.focus();
}

langButton.addEventListener('click', () => openLanguages(panel.hidden));
search.addEventListener('input', fillLanguages);
search.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') setActive(active + 1);
  else if (e.key === 'ArrowUp') setActive(active - 1);
  else if (e.key === 'Enter') choose(options()[active]?.dataset.code);
  else if (e.key === 'Escape') { openLanguages(false); langButton.focus(); }
  else return;
  e.preventDefault();
});
list.addEventListener('click', (e) => choose((e.target as HTMLElement).closest<HTMLElement>('.sly-picker-item')?.dataset.code));
document.addEventListener('mousedown', (e) => { if (!panel.hidden && !picker.contains(e.target as Node)) openLanguages(false); });

// ── Switches ──
const allLines = $<HTMLInputElement>('#all-lines');
const showPill = $<HTMLInputElement>('#show-pill');
const pillGroup = $('#pill-group');
const pillDescription = $('#pill-description');
allLines.addEventListener('change', () => void save({ allLines: allLines.checked }));
showPill.addEventListener('change', () => void save({ showPill: showPill.checked }));

function render(s: Settings) {
  for (const b of modeButtons) {
    const on = b.dataset.mode === s.mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  }
  current = s.targetLang;
  langName.textContent = nameOf(current);
  allLines.checked = s.allLines;
  // With all three lines on, every version is already on screen: the switcher is hidden and
  // its switch keeps its setting, greyed out, until the three lines go off again.
  showPill.checked = s.showPill;
  showPill.disabled = s.allLines;
  pillGroup.classList.toggle('disabled', s.allLines);
  pillDescription.textContent = s.allLines
    ? 'Hidden while all three lines show.'
    : 'Display the Original / Romanized / Translated switch on Spotify\u2019s lyrics.';
}

void loadSettings().then((s) => {
  render(s);
  // Settings arrive before the first paint settles: no sliding switches on open.
  setTimeout(() => $('#container').classList.remove('no-transitions'), 50);
});
onSettingsChanged(render); // a shortcut or the in-page switcher changed something

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

// ── Storage usage, and Reset data ──
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${(b / 1024).toFixed(1)} KB`);
async function renderStorage() {
  let sync = 0;
  try {
    const area = chrome.storage.sync as chrome.storage.StorageArea & { getBytesInUse?: (keys: null) => Promise<number> };
    sync = typeof area.getBytesInUse === 'function'
      ? await area.getBytesInUse(null)
      : new TextEncoder().encode(JSON.stringify(await chrome.storage.sync.get(null))).length;
  } catch { /* shown as 0 */ }
  const local = await call('storage', {}).catch(() => null);
  $('#sync-info').textContent = `Settings: ${kb(sync)}`;
  $('#local-info').textContent = local ? `Cache: ${kb(local.bytes)}` : 'Cache: unknown';
}

const modal = $('#modal');
const showModal = (on: boolean) => modal.classList.toggle('visible', on);
$('#reset').addEventListener('click', () => { showModal(true); $<HTMLButtonElement>('#modal-cancel').focus(); });
$('#modal-cancel').addEventListener('click', () => showModal(false));
modal.addEventListener('click', (e) => { if (e.target === modal) showModal(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('visible')) showModal(false); });
$('#modal-confirm').addEventListener('click', async () => {
  showModal(false);
  await Promise.all([resetSettings(), call('clearCache', {}).catch(() => null)]);
  render(await loadSettings());
  saved.classList.add('visible');
  setTimeout(() => saved.classList.remove('visible'), 2000);
  void renderStorage();
});

void renderStatus();
void renderStorage();

$('#version').textContent = `v${chrome.runtime.getManifest().version}`;
$('#shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  // Chrome and Edge; Firefox has its own page (about:addons, gear menu).
  const url = navigator.userAgent.includes('Firefox') ? 'about:addons' : 'chrome://extensions/shortcuts';
  void chrome.tabs.create({ url });
});
