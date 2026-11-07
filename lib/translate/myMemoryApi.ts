/**
 * MyMemory expects an explicit source language or the literal 'Autodetect'.
 * The source 'auto' is rejected (HTTP 200 with responseStatus "403").
 */
export function toMyMemorySource(sourceLang?: string | null): string {
  if (!sourceLang || sourceLang === 'auto') return 'Autodetect';
  return sourceLang;
}

export async function myMemoryTranslate(
  text: string,
  targetLang: string,
  sourceLang: string = 'auto',
): Promise<string> {
  const params = new URLSearchParams({
    q: text,
    langpair: `${toMyMemorySource(sourceLang)}|${targetLang}`,
  });
  const res = await fetch(`https://api.mymemory.translated.net/get?${params}`);
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);

  const data = (await res.json()) as {
    // MyMemory sends a number on success but a string ("403") on errors.
    responseStatus: number | string;
    responseData?: { translatedText?: string };
    responseDetails?: string;
    quotaFinished?: boolean;
  };

  if (data.quotaFinished) throw new Error('MyMemory daily quota exhausted');
  if (Number(data.responseStatus) !== 200) {
    throw new Error(`MyMemory status ${data.responseStatus}${data.responseDetails ? `: ${data.responseDetails}` : ''}`);
  }
  const translated = data.responseData?.translatedText;
  if (typeof translated !== 'string' || !translated.trim()) throw new Error('MyMemory empty translation');
  if (/^MYMEMORY WARNING/i.test(translated)) throw new Error('MyMemory quota warning');
  return translated;
}
