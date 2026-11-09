// Google Translate's public web endpoint (client=gtx): translation and romanization.
// Lines are sent joined by newlines and split back; when the line count doesn't survive,
// the batch is retried line by line.

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MAX_CHARS = 4000;

export class RateLimited extends Error {}

interface Raw {
  translated: string;
  romanized: string | null;
}

async function request(text: string, target: string, wantRomanized: boolean, fetchImpl = fetch): Promise<Raw> {
  const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: target, dj: '1' });
  params.append('dt', 't');
  if (wantRomanized) params.append('dt', 'rm');
  const res = await fetchImpl(`${ENDPOINT}?${params}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ q: text }).toString(),
  });
  if (res.status === 429) throw new RateLimited('Google Translate is rate-limiting this network');
  if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
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
    if (!wantRomanized || (rmLines && rmLines.length === chunk.length)) rm = rmLines;
    if (!tr || !rm) {
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
