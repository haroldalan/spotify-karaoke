// Spotify Lyrics Extension - Observer Module
// Refactored for stability (inspired by Moegi)

window.SpotifyLyrics = window.SpotifyLyrics || {};

(function () {
    const Utils = window.SpotifyLyrics.Utils;
    const Processor = window.SpotifyLyrics.Processor;
    const Constants = window.SpotifyLyrics.Constants;
    const EagerCache = window.SpotifyLyrics.EagerCache;

    const Observer = {
        lyricsObserver: null,
        pageObserver: null,
        lyricsContainer: null,
        checkInterval: null,
        debounceTimer: null,

        /**
         * Starts the main page observer.
         * We try to observe a stable root like #main or just body if needed.
         */
        startPageObserver: function () {
            const root = document.querySelector('#main') || document.body;

            this.pageObserver = new MutationObserver((mutations) => {
                // Debounce the check to avoid performance progression crashes
                if (this.debounceTimer) clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => {
                    this.handlePageMutation();
                }, 200);
            });

            this.pageObserver.observe(root, { childList: true, subtree: true });

            // Fallback Interval for safety
            if (this.checkInterval) clearInterval(this.checkInterval);
            this.checkInterval = setInterval(() => {
                this.checkForLyricsContainer();
            }, 1000);

            // Initial check
            this.checkForLyricsContainer();
        },

        handlePageMutation: function () {
            if (window.SpotifyLyrics.UI && !document.querySelector('.spotify-lyrics-controls')) {
                window.SpotifyLyrics.UI.scheduleInjection();
            }
            this.checkForLyricsContainer();
        },

        /**
         * Checks if the lyrics container exists and starts the specific observer if so.
         */
        checkForLyricsContainer: function () {
            // Priority: Fullscreen -> Normal
            const fullscreenContainer = document.querySelector(Constants.FULLSCREEN_CONTAINER + ' ' + Constants.LYRICS_CONTAINER);
            const normalContainer = document.querySelector(Constants.LYRICS_CONTAINER);

            // Determine active container
            let container = fullscreenContainer || normalContainer;

            // If we have a stored container, but it's no longer connected to DOM, clear it.
            if (this.lyricsContainer && !this.lyricsContainer.isConnected) {
                this.lyricsContainer = null;
                if (this.lyricsObserver) this.lyricsObserver.disconnect();
            }

            if (container && container !== this.lyricsContainer) {
                // console.log("[Spotify Lyrics] Lyrics container found/changed.");
                this.lyricsContainer = container;
                this.startLyricsObserver(container);

                // Force a swipe of existing lines processing
                Processor.applyModeToAll();
            }
        },

        /**
         * Observes the specific lyrics container for changes.
         * @param {HTMLElement} container 
         */
        startLyricsObserver: function (container) {
            if (!container || !(container instanceof Node)) return;

            if (this.lyricsObserver) {
                this.lyricsObserver.disconnect();
            }

            this.lyricsObserver = new MutationObserver((mutations) => {
                if (Utils.isMutationIgnored()) return;

                for (const mutation of mutations) {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1) { // Element
                                if (node.matches && node.matches(Constants.LYRIC_SELECTOR)) {
                                    // Eager Cache Restore
                                    if (EagerCache.restoreLyricFromCache(node)) return;
                                    Processor.processLine(node, true);
                                }
                                else if (node.querySelectorAll) {
                                    node.querySelectorAll(Constants.LYRIC_SELECTOR).forEach(line => {
                                        if (EagerCache.restoreLyricFromCache(line)) return;
                                        Processor.processLine(line, true);
                                    });
                                }
                            }
                        });
                    }

                    // Handle text changes if acts as source of truth
                    if (mutation.type === 'characterData') {
                        let target = mutation.target;
                        while (target && target.nodeType !== 1) target = target.parentElement;
                        // Avoid loops by checking if we are ignoring mutations
                        if (target) {
                            const line = target.closest(Constants.LYRIC_SELECTOR);
                            if (line) Processor.processLine(line, true);
                        }
                    }
                }
            });

            this.lyricsObserver.observe(container, { childList: true, subtree: true, characterData: true });
        },

        disconnect: function () {
            if (this.lyricsObserver) this.lyricsObserver.disconnect();
            if (this.pageObserver) this.pageObserver.disconnect();
            if (this.checkInterval) clearInterval(this.checkInterval);
        }
    };

    window.SpotifyLyrics.Observer = Observer;
})();
