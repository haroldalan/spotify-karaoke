// Is a Latin-script lyric line English? Used per line where a song mixes languages: an
// English line in a Tamil or Korean song is correct in Latin script and is never "restored"
// to the song's script (lyric sites often write English lines in Tamil or Devanagari).
//
// A short list of the commonest English words, and lyric words, that are not also common
// romanized Hindi, Punjabi, Tamil, Telugu, Japanese or Korean words ("main", "to", "na",
// "hai", "nee", "naan", "kimi" are left out on purpose).

const WORDS = new Set(`
a about after again all always am an and any are around as at away baby back be because been
before being believe better between big body boy break bring but by call came can can't cause
change cold come could cry dance day did didn't do does don't done down dream dreams drive
every everything eyes face fall feel feeling feels find fire for forever free friend from fun
get girl give go god going gone gonna good got gotta had hand hands happy hard has have he
head heart heaven hello her here hey high him his hold home how i i'll i'm if in inside into
is it it's just keep kiss know last leave left let let's life light like little live long look
lose lost love made make man me mind mine more morning most my myself need never new next night
no not nothing now of off oh ok okay on one only open or other our out over party people place
play please pretty put rain ready real really right run said same say see seen she should show
side sky so some someone something sometimes soul stay still stop such sun sweet take talk tell
than that that's the their them then there these they thing things think this those through
till time tired together tonight too touch tried true try turn under until up us wait waiting
wake walk wanna want was way we well were what when where while who why will wish with without
woah won't world would yeah yes yet you you're your yours
`.trim().split(/\s+/));

const tokens = (line: string) => line.toLowerCase().normalize('NFKC').replace(/[’`]/g, "'").match(/[a-z']+/g) ?? [];

/** Share of a line's words that are common English words (0 when it has none). */
export function englishShare(line: string): number {
  const t = tokens(line).map((w) => w.replace(/^'+|'+$/g, '')).filter(Boolean);
  if (!t.length) return 0;
  return t.filter((w) => WORDS.has(w)).length / t.length;
}

/** A line that reads as English: at least half its words are common English words. */
export const isEnglishLine = (line: string) => englishShare(line) >= 0.5;
