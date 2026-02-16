// Spotify Lyrics Extension - Attribution Module

window.SpotifyLyrics = window.SpotifyLyrics || {};

(function () {
    const Attribution = {
        element: null,
        originalText: null,
        observer: null,

        init: function () {
            this.startObserver();
        },

        startObserver: function () {
            if (this.observer) return;

            this.observer = new MutationObserver(() => {
                this.findAndProcess();
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true
            });

            // Initial check
            this.findAndProcess();
        },

        findAndProcess: function () {
            // Strategy: Find any element containing "Lyrics provided by"
            // We use XPath to find the text node containing the string
            const xpath = "//*[contains(text(), 'Lyrics provided by')]";
            const result = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );

            const el = result.singleNodeValue;

            if (el) {
                // If we found a new element or the element we have is no longer in DOM (though singleNodeValue should return valid one)
                // Or if the text content has changed meaningfully (e.g. Spotify reset it)

                // If it's a new element, store it.
                if (this.element !== el) {
                    this.element = el;
                    this.originalText = el.textContent;
                    // Clean potential suffixes from our own previous edits if Spotify recycled the DOM node but kept text
                    this.cleanOriginalText();
                    console.log(`[Spotify Lyrics Extension] Found attribution: "${this.originalText}"`);
                }
                // If it's the same element, check if the text was reset by Spotify to something native
                else if (el.textContent.includes('Lyrics provided by') &&
                    !el.textContent.includes('Transliteration library') &&
                    !el.textContent.includes('Google Translate')) {
                    // It looks like original text. Update our originalText just in case.
                    this.originalText = el.textContent;
                    this.cleanOriginalText();
                }

                this.update();
            }
        },

        cleanOriginalText: function () {
            if (this.originalText) {
                this.originalText = this.originalText
                    .replace(' Romanized using Transliteration library by yf-hk', '')
                    .replace(' Translated using Google Translate', '');
            }
        },

        update: function () {
            if (!this.element || !this.originalText) return;

            const State = window.SpotifyLyrics.State;
            if (!State) return;

            const mode = State.currentMode;
            let suffix = '';

            if (mode === 'romanized') {
                suffix = ' & Romanized using Transliteration library by yf-hk';
            } else if (mode === 'translated') {
                suffix = ' & Translated using Google Translate';
            }

            const newText = this.originalText + suffix;

            if (this.element.textContent !== newText) {
                this.element.textContent = newText;
            }
        }
    };

    window.SpotifyLyrics.Attribution = Attribution;

    // Auto-init
    Attribution.init();
})();
