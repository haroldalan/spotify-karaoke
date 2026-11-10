// Backup translation: the endpoint behind Google's "translate this website" widget
// (translate-pa.googleapis.com/v1/translateHtml), as Traduzir Páginas Web uses it. Used only
// while the main endpoint (google.ts, client=gtx) is paused. Translation only: it has no
// romanization.
//
// The widget's API key is public: Google's widget script carries it for every website that
// embeds the widget. It is read from that script (browser-cached for a year) when first
// needed. The endpoint answers any origin (CORS), so it needs no host permission.
import { RateLimited } from './googleErrors';

const ENDPOINT = 'https://translate-pa.googleapis.com/v1/translateHtml';
const WIDGET_SCRIPT =
  'https://translate.googleapis.com/_/translate_http/_/js/k=translate_http.tr.en_US.YusFYy3P_ro.O/am=AAg/d=1/exm=el_conf/ed=1/rs=AN8SPfq1Hb8iJRleQqQc8zhdzXmF9E56eQ/m=el_main';
const MAX_LINES = 100;
const MAX_CHARS = 5000;

let key: string | null = null;
let blockedUntil = 0;
let strikes = 0;

/** When the widget endpoint may be asked again (0: now). */
export function widgetBlockedUntil(): number {
  return blockedUntil > Date.now() ? blockedUntil : 0;
}

/** For tests. */
export function resetWidget() {
  key = null;
  blockedUntil = 0;
  strikes = 0;
}

function pause(): never {
  strikes++;
  blockedUntil = Date.now() + Math.min(30, 2 ** (strikes - 1)) * 60_000;
  throw new RateLimited('Google Translate (website widget) is rate-limiting this network');
}

async function widgetKey(fetchImpl: typeof fetch): Promise<string> {
  if (key) return key;
  const res = await fetchImpl(WIDGET_SCRIPT, { redirect: 'manual' });
  if (!res.ok) throw new Error(`Google's widget script: HTTP ${res.status || 'redirect'}`);
  const found = (await res.text()).match(/['"]x-goog-api-key['"]\s*:\s*['"](\w{39})['"]/i);
  if (!found) throw new Error("Google's widget script has no key");
  return (key = found[1]);
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function batches(lines: string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const l of lines) {
    if (cur.length && (cur.length >= MAX_LINES || len + l.length > MAX_CHARS)) { out.push(cur); cur = []; len = 0; }
    cur.push(l);
    len += l.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function send(batch: string[], target: string, fetchImpl: typeof fetch, retried = false): Promise<string[]> {
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json+protobuf', 'x-goog-api-key': await widgetKey(fetchImpl) },
    body: JSON.stringify([[batch.map(escapeHtml), 'auto', target], 'te']),
    redirect: 'manual',
  });
  if (res.status === 429 || res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) pause();
  // A key Google has replaced: read the script again, once.
  if ((res.status === 400 || res.status === 403) && !retried) {
    key = null;
    return send(batch, target, fetchImpl, true);
  }
  if (!res.ok) throw new Error(`Google Translate (website widget) HTTP ${res.status}`);
  const j = (await res.json()) as [string[]?, string[]?];
  const out = j?.[0];
  if (!Array.isArray(out) || out.length !== batch.length) throw new Error('Google Translate (website widget): unexpected answer');
  return out.map((t) => unescapeHtml(String(t ?? '')).trim());
}

/**
 * Translates lines, one result per line ('' for an empty line). Any failure (rate limit, no
 * key, an answer we can't read) pauses the backup like a rate limit: it is never asked song
 * after song while it doesn't work.
 */
export async function widgetTranslate(lines: string[], target: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  if (Date.now() < blockedUntil) throw new RateLimited('Google Translate (website widget) is rate-limiting this network');
  try {
    return await translateAll(lines, target, fetchImpl);
  } catch (e) {
    if (!(e instanceof RateLimited)) {
      strikes++;
      blockedUntil = Date.now() + Math.min(30, 2 ** (strikes - 1)) * 60_000;
    }
    throw e;
  }
}

async function translateAll(lines: string[], target: string, fetchImpl: typeof fetch): Promise<string[]> {
  const idx = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  const out = lines.map(() => '');
  let at = 0;
  for (const batch of batches(idx.map((i) => lines[i].trim()))) {
    const tr = await send(batch, target, fetchImpl);
    tr.forEach((t, k) => (out[idx[at + k]] = t));
    at += batch.length;
  }
  strikes = 0;
  return out;
}
