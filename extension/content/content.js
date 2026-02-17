// Spotify Lyrics Extension - Bootstrapper

(async function () {
    // Ensure all dependencies are present
    const checkDeps = () => {
        return window.SpotifyLyrics &&
            window.SpotifyLyrics.State &&
            window.SpotifyLyrics.UI &&
            window.SpotifyLyrics.Observer &&
            window.SpotifyLyrics.Renderer &&
            window.SpotifyLyrics.Processor &&
            window.SpotifyLyrics.Constants &&
            window.SpotifyLyrics.EagerCache &&
            window.SpotifyLyrics.ScriptDetection &&
            window.SpotifyLyrics.Providers;
    };

    if (!checkDeps()) {
        console.warn("[Spotify Lyrics] Dependencies missing (Unexpected). Waiting...");
        // Fallback for theoretical async issues, though manifest is sync
        let retries = 0;
        const interval = setInterval(() => {
            if (checkDeps()) {
                clearInterval(interval);
                init();
            } else if (retries++ > 50) {
                clearInterval(interval);
                console.error("[Spotify Lyrics] CRITICAL: Failed to load dependencies.");
            }
        }, 50);
        return;
    }

    init();

    async function init() {
        const { State, UI, Observer, Processor, EagerCache } = window.SpotifyLyrics;

        // Initialize State
        await State.loadFromStorage();

        // Listen for changes
        // Listen for changes
        State.onChange((changes) => {
            let shouldRerender = false;

            if (changes.targetLanguage) {
                const changed = State.updateLanguage(changes.targetLanguage.newValue);
                if (changed) {
                    // Language changed, we need to clear processing cache and re-process
                    State.clearCache(); // This is the translation cache (localStorage)
                    EagerCache.clear();   // This is the DOM cache (runtime)

                    // If we are in translated mode, we need to re-trigger translation
                    if (State.currentMode === 'translated') {
                        Processor.resetTranslatedLines();
                    } else {
                        shouldRerender = true;
                    }
                }
            }

            if (changes.dualLyrics) {
                // Dual lyrics setting changed
                console.log("[Spotify Lyrics] Dual Lyrics toggled:", changes.dualLyrics.newValue);
                shouldRerender = true;
                // We also need to clear EagerCache because cached HTML might not have dual lines
                EagerCache.clear();
            }

            if (shouldRerender) {
                Processor.applyModeToAll();
            }
        });

        // Start UI Injection (which also starts Observers)
        UI.scheduleInjection();
        Observer.startPageObserver();
    }
})();
