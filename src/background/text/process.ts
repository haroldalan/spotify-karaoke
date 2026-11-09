// Romanize and/or translate a song's lines, with caching. One Google request serves both
// when the script needs Google's romanization and a translation is wanted.
import type { Processed } from '../../shared/types';
import { hash } from '../../shared/hash';
import { cacheGet, cacheSet, once } from '../cache';
import { googleLines } from './google';
import { GOOGLE_PREFERRED, romanizeLinesDetailed } from './romanize';
import { songScript } from '../../shared/scripts';

export interface ProcessRequest {
  lines: string[];
  language?: string | null;
  romanize: boolean;
  translateTo: string | null;
}

/** Bump when romanizer output changes, so stale cached romanizations are not reused. */
const ROMANIZER_VERSION = 2;
const ROMANIZED_TTL = 30 * 24 * 3600_000;
const TRANSLATED_TTL = 60 * 24 * 3600_000;

export async function processLines(req: ProcessRequest): Promise<Processed> {
  const lines = req.lines;
  const script = songScript(lines, req.language);
  const key = hash(lines.join('\n'));
  // The script (decided with the language: kanji-only lines are Japanese in a Japanese song)
  // is part of the key, so a song first seen without its language can't keep the wrong reading.
  const rmKey = `rm${ROMANIZER_VERSION}:${script}:${key}`;
  const trKey = req.translateTo ? `tr:${req.translateTo}:${key}` : null;

  // Shared Google call: translation (+ romanization when Google is the romanizer).
  let googleCall: Promise<{ translated: string[]; romanized: (string | null)[] }> | null = null;
  const google = (wantRm: boolean) => {
    googleCall ??= googleLines(lines, req.translateTo ?? 'en', wantRm);
    return googleCall;
  };
  const googleRomanizes = GOOGLE_PREFERRED.has(script);

  const romanized = req.romanize
    ? once(rmKey, async () => {
        const cached = await cacheGet<(string | null)[]>(rmKey);
        if (cached) return cached;
        const { lines: out, complete } = await romanizeLinesDetailed(lines, script, {
          google: async (subset) => {
            // Google romanizes the whole song in the same request as the translation.
            const all = await google(true);
            return subset.map((l) => all.romanized[lines.indexOf(l)] ?? null);
          },
        });
        // Stopgaps (transliteration, unread kanji, Google unreachable) are retried next time.
        if (complete) await cacheSet(rmKey, out, ROMANIZED_TTL);
        return out;
      })
    : Promise.resolve(null);

  const translated = trKey
    ? once(trKey, async () => {
        const cached = await cacheGet<string[]>(trKey);
        if (cached) return cached;
        const out = (await google(req.romanize && googleRomanizes)).translated;
        await cacheSet(trKey, out, TRANSLATED_TTL);
        return out;
      })
    : Promise.resolve(null);

  const [r, t] = await Promise.allSettled([romanized, translated]);
  if (r.status === 'rejected' && t.status === 'rejected') throw r.reason;
  return {
    script,
    romanized: r.status === 'fulfilled' ? r.value : null,
    translated: t.status === 'fulfilled' ? t.value?.map((x, i) => (x && x !== lines[i].trim() ? x : null)) ?? null : null,
    ...(t.status === 'rejected' ? { translateError: String((t.reason as Error)?.message || t.reason) } : {}),
  };
}
