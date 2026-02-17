// Spotify Lyrics Extension - State Module

window.SpotifyLyrics = window.SpotifyLyrics || {};

(function () {
    const State = {
        currentMode: 'original', // 'original', 'romanized', 'translated'
        targetLanguage: 'en', // Default
        dualLyrics: false, // Default
        translationCache: new Map(),

        /**
         * Load all settings and cache from Chrome storage.
         * @returns {Promise<void>}
         */
        loadFromStorage: function () {
            return new Promise((resolve) => {
                chrome.storage.local.get(null, (items) => {
                    // Load Translations
                    for (const [key, value] of Object.entries(items)) {
                        // Check for namespaced keys first: trans_LANG_TEXT
                        if (key.startsWith(`trans_${this.targetLanguage}_`)) {
                            const originalText = key.substring(`trans_${this.targetLanguage}_`.length);
                            this.translationCache.set(originalText, value);
                        }
                        // Backward compatibility: load old keys if they match default 'en' (or maybe just ignore them to be safe?)
                        // For now, let's strictly load only if it matches the current target language schema if possible.
                        // But to support migration, we might want to nukes old keys? 
                        // Let's stick to the new schema. if (key.startsWith('trans_')) would act as "unknown lang".
                    }
                    console.log(`[Spotify Lyrics Extension] Loaded ${this.translationCache.size} translations for ${this.targetLanguage}.`);

                    // Load Last Active Mode
                    if (items.lastActiveMode) {
                        console.log(`[Spotify Lyrics Extension] Restoring mode: ${items.lastActiveMode}`);
                        this.currentMode = items.lastActiveMode;
                    }

                    // Load Target Language
                    if (items.targetLanguage) {
                        // If target language is in storage, we might have loaded the WRONG cache above 
                        // because we used the default 'en' or whatever this.targetLanguage was initialized with.
                        // We should probably reload cache if the storage lang differs from default.
                        if (items.targetLanguage !== this.targetLanguage) {
                            this.targetLanguage = items.targetLanguage;
                            this.translationCache.clear();
                            // Re-scan items for the correct language
                            // Re-scan items for the correct language
                            for (const [key, value] of Object.entries(items)) {
                                if (key.startsWith(`trans_${this.targetLanguage}_`)) {
                                    const originalText = key.substring(`trans_${this.targetLanguage}_`.length);
                                    this.translationCache.set(originalText, value);
                                }
                            }
                        } else {
                        }
                    }

                    // Load Dual Lyrics
                    if (items.dualLyrics !== undefined) {
                        this.dualLyrics = items.dualLyrics;
                    }

                    resolve();
                });
            });
        },

        saveMode: function (mode) {
            this.currentMode = mode;
            chrome.storage.local.set({ lastActiveMode: mode });
        },

        saveTranslation: function (original, translated) {
            this.translationCache.set(original, translated);
            // Save with namespace: trans_en_OriginalText
            const key = `trans_${this.targetLanguage}_${original}`;
            chrome.storage.local.set({ [key]: translated }).catch(() => { });
        },

        clearCache: function () {
            this.translationCache.clear();
        },

        /**
         * Update target language and return true if changed
         * @param {string} newLang 
         * @returns {boolean}
         */
        updateLanguage: function (newLang) {
            if (newLang !== this.targetLanguage) {
                console.log(`[Spotify Lyrics Extension] Language changed to: ${newLang}`);
                this.targetLanguage = newLang;
                return true;
            }
            return false;
        },

        onChange: function (callback) {
            chrome.storage.onChanged.addListener((changes, namespace) => {
                if (namespace === 'local') {
                    if (changes.dualLyrics) {
                        this.dualLyrics = changes.dualLyrics.newValue;
                    }
                    callback(changes);
                }
            });
        }
    };

    window.SpotifyLyrics.State = State;
})();
