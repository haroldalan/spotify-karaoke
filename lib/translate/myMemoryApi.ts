export async function myMemoryTranslate(text: string, targetLang: string): Promise<string> {
  const params = new URLSearchParams({
    q: text,
    langpair: `auto|${targetLang}`,
  });
  // SLY FIX (Bug 25): MyMemory prefers %20 over + for query spaces to avoid ambiguity.
  const queryString = params.toString().replace(/\+/g, '%20');
  const res = await fetch(`https://api.mymemory.translated.net/get?${queryString}`);
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);

  const data = (await res.json()) as {
    responseStatus: number;
    responseData: { translatedText: string };
    quotaFinished?: boolean;
  };

  if (data.quotaFinished) throw new Error('MyMemory daily quota exhausted');
  if (data.responseStatus !== 200) throw new Error(`MyMemory status ${data.responseStatus}`);
  return data.responseData.translatedText;
}
