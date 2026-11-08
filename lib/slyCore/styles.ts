// Port of: lyric-test/modules/core/styles.js
/* modules/dom-styles.js: CSS Styles for the custom lyrics UI */

/**
 * Returns the full CSS string for the custom lyrics UI.
 * Called as a function (not a constant) so that SPOTIFY_CLASSES values
 * are read at injection time, after slyScavengeClasses() has run.
 */
export function slyGetCoreStyles(): string {
  return `
        main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}.sly-active {
            /* No hardcoded background - allow mirroring to handle it */
        }

        :is(#lyrics-root-sync, [data-sly-root-leaving]) .${window.SPOTIFY_CLASSES?.lineBase || 'WnslfFBWTgOIUgNH'} {
            transition: color 0.1s ease-out, opacity 0.1s ease-out !important;
        }
        :is(#lyrics-root-sync, [data-sly-root-leaving]) {
            transition: background-color 0.4s cubic-bezier(0.3, 0, 0, 1) !important;
        }
        /* No themed lyrics panel (e.g. a track without Spotify lyrics): the root covers the
           overlay's content (artwork) but stays below its header (z-index 4) and inside the
           overlay's stacking context, so the player bar is never covered. */
        /* Spotify's media switch in its expanded Now Playing view (see lyricsChip.ts): our
           Lyrics button stands in for Spotify's disabled one, and another media option
           steps our lyrics aside. */
        :is(#lyrics-root-sync, [data-sly-root-leaving]).sly-stepped-aside { display: none !important; }
        /* The playing track's lyrics are ours (takeoverEngine): Spotify's panel, when the
           view is reopened, stays invisible for its first moments so ours replace it unseen.
           Fail-safe: it becomes visible after 0.8 s if ours do not come. The previous song's
           panel, sliding out, is not held (it vanished mid-slide, live 2026-11-08). */
        html[data-sly-takeover-uri] [data-testid="root"] > div > div:has(button[role="radio"][value="lyrics"]) div[style*="--lyrics-color-active"]:not(#lyrics-root-sync):not(#Desktop_PanelContainer_Id *):not([data-sly-root-leaving]):not([data-sly-leaving] *) {
            animation: sly-takeover-hold 0.8s steps(1, end);
        }
        @keyframes sly-takeover-hold { from { visibility: hidden; } to { visibility: visible; } }
        /* Our lyrics in Spotify's slot (domEngine placeInOverlaySlot): the artwork container
           stays as the panel's spacer and the cards collapse, as in Spotify's lyrics view. */
        /* The previous song's slide while Spotify slides it out (songTransition.ts): with a
           still copy of our lyrics on it, Spotify's panel under the copy stays hidden. */
        [data-sly-leaving="ours"] div[style*="--lyrics-color-active"]:not([data-sly-root-leaving]):not([data-sly-root-leaving] *) { visibility: hidden !important; }
        [data-sly-leaving="ours"] [data-sly-hide="content"] > * { visibility: hidden !important; }
        .sly-lyrics-on [data-sly-hide="content"] > * { visibility: hidden !important; }
        .sly-lyrics-on [data-sly-hide="collapse"] { display: none !important; }
        button[role="radio"][value="lyrics"]:disabled:has(+ #sly-lyrics-chip) { display: none !important; }
        :is(#lyrics-root-sync, [data-sly-root-leaving]).sly-root-overlay {
            position: absolute !important; inset: 0 !important; z-index: 3 !important;
            min-height: 0 !important; height: auto !important; overflow-y: auto !important; box-sizing: border-box;
            background-color: var(--lyrics-color-background, var(--background-base, #121212));
        }
        :is(#lyrics-root-sync, [data-sly-root-leaving]) .${window.SPOTIFY_CLASSES?.paddingLineHelper || 'aLaX8poOH8kdbmGf'} {
            height: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important;
            overflow: hidden !important; border: none !important;
        }
        #sly-sync-button {
            position: fixed; left: 50%; transform: translateX(-50%); z-index: 100000;
            cursor: pointer; transition: transform 0.2s cubic-bezier(0.3, 0, 0, 1), opacity 0.2s ease, visibility 0.2s ease;
            visibility: hidden; opacity: 0; border: none; background: none; padding: 0;
            width: max-content !important; min-width: max-content !important;
            white-space: nowrap !important; flex-wrap: nowrap !important;
        }
        #sly-sync-button.visible { visibility: visible; opacity: 1; }
        #sly-sync-button { border-radius: 500px; display: flex; align-items: center; justify-content: center; }
        #sly-sync-button > span {
            display: inline-flex !important; align-items: center; justify-content: center;
            width: max-content !important; min-width: max-content !important;
            white-space: nowrap !important; flex-wrap: nowrap !important;
        }
        #sly-sync-button .encore-button__icon-wrapper { flex: 0 0 auto; }
        #sly-sync-button:hover { transform: translateX(-50%) scale(1.04) !important; opacity: 0.95 !important; }
        #sly-sync-button:active { transform: translateX(-50%) scale(0.98); }

        #sly-status-hud {
            display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start;
            padding: 80px 64px; text-align: left; 
            color: var(--text-base, #ffffff); 
            width: 100%; min-height: 500px; height: 100%;
            position: absolute; inset: 0; z-index: 10000;
            overflow: hidden; background-color: var(--background-base, #121212);
            box-sizing: border-box;
            flex: 1;
            font-family: SpotifyMixUI, CircularSp-Arab, CircularSp-Hebr, CircularSp-Cyrl, CircularSp-Grek, CircularSp-Deva, sans-serif;
        }
        /* Base sly-active state: minimum interference with Spotify's main layout */
        main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}.sly-active {
            /* Inherit native layout unless HUD is active */
        }

        /* Lock the layout host's scrolling and force layout ONLY when HUD (Loading/Error) is active.
           The host is the themed lyrics panel's parent (legacy UI: main.<mainContainer>), so this
           is keyed on our own class only, not on a Spotify tag/class. */
        /* Not on Spotify's Now Playing overlay (the host when it shows no lyrics panel):
           it keeps its own layout, and our root is a positioned layer inside it. */
        .sly-hud-active:not([data-testid="root"] > div > div) {
            position: relative !important;
            display: flex !important;
            flex-direction: column !important;
            min-height: 500px !important;
            height: 100% !important;
            overflow: hidden !important;
        }



        /* Also hide native error messages if our HUD is present */
        main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}.sly-active .${window.SPOTIFY_CLASSES?.container || 'bbJIIopLxggQmv5x'}:not(#lyrics-root-sync) {
            display: none !important;
        }

        .sly-hud-bg-blur {
            position: absolute; inset: -10%;
            background-size: cover; background-position: center;
            filter: blur(60px) brightness(0.6) saturate(1.4);
            z-index: -1;
            transition: background-image 0.5s ease-in-out;
        }
        .sly-hud-overlay {
            position: absolute; inset: 0;
            background: linear-gradient(180deg, rgba(18,18,18,0) 0%, rgba(18,18,18,0.8) 100%);
            z-index: 0;
        }
        .sly-hud-container { position: relative; z-index: 1; box-sizing: border-box; width: 100%; }
        .sly-hud-brand { 
            text-transform: uppercase; letter-spacing: 0.15em; 
            color: var(--text-subdued, #b3b3b3);
            margin-bottom: 24px; font-weight: 700; font-size: 12px;
        }
        .sly-hud-message { 
            margin-bottom: 24px; line-height: 1.1; max-width: 800px; 
            font-size: clamp(2rem, 4vw, 3.5rem); font-weight: 700;
            letter-spacing: -0.04em;
            color: var(--text-base, #ffffff);
        }
        .sly-hud-subtext { 
            color: var(--text-subdued, #b3b3b3);
            margin-bottom: 40px; max-width: 600px; font-size: 1rem;
            line-height: 1.5;
        }
        
        .sly-hud-cta-wrapper { display: flex; justify-content: flex-start; }
        .sly-hud-cta-wrapper a { text-decoration: none !important; }

        .sly-hud-pulse {
            width: 40px; height: 40px; background-color: #1DB954; border-radius: 50%;
            animation: sly-pulse 1.5s infinite ease-in-out;
        }
        @keyframes sly-pulse {
            0% { transform: scale(0.8); opacity: 0.5; }
            50% { transform: scale(1.2); opacity: 1; }
            100% { transform: scale(0.8); opacity: 0.5; }
        }

        /* 2. ZERO-FLICKER HIJACK (Pre-Logic Shield)
           Hides the entire native lyrics container immediately if it detects an error child. 
           This happens via CSS before our JS engine can even process the event. */
        .${window.SPOTIFY_CLASSES?.container || 'bbJIIopLxggQmv5x'}:has(.${window.SPOTIFY_CLASSES?.errorContainer || 'hfTlyhd7WCIk9xmP'}) {
            opacity: 0 !important;
            pointer-events: none !important;
            transition: none !important;
        }

        /* Fallback for browsers with limited :has() support or specific node transitions */
        .${window.SPOTIFY_CLASSES?.errorContainer || 'hfTlyhd7WCIk9xmP'} { 
            opacity: 0 !important; 
            pointer-events: none !important; 
        }

        /* Seamless Hijack: Hide Spotify's native error container ONLY when we are active */
        main.${window.SPOTIFY_CLASSES?.mainContainer || 'J6wP3V0xzh0Hj_MS'}.sly-active .${window.SPOTIFY_CLASSES?.errorContainer || 'hfTlyhd7WCIk9xmP'} { 
            display: none !important; 
        }

        /* --- FALLBACK SPOTIFY CLONE STYLES --- */
        /* These styles are ONLY active if the deep scavenger fails or is pending (i.e. body has .sly-fallback). 
           This prevents them from unconditionally overriding Spotify's actual native CSS. */
        
        body.sly-fallback :is(#lyrics-root-sync, [data-sly-root-leaving]) .${window.SPOTIFY_CLASSES?.lineBase || 'WnslfFBWTgOIUgNH'} {
            font-family: SpotifyMixUITitle, CircularSp-Arab, CircularSp-Hebr, CircularSp-Cyrl, CircularSp-Grek, CircularSp-Deva, "Helvetica Neue", helvetica, arial, "Hiragino Sans", "Hiragino Kaku Gothic ProN", Meiryo, "MS Gothic", sans-serif;
            font-weight: 700;
            /* DNA-Matched Responsive Scaling: 32px at 800px width -> 48px at 1200px width */
            font-size: clamp(32px, 4vw, 48px);
            line-height: normal;
            letter-spacing: normal;
            padding: 8px 0;
            cursor: pointer;
            transform-origin: left center;
            transition: color 0.15s ease-out, transform 0.15s ease-out, opacity 0.15s ease-out !important;
            color: var(--lyrics-color-inactive, rgba(255, 190, 177, 1));
        }

        body.sly-fallback :is(#lyrics-root-sync, [data-sly-root-leaving]) .${window.SPOTIFY_CLASSES?.lineBase || 'WnslfFBWTgOIUgNH'}.${window.SPOTIFY_CLASSES?.passedLine || 'XiH9KR6bhDwEFykV'} {
            color: var(--lyrics-color-inactive, rgba(255, 190, 177, 1));
            opacity: 0.5;
        }

        body.sly-fallback :is(#lyrics-root-sync, [data-sly-root-leaving]) .${window.SPOTIFY_CLASSES?.lineBase || 'WnslfFBWTgOIUgNH'}.${window.SPOTIFY_CLASSES?.activeLine || 'RL7r4lsMHxMySdFr'} {
            color: var(--lyrics-color-active, #ffffff);
            transform: scale(1.02); /* Subtle native highlight pop */
        }

        body.sly-fallback :is(#lyrics-root-sync, [data-sly-root-leaving]) .${window.SPOTIFY_CLASSES?.lineBase || 'WnslfFBWTgOIUgNH'}.${window.SPOTIFY_CLASSES?.futureLine || 'Mnf9PkrVHsX90BNf'} {
            color: var(--lyrics-color-inactive, rgba(255, 190, 177, 1));
        }

        body.sly-fallback :is(#lyrics-root-sync, [data-sly-root-leaving]) .${window.SPOTIFY_CLASSES?.lineBase || 'WnslfFBWTgOIUgNH'}.${window.SPOTIFY_CLASSES?.unsynced || 'AQFBg9wNhDoKJHvS'} {
            color: var(--lyrics-color-inactive, rgba(255, 190, 177, 1));
            cursor: default;
        }

        body.sly-fallback :is(#lyrics-root-sync, [data-sly-root-leaving]) .${window.SPOTIFY_CLASSES?.attribution || 'NUBq_wlyuwoDUsSg'} {
            color: var(--lyrics-color-inactive, rgb(179, 179, 179));
            margin-top: 32px;
            font-family: SpotifyMixUI, CircularSp-Arab, CircularSp-Hebr, CircularSp-Cyrl, CircularSp-Grek, CircularSp-Deva, sans-serif;
            font-size: 0.88rem;
            font-weight: 400;
        }

        /* Ensure both CTA buttons have identical flexbox layouts, middle-alignment, and 14px font-size */
        #sly-status-hud .sly-hud-cta-wrapper a {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            box-sizing: border-box !important;
            min-height: 48px !important;
            font-size: 14px !important;
            text-align: center !important;
            line-height: normal !important;
            text-decoration: none !important;
        }
        #sly-status-hud .sly-hud-cta-wrapper a span {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            line-height: normal !important;
            font-size: 14px !important;
        }

        /* ─── Lyrics Shimmer (Stabilized) ──────────────────────────────────── */
        /* Reverted to line-based movement for reliability, but slowed down for smoothness */
        .sly-loading [data-testid="lyrics-line"] > div,
        .sly-loading .sly-main-line {
            background: linear-gradient(
                90deg,
                rgba(255, 255, 255, 0.25) 25%,
                rgba(255, 255, 255, 0.7) 50%,
                rgba(255, 255, 255, 0.25) 75%
            );
            background-size: 200% 100%;
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent !important;
            animation: sly-shimmer 2.2s infinite linear; /* Slower, linear sweep for stability */
            display: block !important;
            vertical-align: top !important;
        }

        /* Prevent dual-lyrics from vanishing by keeping the container background transparent-only for main-line */
        .sly-loading [data-testid="lyrics-line"] > div:has(.sly-main-line) {
            -webkit-text-fill-color: initial !important;
            background: none !important;
        }

        @keyframes sly-shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
    `;
}

window.slyGetCoreStyles = slyGetCoreStyles;
