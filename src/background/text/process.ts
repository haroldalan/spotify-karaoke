// Romanize and/or translate a song's lines, with caching. One Google request serves both
// when the script needs Google's romanization and a translation is wanted.
import { isEnglishLine } from '../../shared/english';
import type { Processed } from '../../shared/types';
import { hash } from '../../shared/hash';
import { cacheGet, cacheSet, once } from '../cache';
import { RateLimited, googleLines, type GoogleResult } from './google';
import { GOOGLE_PREFERRED, romanizeLinesDetailed } from './romanize';
import { expectedScript, lineHas, songScript } from '../../shared/scripts';

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
  // Not when some lines are English and translations go into another language: a Korean song
  // with English verses still has lines to translate (decided by the lines, not the song).
  const sameLanguage = !!req.translateTo && target !== 'zh' && lang === target &&
    (expectedScript([lang]) === script || (!expectedScript([lang]) && script === 'Latn')) &&
    (target === 'en' || !lines.some(isEnglishLine));

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
            // Its romanization lost the line breaks: a stopgap now (not cached), Google next time.
            if (all.romanizationLost) throw new Error("Google's romanization couldn't be put back line by line");
            // A run that is a whole line: from that answer. Runs that are part of a line (an
            // Arabic phrase in a French line): one more request for all of them, never one each.
            const trimmed = lines.map((l) => l.trim());
            const out = subset.map((l) => { const i = trimmed.indexOf(l.trim()); return i >= 0 ? all.romanized[i] ?? null : undefined; });
            const parts = subset.filter((_, k) => out[k] === undefined);
            if (parts.length) {
              const more = await googleLines(parts, req.translateTo ?? 'en', true, fetch, { translation: false });
              if (more.romanizationLost) throw new Error("Google's romanization couldn't be put back line by line");
              let q = 0;
              out.forEach((v, k) => { if (v === undefined) out[k] = more.romanized[q++] ?? null; });
            }
            return out as (string | null)[];
          },
        });
        // Stopgaps (transliteration, unread kanji, Google unreachable) are retried next time,
        // and so is an answer with nothing in it for a song that has words to romanize.
        const empty = script !== 'Latn' && lines.some((l) => /\p{L}/u.test(l)) && !out.some(Boolean);
        if (complete && !empty) await cacheSet(rmKey, out, ROMANIZED_TTL);
        return { out, incomplete: !complete || empty };
      })
    : Promise.resolve(null);

  // Google detects one language for the whole request: a song sung mostly in English comes
  // back with its Korean words left as they were ("Don't want no riddle, 말해줘"). Lines in the
  // song's own script that came back unchanged are asked once more, from the song's language.
  // Only that script's lines: a Hindi line in a Tamil song isn't Tamil.
  const own = expectedScript([lang]);
  const unchangedIn = (tr: string[]) =>
    own ? lines.map((_, i) => i).filter((i) => lineHas(lines[i], own) && (!tr[i] || tr[i].trim().toLowerCase() === lines[i].trim().toLowerCase())) : [];
  /** 'done': asked (whether or not anything changed); 'failed': not asked, worth another try. */
  const repair = async (tr: string[]): Promise<'none' | 'done' | 'failed'> => {
    const unchanged = unchangedIn(tr);
    if (!unchanged.length || !lang) return 'none';
    try {
      const more = await googleLines(unchanged.map((i) => lines[i]), req.translateTo ?? 'en', false, fetch, { source: lang });
      if (more.incomplete) return 'failed';
      unchanged.forEach((i, k) => { if (more.translated[k]) tr[i] = sentenceCase(more.translated[k]); });
      return 'done';
    } catch {
      return 'failed'; // the first answer stands, and the repair is tried again next play
    }
  };
  const fixKey = trKey ? `fix:${trKey}` : null;

  const translated = trKey && !sameLanguage
    ? once(trKey, async () => {
        const cached = await cacheGet<string[]>(trKey);
        if (cached) {
          // Kept from before this repair existed: repaired once (marked, so not on every play).
          if (fixKey && unchangedIn(cached).length && !(await cacheGet<boolean>(fixKey))) {
            const out = [...cached];
            if ((await repair(out)) === 'done') {
              await cacheSet(trKey, out, TRANSLATED_TTL);
              await cacheSet(fixKey, true, TRANSLATED_TTL);
            }
            return out;
          }
          return cached;
        }
        const res = await google(req.romanize && googleRomanizes);
        const out = res.translated.map(sentenceCase);
        const fixed = await repair(out);
        // Lines left without a translation: shown as they are, and asked again another time.
        // A repair that couldn't be asked is tried again on the next play (no marker).
        if (!res.incomplete) {
          await cacheSet(trKey, out, TRANSLATED_TTL);
          if (fixKey && fixed !== 'failed') await cacheSet(fixKey, true, TRANSLATED_TTL);
        }
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
