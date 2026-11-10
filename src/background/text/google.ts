// Google Translate's public web endpoint (client=gtx): translation and romanization.
// Lines are sent joined by newlines and split back; when the line count doesn't survive,
// the batch is retried line by line.
import { tracked } from '../health';
import { RateLimited } from './googleErrors';
import { ensureWidgetPauseLoaded, widgetBlockedUntil, widgetTranslate } from './googleWidget';
import { loadPause, nextPause, savePause } from './pause';

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
}

async function request(text: string, target: string, wantRomanized: boolean, fetchImpl = fetch): Promise<Raw> {
  await ensurePauseLoaded();
  if (Date.now() < blockedUntil) {
    throw new RateLimited(`Google Translate is rate-limiting this network; retrying after ${new Date(blockedUntil).toLocaleTimeString()}`);
  }
  return tracked('google', () => send(text, target, wantRomanized, fetchImpl));
}

async function send(text: string, target: string, wantRomanized: boolean, fetchImpl: typeof fetch): Promise<Raw> {
  const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: target, dj: '1' });
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
  if (res.status === 429 || redirected) {
    const p = nextPause(strikes);
    strikes = p.strikes;
    blockedUntil = p.until;
    savePause('google', p);
    throw new RateLimited(redirected
      ? 'Google Translate is rate-limiting this network (it asks for a CAPTCHA)'
      : 'Google Translate is rate-limiting this network');
  }
  if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
  if (strikes) {
    strikes = 0;
    savePause('google', { until: 0, strikes: 0 });
  }
  const j = (await res.json()) as { sentences?: { trans?: string; src_translit?: string }[] };
  const sentences = j.sentences ?? [];
  const translated = sentences.map((s) => s.trans ?? '').join('');
  const translit = sentences.map((s) => s.src_translit ?? '').join('');
  return { translated, romanized: translit || null };
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

export interface GoogleResult {
  translated: string[];
  romanized: (string | null)[];
  /** From the backup (Google's website widget): translation only, no romanization. */
  backup?: true;
}

/**
 * Translates (and optionally romanizes) lines. Returns arrays aligned with the input.
 * Empty lines map to ''. While the main endpoint is paused, the translation comes from the
 * backup (googleWidget.ts), without romanization; `translation: false` (romanizing only)
 * skips the backup.
 */
export async function googleLines(
  lines: string[],
  target: string,
  wantRomanized: boolean,
  fetchImpl: typeof fetch = fetch,
  opts: { translation?: boolean } = {},
): Promise<GoogleResult> {
  try {
    return await mainLines(lines, target, wantRomanized, fetchImpl);
  } catch (e) {
    if (!(e instanceof RateLimited) || opts.translation === false) throw e;
    let translated: string[];
    try {
      translated = await tracked('google', () => widgetTranslate(lines, target, fetchImpl));
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
): Promise<GoogleResult> {
  const idx = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  const work = idx.map((i) => lines[i].trim());
  const translated = lines.map(() => '');
  const romanized: (string | null)[] = lines.map(() => null);
  let at = 0;
  for (const chunk of chunks(work)) {
    let tr: string[] | null = null;
    let rm: (string | null)[] | null = null;
    const raw = await request(chunk.join('\n'), target, wantRomanized, fetchImpl);
    const trLines = splitLines(raw.translated);
    const rmLines = raw.romanized ? splitLines(raw.romanized) : null;
    if (trLines.length === chunk.length) tr = trLines;
    // No romanization wanted, or none sent (Google has none for this language): nothing to
    // check. Only a romanization with the wrong number of lines means the structure was lost.
    const rmOk = !wantRomanized || !rmLines || rmLines.length === chunk.length;
    if (rmOk) rm = rmLines;
    if (!tr || !rmOk) {
      // Line structure lost: one request per line, a few at a time.
      const single: Raw[] = [];
      for (let i = 0; i < chunk.length; i += 6) {
        single.push(...(await Promise.all(chunk.slice(i, i + 6).map((l) => request(l, target, wantRomanized, fetchImpl)))));
      }
      tr = single.map((r) => r.translated.replace(/\n/g, ' '));
      rm = single.map((r) => r.romanized?.replace(/\n/g, ' ') ?? null);
    }
    chunk.forEach((_, k) => {
      const i = idx[at + k];
      translated[i] = tr![k].trim();
      romanized[i] = rm?.[k]?.trim() || null;
    });
    at += chunk.length;
  }
  return { translated, romanized };
}
