export async function googleTranslate(
  text: string,
  targetLang: string,
  includeRomanization: boolean,
  sourceLang: string = 'auto'
): Promise<{ translated: string; romanized: string | null }> {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: sourceLang,
    tl: targetLang,
    q: text,
  });
  params.append('dt', 't');
  if (includeRomanization) params.append('dt', 'rm');

  let res: Response;
  try {
    res = await fetch(
      `https://translate.googleapis.com/translate_a/single?${params}`,
      {
        headers: {
          Accept: 'application/json',
          Referer: 'https://translate.google.com/',
        },
      }
    );
  } catch (err) {
    // Firefox TypeError on cross-origin, or network error
    throw new Error('Google network error or rate-limited');
  }

  if (res.status === 0 || !res.ok) {
    throw new Error(`Google HTTP ${res.status}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new Error('Google non-JSON (captcha)');

  const data = (await res.json()) as any[];
  const allSegments = ((data[0] as any[]) ?? []) as any[][];

  // When dt=rm is present, Google appends a special romanization block as
  // the LAST element of data[0], shaped:
  //   [null, null, <TARGET transliteration | null>, <SOURCE transliteration | null>]
  // Index 2 is the translation written in Latin letters (only present when the
  // target language has its own script, e.g. tl=hi/ja/ru). Index 3 is how the
  // SOURCE lyrics are pronounced — the only value usable as romanization.
  // All normal translation segments are shaped: ["translated", "original", ...]
  // data[8] is the language detection array — NOT romanization — and contains
  // null entries that would throw if we tried to iterate it. Never touch it.
  let segments = allSegments;
  let romanized: string | null = null;

  const lastBlock = allSegments[allSegments.length - 1];
  if (Array.isArray(lastBlock) && lastBlock[0] == null && lastBlock[1] == null) {
    // Romanization block: never part of the translation, whatever it contains.
    segments = allSegments.slice(0, -1);
    if (includeRomanization && typeof lastBlock[3] === 'string') {
      romanized = lastBlock[3];
    }
  }

  const translated = segments
    .map((s) => (Array.isArray(s) && typeof s[0] === 'string' ? s[0] : ''))
    .join('');

  return { translated, romanized };
}
