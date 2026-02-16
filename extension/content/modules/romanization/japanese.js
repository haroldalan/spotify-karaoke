/**
 * Japanese Romanization Module using Kuroshiro
 */
window.SpotifyLyrics = window.SpotifyLyrics || {};
window.SpotifyLyrics.Romanization = window.SpotifyLyrics.Romanization || {};

(function () {
    let kuroshiro = null;
    let isInitializing = false;
    let initPromise = null;

    const JapaneseRomanization = {
        /**
         * Initialize Kuroshiro with Kuromoji Analyzer
         */
        init: function () {
            if (kuroshiro) return Promise.resolve();
            if (isInitializing) return initPromise;

            isInitializing = true;

            initPromise = new Promise((resolve, reject) => {
                try {
                    if (typeof Kuroshiro === 'undefined' || typeof KuromojiAnalyzer === 'undefined') {
                        console.warn('Kuroshiro/Kuromoji not found in global scope');
                        throw new Error('Kuroshiro or KuromojiAnalyzer not loaded');
                    }

                    kuroshiro = new Kuroshiro();

                    // DEBUG: Log the dictionary URL
                    const dictPath = chrome.runtime.getURL('content/dict/');
                    console.log('[JapaneseRomanization] Initializing with dictPath:', dictPath);

                    // Verify we can actually fetch a file from here
                    fetch(dictPath + 'base.dat.gz')
                        .then(response => {
                            console.log('[JapaneseRomanization] Dict fetch test:', response.status, response.statusText);
                            if (!response.ok) console.error('[JapaneseRomanization] Dict fetch failed');
                        })
                        .catch(err => console.error('[JapaneseRomanization] Dict fetch validation error:', err));

                    kuroshiro.init(new KuromojiAnalyzer({ dictPath: dictPath }))
                        .then(() => {
                            console.log('Kuroshiro initialized');
                            resolve();
                        })
                        .catch(e => {
                            console.error('Failed to initialize Kuroshiro internal', e);
                            isInitializing = false;
                            reject(e);
                        });
                } catch (e) {
                    console.error('Failed to initialize Kuroshiro', e);
                    isInitializing = false;
                    reject(e);
                }
            });

            return initPromise;
        },

        check: function (text) {
            if (typeof Kuroshiro !== 'undefined' && Kuroshiro.Util) {
                return Kuroshiro.Util.hasJapanese(text);
            }
            return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(text);
        },

        convert: function (text) {
            return this.init().then(() => {
                return kuroshiro.convert(text, { to: 'romaji', mode: 'spaced' });
            });
        }
    };

    window.SpotifyLyrics.Romanization.Japanese = JapaneseRomanization;
})();
