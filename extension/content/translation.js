// Google Translate Helper for Spotify Lyrics Extension

(function () {
    // We attach to window to be accessible from content.js
    window.googleTranslate = {
        /**
         * Translates text to the target language.
         * @param {string} text - The text to translate.
         * @param {string} targetLang - The target language code (default 'en').
         * @returns {Promise<string>} - The translated text.
         */
        translate: async function (text, targetLang = 'en') {
            if (!text || !text.trim()) return text;

            try {
                // Use the 'gtx' client for free usage (undocumented API)
                // Format: https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=TEXT
                const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Translation API failed: ${response.status}`);
                }

                const data = await response.json();

                // Response format is typically [[["Translated Text","Original Text",...],...],...]
                // We need to join the translated parts if multiple sentences
                if (data && data[0]) {
                    return data[0].map(part => part[0]).join('');
                }

                return text; // Fallback
            } catch (error) {
                console.error("Translation error:", error);
                return text + " [Error]";
            }
        }
    };
})();
