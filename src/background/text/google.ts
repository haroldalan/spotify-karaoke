// Google Translate's public web endpoint (client=gtx): translation and romanization.
// Lines are sent joined by newlines and split back; when the line count doesn't survive,
// the batch is retried line by line.
import { tracked } from '../health';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MAX_CHARS = 4000;

export class RateLimited extends Error {}

// After a 429, or a redirect to Google's "unusual traffic" page (google.com/sorry, a
// CAPTCHA no extension can answer), wait before asking again: 1, 2, 4 ... up to 30 minutes.
// Requests in the meantime fail at once, without touching the network: asking on makes the
// block last longer.
let blockedUntil = 0;
let strikes = 0;

/** When Google may be asked again (0: now). */
export function googleBlockedUntil(): number {
  return blockedUntil > Date.now() ? blockedUntil : 0;
}

/** For tests. */
export function resetGoogleBackoff() {
  blockedUntil = 0;
  strikes = 0;
}

interface Raw {
  translated: string;
  romanized: string | null;
}

async function request(text: string, target: string, wantRomanized: boolean, fetchImpl = fetch): Promise<Raw> {
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
    strikes++;
    blockedUntil = Date.now() + Math.min(30, 2 ** (strikes - 1)) * 60_000;
    throw new RateLimited(redirected
      ? 'Google Translate is rate-limiting this network (it asks for a CAPTCHA)'
      : 'Google Translate is rate-limiting this network');
  }
  if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
  strikes = 0;
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

/**
 * Translates (and optionally romanizes) lines. Returns arrays aligned with the input.
 * Empty lines map to ''.
 */
export async function googleLines(
  lines: string[],
  target: string,
  wantRomanized: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<{ translated: string[]; romanized: (string | null)[] }> {
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
    // Without a romanization wanted, there is none to check.
    const rmOk = !wantRomanized || (!!rmLines && rmLines.length === chunk.length);
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
