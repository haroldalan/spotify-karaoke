export async function googleTranslate(
  text: string,
  targetLang: string,
  includeRomanization: boolean
): Promise<{ translated: string; romanized: string | null }> {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
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
          Referer: 'https://translate.google.com/',
          Accept: 'application/json',
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
  // the LAST element of data[0], shaped: [null, null, null, "line1\nline2\n..."]
  // All normal translation segments are shaped: ["translated", "original", ...]
  // data[8] is the language detection array — NOT romanization — and contains
  // null entries that would throw if we tried to iterate it. Never touch it.
  let segments = allSegments;
  let romanized: string | null = null;

  if (
    includeRomanization &&
    allSegments.length > 0 &&
    allSegments[allSegments.length - 1][0] === null &&
    allSegments[allSegments.length - 1][1] === null &&
    typeof allSegments[allSegments.length - 1][3] === 'string'
  ) {
    const last = allSegments[allSegments.length - 1];
    romanized = (last[3] as string | null | undefined) ?? null;
    // Exclude the romanization block so it doesn't pollute the translated text
    segments = allSegments.slice(0, -1);
  }

  const translated = segments.map((s) => (s[0] ?? '') as string).join('');
  if (!translated.trim()) {
    throw new Error('Google Translate returned empty response');
  }

  return { translated, romanized };
}
