// Port of: lyric-test/modules/core/styles.js
/* modules/dom-styles.js: CSS Styles for the custom lyrics UI */

declare global {
  interface Window {
    slyGetCoreStyles: () => string;
  }
}

/**
 * Returns the full CSS string for the custom lyrics UI.
 * Called as a function (not a constant) so that SPOTIFY_CLASSES values
 * are read at injection time, after slyScavengeClasses() has run.
 */
export function slyGetCoreStyles(): string {
  return `
        /* 1. SAFETY FLOOR: Prevents seeing the app content when native UI is hidden */
        main.J6wP3V0xzh0Hj_MS {
            background-color: #121212 !important;
        }

        #lyrics-root-sync .${window.SPOTIFY_CLASSES.lineBase} {
            transition: color 0.1s ease-out, opacity 0.1s ease-out !important;
        }
        #lyrics-root-sync .${window.SPOTIFY_CLASSES.paddingLineHelper} {
            height: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important;
            overflow: hidden !important; border: none !important;
        }
        #sly-sync-button {
            position: fixed; left: 50%; transform: translateX(-50%); z-index: 100000;
            cursor: pointer; transition: transform 0.2s cubic-bezier(0.3, 0, 0, 1), opacity 0.2s ease, visibility 0.2s ease;
            visibility: hidden; opacity: 0; border: none; background: none; padding: 0;
        }
        #sly-sync-button.visible { visibility: visible; opacity: 1; }
        #sly-sync-button .e-10310-legacy-button { border-radius: 500px; display: flex; align-items: center; justify-content: center; }
        #sly-sync-button:hover { transform: translateX(-50%) scale(1.04) !important; opacity: 0.95 !important; }
        #sly-sync-button:active { transform: translateX(-50%) scale(0.98); }

        #sly-status-hud {
            display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start;
            padding: 80px 64px; text-align: left; color: white; width: 100%; min-height: 500px; height: 100%;
            position: absolute; inset: 0; z-index: 10;
            overflow: hidden; background-color: #121212;
            box-sizing: border-box;
            flex: 1;
        }
        /* Lock main parent scrolling ONLY when HUD (Loading/Error) is active */
        main.J6wP3V0xzh0Hj_MS.sly-active {
            position: relative !important;
            display: flex !important;
            flex-direction: column !important;
            min-height: 500px !important;
            height: 100% !important;
        }
        main.J6wP3V0xzh0Hj_MS.sly-active:has(#sly-status-hud) {
            overflow: hidden !important;
        }

        /* Nuclear Hijack: Hide any lyrics container that isn't ours, but ONLY when we are active */
        main.J6wP3V0xzh0Hj_MS.sly-active > div:not(#lyrics-root-sync):not(#sly-status-hud) {
            display: none !important;
        }

        /* Also hide native error messages if our HUD is present */
        main.J6wP3V0xzh0Hj_MS.sly-active > .${window.SPOTIFY_CLASSES.container}:not(#lyrics-root-sync) {
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
        .sly-hud-container { position: relative; z-index: 1; box-sizing: border-box; }
        .sly-hud-brand { text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.7; margin-bottom: 24px; font-weight: 700; }
        .sly-hud-message { margin-bottom: 24px; line-height: 1.2; max-width: 600px; }
        .sly-hud-subtext { opacity: 0.8; margin-bottom: 40px; max-width: 500px; }
        
        .sly-hud-cta-wrapper { display: flex; justify-content: flex-start; }
        .sly-hud-cta-wrapper a { text-decoration: none !important; }

        .sly-hud-pulse {
            width: 40px; height: 40px; background-color: #1DB954; border-radius: 50%;
            animation: sly-pulse 1.5s infinite ease-in-out;
        }
        .sly-hud-pulse.sly-pulse-ad {
            background-color: #b3b3b3;
        }
        @keyframes sly-pulse {
            0% { transform: scale(0.8); opacity: 0.5; }
            50% { transform: scale(1.2); opacity: 1; }
            100% { transform: scale(0.8); opacity: 0.5; }
        }

        /* 2. ZERO-FLICKER HIJACK (Pre-Logic Shield)
           Hides the entire native lyrics container immediately if it detects an error child. 
           This happens via CSS before our JS engine can even process the event. */
        .${window.SPOTIFY_CLASSES.container}:has(.hfTlyhd7WCIk9xmP),
        .${window.SPOTIFY_CLASSES.container}:has(.bRNotDNzO2suN6vM) {
            opacity: 0 !important;
            pointer-events: none !important;
            transition: none !important;
        }

        /* Fallback for browsers with limited :has() support or specific node transitions */
        .hfTlyhd7WCIk9xmP, .bRNotDNzO2suN6vM { 
            opacity: 0 !important; 
            pointer-events: none !important; 
        }

        /* Seamless Hijack: Hide Spotify's native error container ONLY when we are active */
        main.J6wP3V0xzh0Hj_MS.sly-active .hfTlyhd7WCIk9xmP, 
        main.J6wP3V0xzh0Hj_MS.sly-active .bRNotDNzO2suN6vM { 
            display: none !important; 
        }
    `;
}

window.slyGetCoreStyles = slyGetCoreStyles;
