// Records the request headers Chrome actually sends on the extension's own Google Translate
// request (after the declarativeNetRequest rules), in a throwaway profile.
//
//   node tools/live/headers.mjs [extensionDir]     (default: .output/chrome-mv3)
//
// Sends one real request (a two-word Arabic phrase) to translate.googleapis.com, from the
// extension's service worker: run it rarely, and not while Google is refusing the network.
// Prints rule 103 as installed, Google's answer, and the headers on the wire.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root = path.resolve(import.meta.dirname, '../..');
const extDir = path.resolve(root, process.argv[2] || '.output/chrome-mv3');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-headers-'));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  userDataDir: profile,
  headless: false,
  pipe: true,
  enableExtensions: true,
  args: ['--no-first-run', '--no-default-browser-check'],
});
try {
  const id = await browser.installExtension(extDir);
  const worker = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${id}/`), { timeout: 15000 });
  const cdp = await worker.createCDPSession();
  await cdp.send('Network.enable');
  const wire = [];
  cdp.on('Network.requestWillBeSentExtraInfo', (e) => { if (/translate/.test(e.headers[':authority'] ?? '')) wire.push(e.headers); });
  const evaluate = async (expression) => (await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  let rule = null;
  for (let i = 0; i < 30 && !rule; i++) {
    rule = await evaluate(`chrome.declarativeNetRequest.getSessionRules().then((r) => r.find((x) => x.id === 103) ?? null)`);
    if (!rule) await new Promise((r) => setTimeout(r, 300));
  }
  console.log('rule 103:', JSON.stringify(rule));
  const answer = await evaluate(`fetch('https://translate.googleapis.com/translate_a/single?client=at&sl=auto&tl=en&dj=1&dt=t&dt=rm', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ q: 'مرحبا بالعالم' }).toString(), redirect: 'manual',
  }).then(async (r) => r.status + ' ' + (await r.text()).slice(0, 160))`);
  await new Promise((r) => setTimeout(r, 500));
  console.log('answer:', answer);
  for (const h of wire) {
    const pick = Object.fromEntries(Object.entries(h).filter(([k]) => /^(:path|origin|referer|user-agent|x-browser-.*|sec-fetch-site)$/.test(k)));
    console.log('on the wire:', JSON.stringify(pick, null, 1));
  }
} finally {
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
