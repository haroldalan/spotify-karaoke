// Spotify Lyrics Extension - Processor Module

window.SpotifyLyrics = window.SpotifyLyrics || {};

(function () {
    const State = window.SpotifyLyrics.State;
    const Utils = window.SpotifyLyrics.Utils;
    const Shimmer = window.SpotifyLyrics.Shimmer;
    const EagerCache = window.SpotifyLyrics.EagerCache;
    const ScriptDetection = window.SpotifyLyrics.ScriptDetection;

    // Romanization result cache (text -> romanized text)
    const romanizationCache = new Map();

    const Processor = {
        // Translation Batching
        batchMap: new Map(), // Map<lineElement, originalText>
        batchTimeout: null,

        // Romanization Batching
        romanizationBatches: new Map(), // providerName -> Map<lineElement, text>
        romanizationTimeout: null,

        isTranslating: false,

        /**
         * Get romanized version of text using the provider system.
         * Returns a Promise that resolves to the romanized string.
         */
        getRomanizedText: async function (text) {
            // Check romanization cache first
            if (romanizationCache.has(text)) {
                return romanizationCache.get(text);
            }

            const Providers = window.SpotifyLyrics.Providers;
            if (!ScriptDetection || !Providers) {
                // Fallback: use generic transliteration
                if (Providers && Providers.any) {
                    const result = await Providers.any.convert(text);
                    romanizationCache.set(text, result);
                    return result;
                }
                return text;
            }

            const segments = ScriptDetection.splitTextByScript(text);
            let result = "";

            for (const segment of segments) {
                const providerName = ScriptDetection.getProviderForScript(segment.script);
                if (providerName === 'none') {
                    result += segment.text;
                } else if (Providers[providerName]) {
                    const provider = Providers[providerName];
                    if (provider.check(segment.text)) {
                        try {
                            result += await provider.convert(segment.text);
                        } catch (err) {
                            console.warn(`[Romanization] Provider '${providerName}' error:`, err);
                            result += segment.text;
                        }
                    } else {
                        result += segment.text;
                    }
                } else {
                    // Unknown provider, use generic fallback
                    if (Providers.any) {
                        result += await Providers.any.convert(segment.text);
                    } else {
                        result += segment.text;
                    }
                }
            }

            romanizationCache.set(text, result);
            return result;
        },

        /**
         * Get cached romanized text synchronously (for comparison checks).
         * Returns null if not yet cached.
         */
        getCachedRomanizedText: function (text) {
            return romanizationCache.has(text) ? romanizationCache.get(text) : null;
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
                        translatedResults = resultBlob.split('\n');

                        // Mismatch safety check
                        if (translatedResults.length !== textsToTranslate.length) {
                            console.warn(`[Batch Translation] Mismatch! Sent ${textsToTranslate.length}, got ${translatedResults.length}. Fallback to line-by-line?`);
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

        // ═══════════════════════════════════════════════
        // Romanization Batch Logic
        // ═══════════════════════════════════════════════
        addToRomanizationBatch: function (providerName, line, text) {
            if (!this.romanizationBatches.has(providerName)) {
                this.romanizationBatches.set(providerName, new Map());
            }
            const providerBatch = this.romanizationBatches.get(providerName);
            providerBatch.set(line, text);

            if (this.romanizationTimeout) clearTimeout(this.romanizationTimeout);
            this.romanizationTimeout = setTimeout(() => {
                this.flushRomanizationBatches();
            }, 200);
        },

        flushRomanizationBatches: async function () {
            if (this.romanizationBatches.size === 0) return;

            // Clone and clear map
            const batchesToProcess = new Map(this.romanizationBatches);
            this.romanizationBatches.clear();
            this.romanizationTimeout = null;

            const Providers = window.SpotifyLyrics.Providers;

            for (const [providerName, batchMap] of batchesToProcess) {
                if (batchMap.size === 0) continue;

                const entries = Array.from(batchMap.entries());
                const lines = entries.map(e => e[0]);
                const texts = entries.map(e => e[1]);
                const uniqueTexts = [...new Set(texts)];

                // Filter cached
                const neededTexts = uniqueTexts.filter(t => !romanizationCache.has(t));

                if (neededTexts.length > 0 && Providers[providerName]) {
                    try {
                        let results = [];
                        if (typeof Providers[providerName].convertBatch === 'function') {
                            results = await Providers[providerName].convertBatch(neededTexts);
                        } else {
                            // Should not happen given queue logic, but fallback
                            results = await Promise.all(neededTexts.map(t => Providers[providerName].convert(t)));
                        }

                        // Update Cache
                        neededTexts.forEach((original, i) => {
                            if (results[i]) {
                                romanizationCache.set(original, results[i]);
                            }
                        });
                    } catch (err) {
                        console.warn(`[Romanization] Batch error for ${providerName}:`, err);
                    }
                }

                // Apply results
                Utils.ignoreMutations(() => {
                    lines.forEach(line => {
                        if (!line.isConnected) return;
                        const original = batchMap.get(line);
                        if (romanizationCache.has(original)) {
                            const result = romanizationCache.get(original);
                            if (State.currentMode === 'romanized') {
                                line.innerText = result;
                                line.setAttribute('data-processed-text', result);
                                Shimmer.remove(line);
                                EagerCache.cacheLyricElement(line);
                            }
                        } else {
                            Shimmer.remove(line); // Failed
                        }
                    });
                });
            }
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
                        // Use cached romanization for comparison (synchronous check)
                        const cachedRomanized = this.getCachedRomanizedText(knownOriginal);
                        if (cachedRomanized) {
                            expectedOutput = cachedRomanized;
                        }
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
                    // Check if we have a cached result to apply immediately
                    const cachedRomanized = this.getCachedRomanizedText(originalText);
                    if (cachedRomanized) {
                        if (line.innerText !== cachedRomanized) {
                            line.innerText = cachedRomanized;
                            line.setAttribute('data-processed-text', cachedRomanized);
                        }
                        Shimmer.remove(line);
                        EagerCache.cacheLyricElement(line);
                    } else {
                        // Show shimmer while waiting
                        Shimmer.add(line);

                        // Attempt batching
                        const Providers = window.SpotifyLyrics.Providers;
                        const ScriptDetection = window.SpotifyLyrics.ScriptDetection;

                        let queued = false;
                        if (ScriptDetection && Providers) {
                            const segments = ScriptDetection.splitTextByScript(originalText);
                            // Only batch if single script segment (simple case)
                            if (segments.length === 1) {
                                const script = segments[0].script;
                                const providerName = ScriptDetection.getProviderForScript(script);
                                if (providerName !== 'none' && Providers[providerName] && typeof Providers[providerName].convertBatch === 'function') {
                                    this.addToRomanizationBatch(providerName, line, originalText);
                                    queued = true;
                                }
                            }
                        }

                        if (!queued) {
                            // Immediate processing fallback
                            this.getRomanizedText(originalText).then(romanized => {
                                Utils.ignoreMutations(() => {
                                    if (!line.isConnected) return;
                                    if (State.currentMode !== 'romanized') return; // Mode changed
                                    if (line.innerText !== romanized) {
                                        line.innerText = romanized;
                                        line.setAttribute('data-processed-text', romanized);
                                    }
                                    Shimmer.remove(line);
                                    EagerCache.cacheLyricElement(line);
                                });
                            }).catch(err => {
                                console.warn('[Romanization] Error processing line:', err);
                                Shimmer.remove(line);
                            });
                        }
                    }
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
