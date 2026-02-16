/**
 * Korean Romanization Module using Aromanize
 */
window.SpotifyLyrics = window.SpotifyLyrics || {};
window.SpotifyLyrics.Romanization = window.SpotifyLyrics.Romanization || {};

(function () {
    const KoreanRomanization = {
        /**
         * Check if text contains Korean characters (Hangul)
         */
        check: function (text) {
            return /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7AF\uD7B0-\uD7FF]/.test(text);
        },

        /**
         * Convert Korean text to Romaji
         * @param {string} text 
         * @returns {Promise<string>}
         */
        convert: function (text) {
            return new Promise((resolve) => {
                if (typeof Aromanize !== 'undefined') {
                    resolve(Aromanize.romanize(text));
                } else {
                    resolve(text);
                }
            });
        }
    };

    window.SpotifyLyrics.Romanization.Korean = KoreanRomanization;
})();
