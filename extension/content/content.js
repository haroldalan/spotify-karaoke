// Spotify Lyrics Extension - Bootstrapper

(async function () {
    // Ensure all dependencies are present
    const checkDeps = () => {
        return window.SpotifyLyrics &&
            window.SpotifyLyrics.State &&
            window.SpotifyLyrics.UI &&
            window.SpotifyLyrics.Observer &&
            window.SpotifyLyrics.Processor &&
            window.SpotifyLyrics.Constants &&
            window.SpotifyLyrics.EagerCache &&
            window.SpotifyLyrics.ScriptDetection &&
            window.SpotifyLyrics.Providers;
    };

    if (!checkDeps()) {
        console.warn("[Spotify Lyrics] Waiting for dependencies...");
        // Fast retry for a bit
        let retries = 0;
        const interval = setInterval(() => {
            if (checkDeps()) {
                clearInterval(interval);
                init();
            } else if (retries++ > 20) {
                clearInterval(interval);
                console.error("[Spotify Lyrics] Failed to load dependencies.");
            }
        }, 100);
        return;
    }

    init();

    async function init() {
        const { State, UI, Observer, Processor, EagerCache } = window.SpotifyLyrics;

        // Initialize State
        await State.loadFromStorage();

        // Listen for changes
        State.onChange((changes) => {
            if (changes.targetLanguage) {
                const changed = State.updateLanguage(changes.targetLanguage.newValue);
                if (changed) {
                    // Language changed, we need to clear processing cache and re-process
                    State.clearCache(); // This is the translation cache (localStorage)
                    EagerCache.clear();   // This is the DOM cache (runtime)

                    // If we are in translated mode, we need to re-trigger translation
                    if (State.currentMode === 'translated') {
                        Processor.resetTranslatedLines();
                    }
                }
            }
        });

        // Start UI Injection (which also starts Observers)
        UI.scheduleInjection();
        Observer.startPageObserver();

        console.log("[Spotify Lyrics Extension] Loaded and Initialized (Stability Mode).");
    }
})();
