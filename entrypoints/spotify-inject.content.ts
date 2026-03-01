/**
 * spotify-inject.content.ts
 *
 * Runs in the ISOLATED world at document_start. Injects fetchInterceptor.js
 * into the page's MAIN world via a <script src="chrome-extension://..."> tag.
 *
 * script.textContent (inline) cannot be used — Spotify's CSP blocks 'unsafe-inline'
 * but explicitly whitelists the extension's chrome-extension:// origin in script-src,
 * so loading by URL is the only CSP-compliant injection path.
 *
 * The extension file is local (no network round-trip), so it loads far faster
 * than Spotify's own service-worker-cached scripts, reliably winning the race.
 */
export default defineContentScript({
    matches: ['*://open.spotify.com/*'],
    runAt: 'document_start',

    main() {
        const script = document.createElement('script');
        script.src = browser.runtime.getURL('/fetchInterceptor.js');
        (document.documentElement ?? document.head).prepend(script);
        script.onload = () => script.remove();
    },
});
