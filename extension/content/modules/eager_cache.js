// Spotify Lyrics Extension - Eager Cache Module
// Based on Moegi's optimization to prevent flickering

window.SpotifyLyrics = window.SpotifyLyrics || {};

(function () {
    const EagerCache = {
        cache: new Map(),

        /**
         * Store the processed HTML of a lyric line.
         * keys are based on the ORIGINAL text content found in the element.
         * @param {HTMLElement} element 
         */
        cacheLyricElement: function (element) {
            // We expect the element to have the original text stored in an attribute or class
            // In our extension, we use data-original-text
            const originalText = element.getAttribute('data-original-text');
            if (originalText) {
                this.cache.set(originalText.trim(), element.innerHTML);
            }
        },

        /**
         * Try to restore a lyric element from cache.
         * @param {HTMLElement} element 
         * @returns {boolean} true if restored
         */
        restoreLyricFromCache: function (element) {
            // When Spotify re-adds a line, it usually has the original text as innerText
            const text = element.innerText?.trim();
            if (!text) return false;

            if (this.cache.has(text)) {
                const cachedHTML = this.cache.get(text);
                if (element.innerHTML !== cachedHTML) {
                    // console.log(`[EagerCache] Restoring for: "${text.substring(0, 20)}..."`);
                    element.innerHTML = cachedHTML;
                    // Ensure the attribute is set so we know it's processed
                    element.setAttribute('data-original-text', text);
                    return true;
                }
            }
            return false;
        },

        clear: function () {
            this.cache.clear();
        }
    };

    window.SpotifyLyrics.EagerCache = EagerCache;
})();
