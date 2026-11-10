// Romanize and/or translate a song's lines, with caching. One Google request serves both
// when the script needs Google's romanization and a translation is wanted.
import type { Processed } from '../../shared/types';
import { hash } from '../../shared/hash';
import { cacheGet, cacheSet, once } from '../cache';
import { RateLimited, googleLines, type GoogleResult } from './google';
import { GOOGLE_PREFERRED, romanizeLinesDetailed } from './romanize';
import { expectedScript, songScript } from '../../shared/scripts';

const baseLang = (l?: string | null) => (l ?? '').toLowerCase().split(/[-_]/)[0];

/** Every translated line starts with a capital, as Spotify's lyrics do (Google's casing varies line to line). */
export const sentenceCase = (s: string) => s.replace(/^([\p{P}\p{Zs}]*)(\p{Ll})/u, (_, lead: string, c: string) => lead + c.toLocaleUpperCase());

export interface ProcessRequest {
  lines: string[];
  language?: string | null;
  romanize: boolean;
  translateTo: string | null;
}

/** Bump when romanizer output changes, so stale cached romanizations are not reused. */
const ROMANIZER_VERSION = 5;
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

  // Already in the target language (Spotify's or the track's tag agrees with the script):
  // nothing to translate. Chinese is left to Google: simplified and traditional differ.
  const target = baseLang(req.translateTo);
  const lang = baseLang(req.language);
  const sameLanguage = !!req.translateTo && target !== 'zh' && lang === target &&
    (expectedScript([lang]) === script || (!expectedScript([lang]) && script === 'Latn'));

  // Shared Google call: translation (+ romanization when Google is the romanizer).
  let googleCall: Promise<GoogleResult> | null = null;
  let googleCallHasRm = false;
  let rmCall: Promise<GoogleResult> | null = null;
  const google = (wantRm: boolean) => {
    if (!googleCall) {
      googleCallHasRm = wantRm;
      googleCall = googleLines(lines, req.translateTo ?? 'en', wantRm, fetch, { translation: !!trKey && !sameLanguage });
      return googleCall;
    }
    // The shared call was made without romanization (the translation got there first, and
    // the script has a local romanizer): a caller that now needs Google's gets its own call,
    // never the shared one, which would answer with nothing.
    if (wantRm && !googleCallHasRm) return (rmCall ??= googleLines(lines, req.translateTo ?? 'en', true, fetch, { translation: false }));
    return googleCall;
  };
  const googleRomanizes = GOOGLE_PREFERRED.has(script);

  const romanized = req.romanize
    ? once(rmKey, async (): Promise<{ out: (string | null)[]; incomplete: boolean }> => {
        const cached = await cacheGet<(string | null)[]>(rmKey);
        if (cached) return { out: cached, incomplete: false };
        const { lines: out, complete } = await romanizeLinesDetailed(lines, script, {
          google: async (subset) => {
            // Google romanizes the whole song in the same request as the translation.
            const all = await google(true);
            // The backup has no romanization: Google is unreachable for that, so nothing
            // second-best is cached.
            if (all.backup) throw new RateLimited('Google Translate is rate-limiting this network');
            return subset.map((l) => all.romanized[lines.indexOf(l)] ?? null);
          },
        });
        // Stopgaps (transliteration, unread kanji, Google unreachable) are retried next time,
        // and so is an answer with nothing in it for a song that has words to romanize.
        const empty = script !== 'Latn' && lines.some((l) => /\p{L}/u.test(l)) && !out.some(Boolean);
        if (complete && !empty) await cacheSet(rmKey, out, ROMANIZED_TTL);
        return { out, incomplete: !complete || empty };
      })
    : Promise.resolve(null);

  const translated = trKey && !sameLanguage
    ? once(trKey, async () => {
        const cached = await cacheGet<string[]>(trKey);
        if (cached) return cached;
        const out = (await google(req.romanize && googleRomanizes)).translated.map(sentenceCase);
        await cacheSet(trKey, out, TRANSLATED_TTL);
        return out;
      })
    : Promise.resolve(null);

  const [r, t] = await Promise.allSettled([romanized, translated]);
  if (r.status === 'rejected' && t.status === 'rejected') throw r.reason;
  return {
    script,
    romanized: r.status === 'fulfilled' ? r.value?.out ?? null : null,
    // A stopgap romanization (Google unreachable, an unread kanji): the page asks again later.
    ...(r.status === 'fulfilled' && r.value?.incomplete ? { incomplete: true } : {}),
    translated: t.status === 'fulfilled' ? t.value?.map((x, i) => (x && x !== lines[i].trim() ? x : null)) ?? null : null,
    ...(t.status === 'rejected' ? { translateError: String((t.reason as Error)?.message || t.reason) } : {}),
  };
}
