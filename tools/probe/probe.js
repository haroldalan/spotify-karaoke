// Records network traffic from page start: window.__probe.log (urls), .bodies (selected responses).
(() => {
  const P = (window.__probe = { log: [], bodies: [], ws: [], rules: [], meta: [], cl: [] });
  if (localStorage.getItem('__probeRewrite') === '1') P.rules.push(
    { match: 'metadata/4/track/', fn: async (res, url) => {
        if (!res.ok) return null;
        const j = await res.json(); P.meta.push({ url: url.slice(0, 90), has: j.has_lyrics, name: j.name });
        j.has_lyrics = true;
        return new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } }); } },
    { match: 'color-lyrics/v2/track/', fn: async (res, url) => {
        P.cl.push({ url: url.slice(0, 90), status: res.status });
        if (res.ok) return null;
        const lines = Array.from({ length: 50 }, (_, i) => ({ startTimeMs: String(i * 5000 + 1000), words: 'テスト ' + i + ' 行目のまどろみ', syllables: [], endTimeMs: '0', transliteratedWords: '' }));
        const body = { lyrics: { syncType: 'LINE_SYNCED', lines, provider: 'sk', providerLyricsId: '1', providerDisplayName: 'SK Test', syncLyricsUri: '', isDenseTypeface: false, alternatives: [], language: 'ja', isRtlLanguage: false, capStatus: 'UNCAPPED', previewLines: lines.slice(0, 3), translationLanguages: [] }, colors: { background: -11908534, text: -16777216, highlightText: -1 }, hasVocalRemoval: false };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); } });
  const KEEP = /color-lyrics|pathfinder|metadata\/4|lyrics|track-playback|connect-state|melody/;
  const push = (arr, v, cap = 3000) => { arr.push(v); if (arr.length > cap) arr.splice(0, 500); };

  // Experiment (localStorage.__skProbeExp = '1'): claim lyrics for tracks without them and answer
  // Spotify's lyrics request ourselves.
  const EXP = (() => { try { return localStorage.__skProbeExp === '1'; } catch { return false; } })();
  const fakeLines = () => Array.from({ length: 30 }, (_, i) => ({ startTimeMs: String(2000 + i * 4000), words: `テスト行 ${i + 1} — sk-next test line`, syllables: [], endTimeMs: '0', transliteratedWords: '' }));
  if (EXP) P.rules.push(
    { match: 'spclient\\.wg\\.spotify\\.com/metadata/4/track/', fn: async (res) => {
        if (!res.ok) return null;
        const j = await res.json();
        if (j.has_lyrics) return null;
        j.has_lyrics = true;
        P.expMeta = (P.expMeta || 0) + 1;
        return new Response(JSON.stringify(j), { status: 200, headers: res.headers });
      } },
    { match: 'spclient\\.wg\\.spotify\\.com/color-lyrics/v2/track/', fn: async (res, url) => {
        if (res.status !== 404) return null;
        P.expLyrics = (P.expLyrics || 0) + 1;
        const body = { lyrics: { syncType: 'LINE_SYNCED', lines: fakeLines(), provider: 'sk-next', providerLyricsId: '0', providerDisplayName: 'Test lines', syncLyricsUri: '', isDenseTypeface: false, alternatives: [], language: 'ja', isRtlLanguage: false, capStatus: 'NONE', previewLines: [], translationLanguages: [] }, colors: { background: -11184811, text: -16777216, highlightText: -1 }, hasVocalRemoval: false };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      } },
  );
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init && init.method) || (input && input.method) || 'GET';
    let reqBody = null;
    try { if (init && typeof init.body === 'string') reqBody = init.body.slice(0, 3000); } catch {}
    const t = performance.now();
    // Optional rewrite rules installed from the driver: { match: RegExp source, status, body }
    for (const r of P.rules) {
      if (new RegExp(r.match).test(url)) {
        const real = await origFetch.apply(this, arguments);
        const out = typeof r.fn === 'function' ? await r.fn(real.clone(), url) : null;
        push(P.log, { t: Math.round(t), method, url: url.slice(0, 300), status: real.status, rewritten: !!out });
        if (out) return out;
        return real;
      }
    }
    const res = await origFetch.apply(this, arguments);
    push(P.log, { t: Math.round(t), method, url: url.slice(0, 300), status: res.status });
    if (KEEP.test(url)) {
      res.clone().text().then((b) => push(P.bodies, { t: Math.round(t), url, method, reqBody, status: res.status, body: b.slice(0, 200000) }, 300)).catch(() => {});
    }
    return res;
  };
  const OrigWS = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
    ws.addEventListener('message', (e) => {
      if (typeof e.data === 'string' && /has_lyrics|lyrics/.test(e.data)) push(P.ws, { t: Math.round(performance.now()), data: e.data.slice(0, 20000) }, 200);
    });
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { push(P.log, { t: Math.round(performance.now()), method: m, url: String(u).slice(0, 300), xhr: true }); return origOpen.apply(this, arguments); };
})();
