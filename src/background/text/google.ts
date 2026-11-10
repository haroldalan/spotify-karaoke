// Google Translate's public endpoint, asked as Google Translate's Android app (client=at, and
// the app's User-Agent from the header rules in net.ts): translation and romanization.
// Lines are sent joined by newlines. The answer comes as sentences, each with the source
// text it translates (orig), so every translation is put back on its own line even when
// Google moves the line breaks in its translation. Never one request per line: a burst like
// that is what gets a network blocked.
import { tracked } from '../health';
import { RateLimited } from './googleErrors';
import { ensureWidgetPauseLoaded, widgetBlockedUntil, widgetTranslate } from './googleWidget';
import { loadPause, nextPause, savePause } from './pause';
import { ensureHeaderRules } from '../net';

export { RateLimited };

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MAX_CHARS = 4000;


// After a 429, or a redirect to Google's "unusual traffic" page (google.com/sorry, a
// CAPTCHA no extension can answer), wait before asking again: 1, 2, 4 ... up to 30 minutes.
// Requests in the meantime fail at once, without touching the network: asking on makes the
// block last longer.
let blockedUntil = 0;
let strikes = 0;
let loaded: Promise<void> | null = null;

/** Reads the pause kept by an earlier life of this worker (once per worker lifetime). */
export function ensurePauseLoaded(): Promise<void> {
  loaded ??= (async () => {
    const p = await loadPause('google');
    blockedUntil = Math.max(blockedUntil, p.until);
    strikes = Math.max(strikes, p.strikes);
    await ensureWidgetPauseLoaded();
  })();
  return loaded;
}

/** When the main endpoint may be asked again (0: now). */
export function mainBlockedUntil(): number {
  return blockedUntil > Date.now() ? blockedUntil : 0;
}

/** Until when translations are paused: both endpoints are (0: they aren't). */
export function googleBlockedUntil(): number {
  const main = mainBlockedUntil();
  const widget = widgetBlockedUntil();
  return main && widget ? Math.min(main, widget) : 0;
}

/** For tests. */
export function resetGoogleBackoff() {
  blockedUntil = 0;
  strikes = 0;
  loaded = null;
}

interface Raw {
  translated: string;
  romanized: string | null;
  /** Google's sentences: the source text each translates, and its translation. */
  sentences: { orig?: string; trans?: string }[];
}

async function request(text: string, target: string, wantRomanized: boolean, fetchImpl = fetch, source = 'auto'): Promise<Raw> {
  await ensurePauseLoaded();
  if (Date.now() < blockedUntil) {
    throw new RateLimited(`Google Translate is rate-limiting this network; retrying after ${new Date(blockedUntil).toLocaleTimeString()}`);
  }
  return tracked('google', () => send(text, target, wantRomanized, fetchImpl, source));
}

async function send(text: string, target: string, wantRomanized: boolean, fetchImpl: typeof fetch, source: string): Promise<Raw> {
  // The header rules (net.ts): the Translate app's User-Agent; no Origin or Referer.
  if (typeof chrome !== 'undefined' && fetchImpl === fetch) await ensureHeaderRules();
  const params = new URLSearchParams({ client: 'at', sl: source, tl: target, dj: '1' });
  params.append('dt', 't');
  if (wantRomanized) params.append('dt', 'rm');
  const res = await fetchImpl(`${ENDPOINT}?${params}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ q: text }).toString(),
    // Never follow Google to google.com/sorry: outside our host permissions, that ends in
    // "Failed to fetch". The redirect itself is the answer.
    redirect: 'manual',
  });
  const redirected = res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
  // Google's ways of saying "not from this network": 429, a redirect to its CAPTCHA page, a
  // 403, or the CAPTCHA page itself served as a 200 (HTML, not JSON).
  const body = res.ok ? await res.text() : '';
  const notJson = res.ok && /^\s*</.test(body);
  if (res.status === 429 || res.status === 403 || redirected || notJson) {
    const p = nextPause(strikes);
    strikes = p.strikes;
    blockedUntil = p.until;
    savePause('google', p);
    throw new RateLimited(redirected || notJson
      ? 'Google Translate is rate-limiting this network (it asks for a CAPTCHA)'
      : 'Google Translate is rate-limiting this network');
  }
  if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
  if (strikes) {
    strikes = 0;
    savePause('google', { until: 0, strikes: 0 });
  }
  const j = JSON.parse(body) as { sentences?: { trans?: string; orig?: string; src_translit?: string }[] };
  const sentences = j.sentences ?? [];
  const translated = sentences.map((s) => s.trans ?? '').join('');
  const translit = sentences.map((s) => s.src_translit ?? '').join('');
  return { translated, romanized: translit || null, sentences: sentences.filter((s) => s.trans != null) };
}

function chunks(lines: string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const l of lines) {
    if (cur.length && len + l.length + 1 > MAX_CHARS) { out.push(cur); cur = []; len = 0; }
    cur.push(l);
    len += l.length + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}

const splitLines = (s: string) => s.replace(/\r/g, '').split('\n');

/**
 * Each of `n` lines' translation, from Google's sentences: a sentence belongs to the line its
 * source text (orig) is on; several on one line are joined. A sentence whose source spans
 * lines is split by its translation's line breaks when they match, and otherwise leaves those
 * lines null: never guessed, never shifted onto a neighbour. All null when the sources don't
 * add up to the lines sent (an answer we can't read).
 */
export function alignSentences(sentences: { orig?: string; trans?: string }[], n: number): (string | null)[] {
  const none = (): (string | null)[] => Array.from({ length: n }, () => null);
  if (!sentences.length || sentences.some((s) => s.orig == null)) return none();
  const parts: string[][] = Array.from({ length: n }, () => []);
  const lost = new Set<number>();
  let line = 0;
  for (const s of sentences) {
    const pieces = s.orig!.replace(/\r/g, '').split('\n');
    const on = pieces.map((p, k) => (p.trim() ? line + k : -1)).filter((i) => i >= 0);
    if (on.some((i) => i >= n)) return none();
    const trans = (s.trans ?? '').replace(/\r/g, '');
    if (on.length === 1) parts[on[0]].push(trans.replace(/\s*\n\s*/g, ' ').trim());
    else if (on.length > 1) {
      const tr = trans.split('\n').map((t) => t.trim()).filter(Boolean);
      if (tr.length === on.length) on.forEach((i, k) => parts[i].push(tr[k]));
      else on.forEach((i) => lost.add(i));
    }
    line += pieces.length - 1;
  }
  if (line !== n - 1) return none();
  return parts.map((p, i) => (lost.has(i) || !p.length ? null : p.join(' ').replace(/\s+/g, ' ').trim()));
}

export interface GoogleResult {
  translated: string[];
  romanized: (string | null)[];
  /** From the backup (Google's website widget): translation only, no romanization. */
  backup?: true;
  /** Some lines have no translation (Google's answer couldn't be put back line by line, nor the backup asked): not to be kept. */
  incomplete?: true;
  /** Google sent a romanization that couldn't be put back line by line: not "none for this language". */
  romanizationLost?: true;
}

/**
 * Translates (and optionally romanizes) lines. Returns arrays aligned with the input.
 * Empty lines map to ''. When the main endpoint fails (paused, blocked, or any other error),
 * the translation comes from the backup (googleWidget.ts), without romanization;
 * `translation: false` (romanizing only) skips the backup.
 */
export async function googleLines(
  lines: string[],
  target: string,
  wantRomanized: boolean,
  fetchImpl: typeof fetch = fetch,
  /** source: the lines' language when known (default 'auto': Google detects one for the whole request). */
  opts: { translation?: boolean; source?: string } = {},
): Promise<GoogleResult> {
  const source = opts.source ?? 'auto';
  try {
    return await mainLines(lines, target, wantRomanized, fetchImpl, source);
  } catch (e) {
    // Any failure of the main endpoint (a block, a server error, a dropped connection): the
    // translation comes from the backup. Romanizing only: nothing the backup can do.
    if (opts.translation === false) throw e;
    let translated: string[];
    try {
      translated = await tracked('google', () => widgetTranslate(lines, target, fetchImpl, source));
    } catch {
      throw e;
    }
    return { translated, romanized: lines.map(() => null), backup: true };
  }
}

async function mainLines(
  lines: string[],
  target: string,
  wantRomanized: boolean,
  fetchImpl: typeof fetch,
  source = 'auto',
): Promise<GoogleResult> {
  const idx = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  const work = idx.map((i) => lines[i].trim());
  const translated = lines.map(() => '');
  const romanized: (string | null)[] = lines.map(() => null);
  /** Lines (indices into `lines`) Google's answer couldn't put a translation on. */
  const unplaced: number[] = [];
  let romanizationLost = false;
  let at = 0;
  for (const chunk of chunks(work)) {
    const raw = await request(chunk.join('\n'), target, wantRomanized, fetchImpl, source);
    // Line by line from the sentences; an answer without them (or older tests) by its line breaks.
    const byLines = splitLines(raw.translated);
    const tr = raw.sentences.some((s) => s.orig != null)
      ? alignSentences(raw.sentences, chunk.length)
      : byLines.length === chunk.length ? byLines : chunk.map(() => null);
    // Google's romanization is one block with no sentences to place it by: used only when its
    // line count matches. Otherwise the local romanizer stands in (romanize.ts), not a burst.
    const rmLines = raw.romanized ? splitLines(raw.romanized) : null;
    const rm = rmLines && rmLines.length === chunk.length ? rmLines : null;
    if (wantRomanized && rmLines && !rm) romanizationLost = true;
    chunk.forEach((_, k) => {
      const i = idx[at + k];
      const t = tr[k]?.trim();
      if (t) translated[i] = t;
      else unplaced.push(i);
      romanized[i] = rm?.[k]?.trim() || null;
    });
    at += chunk.length;
  }
  const lost = romanizationLost ? { romanizationLost: true as const } : {};
  if (!unplaced.length) return { translated, romanized, ...lost };
  // The lines Google's answer couldn't place: one request to the backup, which answers line
  // for line (it takes and returns a list). If that can't be had, they stay without a
  // translation, and the result isn't kept: asked again another time, not now.
  try {
    const more = await widgetTranslate(unplaced.map((i) => lines[i].trim()), target, fetchImpl, source);
    unplaced.forEach((i, k) => (translated[i] = more[k] ?? ''));
    return { translated, romanized, ...lost, ...(unplaced.some((i) => !translated[i]) ? { incomplete: true as const } : {}) };
  } catch {
    return { translated, romanized, ...lost, incomplete: true };
  }
}
