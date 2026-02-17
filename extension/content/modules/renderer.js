// Spotify Lyrics Extension - Renderer Module
// Handles all DOM manipulations to separate concerns from Processor

window.SpotifyLyrics = window.SpotifyLyrics || {};

(function () {
    const Utils = window.SpotifyLyrics.Utils;
    const Shimmer = window.SpotifyLyrics.Shimmer;
    const EagerCache = window.SpotifyLyrics.EagerCache;

    const Renderer = {
        /**
         * Update the text of a lyric line safely.
         * @param {HTMLElement} line 
         * @param {string} text 
         * @param {boolean} isRomanized 
         */
        applyText: function (line, text, originalText) {
            Utils.ignoreMutations(() => {
                if (!line.isConnected) return;

                // Dual Lyrics Logic
                if (window.SpotifyLyrics.State.dualLyrics && originalText && text !== originalText) {
                    const html = `${text}<br><span class="sub-lyric">${originalText}</span>`;
                    if (line.innerHTML !== html) {
                        line.innerHTML = html;
                        line.setAttribute('data-processed-text', text);
                    }
                } else {
                    // Standard Single Line
                    if (line.innerText !== text) {
                        line.innerText = text;
                        line.setAttribute('data-processed-text', text);
                    }
                }

                Shimmer.remove(line);
                EagerCache.cacheLyricElement(line);
            });
        },

        /**
         * Mark a line as loading/processing.
         * @param {HTMLElement} line 
         */
        setLoading: function (line) {
            Utils.ignoreMutations(() => {
                if (!line.isConnected) return;
                Shimmer.add(line);
            });
        },

        /**
         * Reset a line to its original state (or specific text).
         * @param {HTMLElement} line 
         * @param {string} originalText 
         */
        resetLine: function (line, originalText) {
            Utils.ignoreMutations(() => {
                if (!line.isConnected) return;

                if (line.innerText !== originalText) {
                    line.innerText = originalText;
                }
                // If we are resetting, we might want to clear processed text attribute
                // but checking Processor logic, it seems we use it for diff
                // line.removeAttribute('data-processed-text'); 

                Shimmer.remove(line);
            });
        }
    };

    window.SpotifyLyrics.Renderer = Renderer;
})();
