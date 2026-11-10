// Live-test driver for Chrome (branded Chrome ignores --load-extension since v137, and
// Chrome for Testing has no Widevine, so Spotify cannot play there).
//
// Starts Google Chrome with the test profile (.live/chrome-profile) over a debugging pipe,
// loads the unpacked extension through CDP, and serves commands on 127.0.0.1:9444 until
// stopped. Use tools/live/ctl.mjs to talk to it.
//
//   node tools/live/driver.mjs [extensionDir]     (default: .output/chrome-mv3)
//
// Sign-in: Spotify refuses a remote-controlled browser at login, so sign the profile in
// once with plain Chrome:  open -na "Google Chrome" --args --user-data-dir=$PWD/.live/chrome-profile
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const root = path.resolve(import.meta.dirname, '../..');
const extDir = path.resolve(root, process.argv[2] || '.output/chrome-mv3');
const PORT = 9444;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  userDataDir: path.join(root, '.live/chrome-profile'),
  headless: false,
  pipe: true,
  enableExtensions: true,
  defaultViewport: null,
  args: ['--no-first-run', '--no-default-browser-check', '--window-size=1400,950', '--autoplay-policy=no-user-gesture-required'],
});

let extId = null;
async function install() {
  if (extId) await browser.uninstallExtension(extId).catch(() => {});
  extId = await browser.installExtension(extDir);
  return extId;
}
await install();

const logs = [];
function watch(page) {
  page.on('console', (m) => {
    logs.push(`[${m.type()}] ${m.text()}`.slice(0, 600));
    if (logs.length > 4000) logs.splice(0, 1000);
  });
}

async function spotifyPage() {
  const pages = await browser.pages();
  const host = (p) => { try { return new URL(p.url()).hostname; } catch { return ''; } };
  let page = pages.find((p) => host(p) === 'open.spotify.com');
  if (!page) {
    page = pages[0] ?? (await browser.newPage());
    watch(page);
    await page.goto('https://open.spotify.com/', { waitUntil: 'domcontentloaded' });
  }
  if (!page.__watched) { watch(page); page.__watched = true; }
  return page;
}
// A tab restored at startup loaded before the extension: reload it.
await (await spotifyPage()).reload({ waitUntil: 'domcontentloaded' });

async function workerTarget() {
  const targets = browser.targets();
  return targets.find((t) => t.type() === 'service_worker' && t.url().includes(extId));
}

const handlers = {
  async eval({ js }) {
    const page = await spotifyPage();
    return page.evaluate(`(async () => { return (${js}); })()`);
  },
  async sw({ js }) {
    const t = await workerTarget();
    if (!t) throw new Error('no extension service worker');
    const w = await t.worker();
    return w.evaluate(`(async () => { return (${js}); })()`);
  },
  async shot({ file, selector }) {
    const page = await spotifyPage();
    const out = path.resolve(file || path.join(root, '.live/shot.png'));
    if (selector) {
      const el = await page.$(selector);
      if (!el) throw new Error(`no element ${selector}`);
      await el.screenshot({ path: out });
    } else await page.screenshot({ path: out });
    return out;
  },
  /**
   * Records what the screen shows while `js` runs in the page: CDP screencast frames for `ms`
   * milliseconds, saved as JPEGs in `dir` (named by ms since the start). For pop-in and
   * animation checks that DOM reads can't see (e.g. during Spotify's view transitions).
   */
  async frames({ js, click, clicks, ms = 800, dir }) {
    const page = await spotifyPage();
    const out = path.resolve(dir || path.join(root, '.live/frames'));
    fs.mkdirSync(out, { recursive: true });
    for (const f of fs.readdirSync(out)) if (f.endsWith('.jpg')) fs.unlinkSync(path.join(out, f));
    const cdp = await page.createCDPSession();
    const got = [];
    let t0 = 0;
    cdp.on('Page.screencastFrame', (f) => {
      got.push({ at: f.metadata.timestamp * 1000, data: f.data });
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1400, everyNthFrame: 1 });
    await new Promise((r) => setTimeout(r, 300));
    t0 = Date.now();
    // A real mouse click ({x, y}), e.g. on our controls in their closed shadow root; or page js.
    // Or several ({x, y, wait}: ms to wait before that click).
    if (clicks) for (const c of clicks) { await new Promise((r) => setTimeout(r, c.wait ?? 0)); await page.mouse.click(c.x, c.y); }
    else if (click) await page.mouse.click(click.x, click.y);
    else await page.evaluate(js);
    await new Promise((r) => setTimeout(r, ms));
    await cdp.send('Page.stopScreencast');
    await cdp.detach();
    const files = got.filter((f) => f.at >= t0 - 50).map((f) => {
      const name = `${String(Math.round(f.at - t0)).padStart(5, '0')}.jpg`;
      fs.writeFileSync(path.join(out, name), Buffer.from(f.data, 'base64'));
      return name;
    });
    return { dir: out, files };
  },
  async click({ selector }) {
    const page = await spotifyPage();
    await page.click(selector);
    return 'clicked';
  },
  async clickAt({ x, y }) {
    const page = await spotifyPage();
    await page.mouse.click(x, y);
    return 'clicked';
  },
  async key({ key }) {
    const page = await spotifyPage();
    await page.keyboard.press(key);
    return 'pressed';
  },
  async goto({ url }) {
    const page = await spotifyPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return page.url();
  },
  async reload({ ext }) {
    if (ext) await install();
    const page = await spotifyPage();
    await page.reload({ waitUntil: 'domcontentloaded' });
    return { extId, url: page.url() };
  },
  async logs({ match, n }) {
    const re = match ? new RegExp(match) : null;
    return logs.filter((l) => !re || re.test(l)).slice(-(n || 80));
  },
  async clearLogs() { logs.length = 0; return 'ok'; },
  async url() { return (await spotifyPage()).url(); },
  async targets() { return { extId, targets: browser.targets().map((t) => `${t.type()} ${t.url().slice(0, 120)}`) }; },
  /** Screenshots a page in a separate tab (e.g. the popup: {"url":"popup"}), then closes it. */
  async shotTab({ url, file, width = 360, height = 600 }) {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width, height, deviceScaleFactor: 2 });
      await page.goto(url === 'popup' ? `chrome-extension://${extId}/popup.html` : url, { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 500));
      const out = path.resolve(file || path.join(root, '.live/tab.png'));
      await page.screenshot({ path: out, fullPage: true });
      return out;
    } finally {
      await page.close();
    }
  },
  /** Evaluates js in a separate tab at url (e.g. chrome://extensions), then closes it. */
  async inTab({ url, js, wait }) {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'load' });
      if (wait) await new Promise((r) => setTimeout(r, wait));
      return await page.evaluate(`(async () => { return (${js}); })()`);
    } finally {
      await page.close();
    }
  },
  async quit() { setTimeout(() => browser.close().then(() => process.exit(0)), 50); return 'bye'; },
};

http.createServer(async (req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    try {
      const { cmd, ...args } = JSON.parse(body || '{}');
      const fn = handlers[cmd];
      if (!fn) throw new Error(`unknown command ${cmd}`);
      const out = await fn(args);
      res.end(JSON.stringify({ ok: true, out }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e?.stack || e) }));
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`driver ready on ${PORT}, extension ${extId} from ${extDir}`));

browser.on('disconnected', () => process.exit(0));
fs.writeFileSync(path.join(root, '.live/driver.pid'), String(process.pid));
