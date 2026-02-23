/**
 * spotify-inject.content.ts — runs at document_start (before Spotify's app boots).
 *
 * Its sole job is to inject fetchInterceptor.js into the page's main world so
 * that window.fetch is patched before Spotify makes its first color-lyrics API
 * call. Content scripts live in an isolated world and cannot patch window.fetch
 * directly — injecting a <script> tag is the standard cross-browser workaround.
 */
export default defineContentScript({
    matches: ['*://open.spotify.com/*'],
    runAt: 'document_start',

    main() {
        const script = document.createElement('script');
        script.src = browser.runtime.getURL('/fetchInterceptor.js');
        (document.documentElement ?? document).prepend(script);
        script.onload = () => script.remove();
    },
});
