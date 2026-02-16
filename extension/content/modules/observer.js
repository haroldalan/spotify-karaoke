// Spotify Lyrics Extension - Observer Module

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

        /**
         * Starts the main page observer that checks for UI injection opportunities.
         * And crucially, reliably finds the lyrics container.
         */
        startPageObserver: function () {
            // 1. Mutation Observer for general page structure
            this.pageObserver = new MutationObserver(() => {
                if (window.SpotifyLyrics.UI && !document.querySelector('.spotify-lyrics-controls')) {
                    window.SpotifyLyrics.UI.scheduleInjection();
                }
                this.checkForLyricsContainer();
            });

            this.pageObserver.observe(document.body, { childList: true, subtree: true });

            // 2. Fallback Interval (Moegi Pattern)
            // Sometimes MutationObserver fires too early or misses the container's creation deep in React tree
            // We check every 500ms if we don't have a container, or if we need to re-verify.
            if (this.checkInterval) clearInterval(this.checkInterval);
            this.checkInterval = setInterval(() => {
                this.checkForLyricsContainer();
            }, 1000);
        },

        /**
         * Checks if the lyrics container exists and starts the specific observer if so.
         */
        checkForLyricsContainer: function () {
            // Priority: Fullscreen -> Normal
            const fullscreenContainer = document.querySelector(Constants.FULLSCREEN_CONTAINER + ' ' + Constants.LYRICS_CONTAINER);
            const normalContainer = document.querySelector(Constants.LYRICS_CONTAINER);

            // Determine active container (logic: if fullscreen exists, it's usually the comprehensive one)
            // But we must be careful: sometimes both exist in DOM?
            let container = fullscreenContainer || normalContainer;

            // If we have a stored container, but it's no longer connected to DOM, clear it.
            if (this.lyricsContainer && !this.lyricsContainer.isConnected) {
                // console.log("[Spotify Lyrics] Container disconnected.");
                this.lyricsContainer = null;
                if (this.lyricsObserver) this.lyricsObserver.disconnect();
            }

            if (container && container !== this.lyricsContainer) {
                // console.log("[Spotify Lyrics] Lyrics container found, attaching observer.");
                this.lyricsContainer = container;
                this.startLyricsObserver(container);
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
                    // 1. Handle Added Nodes (Spotify re-rendering lines)
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1) { // Element
                                // Specific check for lyric lines
                                if (node.matches && node.matches(Constants.LYRIC_SELECTOR)) {
                                    // CRITICAL: Eager Cache Restoration
                                    // Try to restore immediately!
                                    if (EagerCache.restoreLyricFromCache(node)) {
                                        return; // Skip further processing if restored
                                    }

                                    // If not in cache, process it normally
                                    Processor.processLine(node, true);
                                }
                                // Recurse if it's a wrapper adding multiple lines
                                else if (node.querySelectorAll) {
                                    node.querySelectorAll(Constants.LYRIC_SELECTOR).forEach(line => {
                                        if (EagerCache.restoreLyricFromCache(line)) return;
                                        Processor.processLine(line, true);
                                    });
                                }
                            }
                        });
                    }

                    // 2. Handle Character Data (Text changes)
                    if (mutation.type === 'characterData') {
                        let target = mutation.target;
                        while (target && target.nodeType !== 1) target = target.parentElement;
                        if (target) {
                            const line = target.closest(Constants.LYRIC_SELECTOR);
                            // For text changes, we don't restore from cache blindy, we re-process
                            if (line) Processor.processLine(line, true);
                        }
                    }
                }
            });

            try {
                this.lyricsObserver.observe(container, { childList: true, subtree: true, characterData: true });

                // Fix for Song Change / Initial Load Race Condition:
                // If the container is found but already has lyrics (because we attached late or it was swapped),
                // the MutationObserver won't see them being added. We must process them now.
                const existingLines = container.querySelectorAll(Constants.LYRIC_SELECTOR);
                existingLines.forEach(line => {
                    // Treat as external update because we are seeing them for the first time in this container context
                    if (EagerCache.restoreLyricFromCache(line)) return;
                    Processor.processLine(line, true);
                });

            } catch (e) {
                console.warn("[Spotify Lyrics] Failed to observe container:", e);
                this.lyricsContainer = null;
            }
        },

        disconnect: function () {
            if (this.lyricsObserver) this.lyricsObserver.disconnect();
            if (this.pageObserver) this.pageObserver.disconnect();
            if (this.checkInterval) clearInterval(this.checkInterval);
        }
    };

    window.SpotifyLyrics.Observer = Observer;
})();
