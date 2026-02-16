/**
 * Romanization Manager
 */
window.SpotifyLyrics = window.SpotifyLyrics || {};
window.SpotifyLyrics.Romanization = window.SpotifyLyrics.Romanization || {};

(function () {
    const RomanizationManager = {
        init: function () {
            // Lazy init Japanese engine
            if (window.SpotifyLyrics.Romanization.Japanese) {
                window.SpotifyLyrics.Romanization.Japanese.init();
            }
        },

        getStrategy: function (text) {
            const Rom = window.SpotifyLyrics.Romanization;
            if (Rom.Japanese && Rom.Japanese.check(text)) {
                return 'japanese';
            }
            if (Rom.Korean && Rom.Korean.check(text)) {
                return 'korean';
            }
            return 'generic';
        },

        convert: function (text) {
            const strategy = this.getStrategy(text);
            const Rom = window.SpotifyLyrics.Romanization;

            try {
                if (strategy === 'japanese') {
                    return Rom.Japanese.convert(text);
                } else if (strategy === 'korean') {
                    return Rom.Korean.convert(text);
                } else {
                    // Generic
                    return new Promise((resolve) => {
                        let result = text;
                        if (typeof window.transliteration !== 'undefined' && window.transliteration.slugify) {
                            result = window.transliteration.slugify(text, { separator: ' ' });
                        } else if (typeof window.slugify === 'function') {
                            result = window.slugify(text, { separator: ' ' });
                        }
                        resolve(result);
                    });
                }
            } catch (e) {
                console.error("Romanization error", e);
                return Promise.resolve(text);
            }
        }
    };

    window.SpotifyLyrics.Romanization.Manager = RomanizationManager;
})();
