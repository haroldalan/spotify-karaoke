// Spotify Lyrics Extension - Processor Module

window.SpotifyLyrics = window.SpotifyLyrics || {};

(function () {
    const State = window.SpotifyLyrics.State;
    const Utils = window.SpotifyLyrics.Utils;
    const Shimmer = window.SpotifyLyrics.Shimmer;
    const EagerCache = window.SpotifyLyrics.EagerCache;
    const ScriptDetection = window.SpotifyLyrics.ScriptDetection;

    // Fallback for slugify
    const getSlugify = (text) => {
        if (typeof window.transliteration !== 'undefined' && window.transliteration.slugify) {
            return window.transliteration.slugify(text, { separator: ' ' });
        }
        if (typeof window.slugify === 'function') {
            return window.slugify(text, { separator: ' ' });
        }
        return text;
    };

    const Processor = {
        batchQueue: new Set(),
        batchTimeout: null,
        isTranslating: false,

        /**
         * Get romanized version of text using Script Detection.
         */
        getRomanizedText: function (text) {
            if (!ScriptDetection) return getSlugify(text);

            const segments = ScriptDetection.splitTextByScript(text);
            let result = "";

            for (const segment of segments) {
                const provider = ScriptDetection.getProviderForScript(segment.script);
                if (provider === 'none') {
                    result += segment.text;
                } else {
                    result += getSlugify(segment.text);
                }
            }
            return result;
        },

        /**
         * Add a line to the batch translation queue.
         */
        addToBatch: function (line, text) {
            // Store reference to line and its text
            // We use a Map to ensure unique lines
            if (!this.batchMap) this.batchMap = new Map();
            this.batchMap.set(line, text);

            // Debounce the flush
            if (this.batchTimeout) clearTimeout(this.batchTimeout);
            this.batchTimeout = setTimeout(() => {
                this.flushBatch();
            }, 200); // 200ms debounce to gather all lines from a render cycle
        },

        /**
         * Process the gathered batch of lines.
         */
        flushBatch: async function () {
            if (!this.batchMap || this.batchMap.size === 0) return;

            const batch = Array.from(this.batchMap.entries());
            this.batchMap.clear(); // Clear immediately so new items can queue
            this.batchTimeout = null;

            const targetLanguage = State.targetLanguage;

            // Extract unique texts to translate (avoid duplicate API calls)
            const uniqueTexts = [...new Set(batch.map(([_, text]) => text))];

            // Filter out what we already have in cache (race condition check)
            const textsToTranslate = uniqueTexts.filter(text => !State.translationCache.has(text));

            if (textsToTranslate.length === 0) {
                // We have everything needed, just apply
                this.applyBatchResults(batch);
                return;
            }

            try {
                // Join with newlines
                const fullText = textsToTranslate.join('\n');

                let translatedResults = [];

                if (window.googleTranslate) {
                    const fetchPromise = window.googleTranslate.translate(fullText, targetLanguage);
                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000));

                    try {
                        const resultBlob = await Promise.race([fetchPromise, timeoutPromise]);
                        if (State.targetLanguage !== targetLanguage) return; // Mode changed mid-flight

                        // Split result back into array
                        // NOTE: Google Translate might mess up newline count if the source text has weird spacing.
                        // Ideally we should send structural data, but for this simple extension \n is standard.
                        translatedResults = resultBlob.split('\n');

                        // Mismatch safety check
                        if (translatedResults.length !== textsToTranslate.length) {
                            console.warn(`[Batch Translation] Mismatch! Sent ${textsToTranslate.length}, got ${translatedResults.length}. Fallback to line-by-line?`);
                            // Fallback: don't save to cache blindly if lengths mismatch to avoid misalignment
                            // But try to salvage what we can?
                            // For now, assume it's okay or fail.
                        }

                        // Save to cache
                        textsToTranslate.forEach((original, index) => {
                            if (translatedResults[index]) {
                                State.saveTranslation(original, translatedResults[index].trim());
                            }
                        });

                    } catch (err) {
                        console.warn("Batch Translation failed", err);
                        // Remove shimmers
                        batch.forEach(([line, _]) => Shimmer.remove(line));
                        return;
                    }
                }

                // Apply results
                this.applyBatchResults(batch);

            } catch (e) {
                console.error("Batch processing error", e);
                batch.forEach(([line, _]) => Shimmer.remove(line));
            }
        },

        applyBatchResults: function (batch) {
            Utils.ignoreMutations(() => {
                batch.forEach(([line, originalText]) => {
                    // Re-verify line is still in DOM and state matches
                    if (!line.isConnected) return;

                    if (State.translationCache.has(originalText)) {
                        const translated = State.translationCache.get(originalText);
                        line.innerText = translated;
                        line.setAttribute('data-processed-text', translated);
                        Shimmer.remove(line);
                        EagerCache.cacheLyricElement(line);
                    } else {
                        // Failed to translate this specific one?
                        Shimmer.remove(line);
                    }
                });
            });
        },

        /**
         * Core logic to process a single lyric line.
         */
        processLine: function (line, isExternalUpdate = false) {
            if (!line) return;
            const currentText = line.innerText;
            const knownOriginal = line.getAttribute('data-original-text');
            const currentMode = State.currentMode;

            // 1. Manage Data Source of Truth
            if (isExternalUpdate) {
                const textKey = knownOriginal || currentText;

                // EAGER RESTORE
                if (EagerCache.restoreLyricFromCache(line)) return;

                if (knownOriginal) {
                    let expectedOutput = knownOriginal;
                    if (currentMode === 'translated' && State.translationCache.has(knownOriginal)) {
                        expectedOutput = State.translationCache.get(knownOriginal);
                    } else if (currentMode === 'romanized') {
                        expectedOutput = this.getRomanizedText(knownOriginal);
                    }

                    if (currentText === expectedOutput) {
                        EagerCache.cacheLyricElement(line);
                        return;
                    }
                }

                if (currentText.trim() && currentText !== knownOriginal) {
                    const lastProcessed = line.getAttribute('data-processed-text');
                    if (lastProcessed && currentText === lastProcessed) {
                        return;
                    }
                    line.setAttribute('data-original-text', currentText);
                }
            } else {
                if (!knownOriginal) {
                    if (!currentText.trim()) return;
                    line.setAttribute('data-original-text', currentText);
                }
            }

            const originalText = line.getAttribute('data-original-text');
            if (!originalText) return;

            // 2. Apply Transformation
            Utils.ignoreMutations(() => {

                if (currentMode === 'romanized') {
                    const romanized = this.getRomanizedText(originalText);
                    if (line.innerText !== romanized) {
                        line.innerText = romanized;
                        line.setAttribute('data-processed-text', romanized);
                    }
                    Shimmer.remove(line);
                    EagerCache.cacheLyricElement(line);
                }
                else if (currentMode === 'translated') {
                    if (State.translationCache.has(originalText)) {
                        const translated = State.translationCache.get(originalText);
                        if (line.innerText !== translated) {
                            line.innerText = translated;
                            line.setAttribute('data-processed-text', translated);
                        }
                        Shimmer.remove(line);
                        EagerCache.cacheLyricElement(line);
                    } else {
                        // UX: Reset to original text immediately
                        if (line.innerText !== originalText) {
                            line.innerText = originalText;
                            line.setAttribute('data-processed-text', originalText);
                        }

                        // QUEUE FOR BATCH TRANSLATION
                        Shimmer.add(line);
                        this.addToBatch(line, originalText);
                    }
                }
                else if (currentMode === 'original') {
                    if (line.innerText !== originalText) {
                        line.innerText = originalText;
                        line.setAttribute('data-processed-text', originalText);
                    }
                    Shimmer.remove(line);
                    EagerCache.cacheLyricElement(line);
                }
            });
        },

        applyModeToAll: function () {
            EagerCache.clear();
            const lyricsLines = document.querySelectorAll(window.SpotifyLyrics.Constants.LYRIC_SELECTOR);
            lyricsLines.forEach(line => this.processLine(line, false));
        },

        resetTranslatedLines: function () {
            EagerCache.clear();
            const lyricsLines = document.querySelectorAll(window.SpotifyLyrics.Constants.LYRIC_SELECTOR);
            lyricsLines.forEach(line => {
                const original = line.getAttribute('data-original-text');
                if (original) {
                    line.innerText = original;
                }
                Shimmer.remove(line);
            });
            // Clear batch
            if (this.batchMap) this.batchMap.clear();
            this.applyModeToAll();
        }
    };

    window.SpotifyLyrics.Processor = Processor;
})();
