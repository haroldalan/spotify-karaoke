import { LANGUAGES, rankByQuery } from '../../src/shared/languages';
import { call } from '../../src/shared/messages';
import { loadSettings, onSettingsChanged, resetSettings, saveSettings } from '../../src/shared/settings';
import type { Mode, Settings } from '../../src/shared/types';
import type { PageRequest, PageStatus } from '../../src/content/main';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ── Main line ──
const modeInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="mode"]')];
for (const r of modeInputs) r.addEventListener('change', () => void saveSettings({ mode: r.value as Mode }));

// ── Translate into: common languages first, then all, searchable ──
const QUICK = ['en', 'es', 'zh-CN', 'hi', 'fr', 'de', 'ja', 'ko', 'pt', 'ru'];
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
  const match = ([code, name]: [string, string]) => !f || name.toLowerCase().includes(f) || code.toLowerCase() === f;
  const common = rankByQuery(QUICK.map((c) => LANGUAGES.find(([code]) => code === c)).filter((l): l is [string, string] => !!l).filter(match), f);
  const rest = rankByQuery(LANGUAGES.filter(([c]) => !QUICK.includes(c)).filter(match), f);
  const nodes: HTMLLIElement[] = [];
  let i = 0;
  for (const [label, langs] of [['Common', common], ['All languages', rest]] as const) {
    if (!langs.length) continue;
    const g = document.createElement('li');
    g.className = 'group';
    g.role = 'presentation';
    g.textContent = label;
    nodes.push(g);
    for (const [code, name] of langs) {
      const li = document.createElement('li');
      li.id = `lang-${i++}`;
      li.role = 'option';
      li.dataset.code = code;
      li.textContent = name;
      li.setAttribute('aria-selected', String(code === current));
      nodes.push(li);
    }
  }
  if (!i) {
    const none = document.createElement('li');
    none.className = 'empty';
    none.textContent = 'No languages found';
    nodes.push(none);
  }
  list.replaceChildren(...nodes);
  setActive(f ? 0 : options().findIndex((el) => el.dataset.code === current));
}

const options = () => [...list.querySelectorAll<HTMLElement>('li[role="option"]')];

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

function openLanguages(open: boolean, refocus = true) {
  panel.hidden = !open;
  langButton.setAttribute('aria-expanded', String(open));
  if (open) {
    search.value = '';
    fillLanguages();
    search.focus();
  } else if (refocus) langButton.focus();
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
  else if (e.key === 'Enter') choose(options()[active]?.dataset.code);
  else if (e.key === 'Escape') openLanguages(false);
  else return;
  e.preventDefault();
});
list.addEventListener('click', (e) => choose((e.target as HTMLElement).closest<HTMLElement>('li[role="option"]')?.dataset.code));
// A click anywhere else closes the list (and leaves the focus where the click put it).
document.addEventListener('mousedown', (e) => {
  const t = e.target as Node;
  if (!panel.hidden && !panel.contains(t) && !langButton.contains(t)) openLanguages(false, false);
});

// ── Switches ──
const allLines = $<HTMLInputElement>('#all-lines');
const showPill = $<HTMLInputElement>('#show-pill');
const pillRow = $('#pill-row');
const pillDescription = $('#pill-description');
allLines.addEventListener('change', () => void saveSettings({ allLines: allLines.checked }));
showPill.addEventListener('change', () => void saveSettings({ showPill: showPill.checked }));

let settings: Settings | null = null;

function render(s: Settings) {
  settings = s;
  for (const r of modeInputs) r.checked = r.value === s.mode;
  current = s.targetLang;
  langName.textContent = nameOf(current);
  allLines.checked = s.allLines;
  // With all three lines on, every version is already on screen: the switcher is hidden and
  // its switch keeps its setting, greyed out, until the three lines go off again.
  showPill.checked = s.showPill;
  showPill.disabled = s.allLines;
  pillRow.classList.toggle('disabled', s.allLines);
  pillDescription.textContent = s.allLines ? 'Hidden while all three lines show' : 'Pick the main line on the lyrics';
  // The song row's wording depends on the mode and language (e.g. "Already in English").
  if (lastPage && !song.hidden) renderSong(lastPage, lastNote);
}

void loadSettings().then(render);
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

const FROM: Record<string, string> = { found: 'Lyrics from', upgraded: 'Synced lyrics from', restored: 'Original script restored, from' };

let lastPage: PageStatus | null = null;
let lastNote = '';

/** What the extension does to a song it shows as it is, or '' when it changes it. */
function plainText(c: NonNullable<PageStatus['current']>): string {
  if (c.plain === 'same') return `Already in ${langName.textContent}: shown as it is.`;
  if (c.plain === 'latin' && settings?.mode !== 'translated' && !settings?.allLines) return 'Already in Latin script: nothing to romanize.';
  return '';
}

function renderSong(page: PageStatus, note = '') {
  lastPage = page;
  lastNote = note;
  const c = page.current;
  if (!c) { song.hidden = true; return; }
  const title = `${c.name} · ${c.artists.join(', ')}`;
  /** Sends the song back to Spotify, or undoes that. */
  const choose = (on: boolean) => () => void ask({ sk: 'not-this-song', on, id: c.id }).then(() => refresh());
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
          void ask<{ found: boolean }>({ sk: 'search-again', id: c.id }).then((r) => refresh(r?.found ? '' : 'Still none to be found.'));
        },
      },
    ]);
    return;
  }
  if (c.ours) {
    songRow(title, `${FROM[c.ours.kind] ?? 'Lyrics from'} ${c.ours.source}.`, [], { label: 'Wrong lyrics?', run: choose(true) });
    return;
  }
  // Nothing on screen yet: where to look (a first-time user doesn't know).
  const text = page.linesOnScreen ? plainText(c) : 'Open its lyrics with Spotify’s Lyrics button.';
  songRow(title, text, []);
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
  if (!tab) setSummary('idle', 'Open Spotify, play a song, then press its Lyrics button');
  else if (!page?.pageSeenAt) setSummary('bad', 'Reload the Spotify tab to start');
  else if (failing) setSummary('bad', failing);
  else setSummary('ok', 'Working');
  if (page?.pageSeenAt) renderSong(page);
  // With a song row and everything fine, the song's own line carries the green dot: one line less.
  const merged = !song.hidden && summary.classList.contains('ok');
  summary.hidden = merged;
  song.classList.toggle('with-dot', merged);
}

// ── Storage, Clear cache and Reset data ──
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
async function renderStorage() {
  let sync = 0;
  try {
    const area = chrome.storage.sync as chrome.storage.StorageArea & { getBytesInUse?: (keys: null) => Promise<number> };
    sync = typeof area.getBytesInUse === 'function'
      ? await area.getBytesInUse(null)
      : new TextEncoder().encode(JSON.stringify(await chrome.storage.sync.get(null))).length;
  } catch { /* shown as 0 */ }
  const local = await call('storage', {}).catch(() => null);
  $('#storage-info').textContent = `Settings ${kb(sync)} · Cache ${local ? kb(local.bytes) : 'unknown'}`;
}

const clear = $<HTMLButtonElement>('#clear');
let armed = false;
clear.addEventListener('click', async () => {
  if (!armed) {
    armed = true;
    clear.textContent = 'Click again';
    setTimeout(() => { if (armed) { armed = false; clear.textContent = 'Clear cache'; } }, 4000);
    return;
  }
  armed = false;
  clear.disabled = true;
  await call('clearCache', {}).catch(() => null);
  clear.textContent = 'Cleared';
  void renderStorage();
  setTimeout(() => { clear.disabled = false; clear.textContent = 'Clear cache'; }, 1500);
});

const confirmBox = $('#confirm');
const showConfirm = (on: boolean) => {
  confirmBox.hidden = !on;
  if (on) $<HTMLButtonElement>('#confirm-cancel').focus();
};
$('#reset').addEventListener('click', () => showConfirm(confirmBox.hidden));
$('#confirm-cancel').addEventListener('click', () => { showConfirm(false); $('#reset').focus(); });
confirmBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') { showConfirm(false); $('#reset').focus(); } });
$('#confirm-reset').addEventListener('click', async () => {
  showConfirm(false);
  await Promise.all([resetSettings(), call('clearCache', {}).catch(() => null)]);
  render(await loadSettings());
  void renderStorage();
});

void renderStatus();
void renderStorage();

$('#version').textContent = `v${chrome.runtime.getManifest().version}`;
$('#shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  // Firefox opens its shortcut settings directly (a page tab may not be opened for about:addons);
  // Chrome and Edge have a page for them.
  const commands = chrome.commands as typeof chrome.commands & { openShortcutSettings?: () => Promise<void> };
  if (navigator.userAgent.includes('Firefox')) void commands.openShortcutSettings?.();
  else void chrome.tabs.create({ url: navigator.userAgent.includes('Edg/') ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' });
});
