// Spotify Lyrics Extension - Processor Module

window.SpotifyLyrics = window.SpotifyLyrics || {};

(function () {
    const State = window.SpotifyLyrics.State;
    const Utils = window.SpotifyLyrics.Utils;
    const Shimmer = window.SpotifyLyrics.Shimmer;
    const EagerCache = window.SpotifyLyrics.EagerCache;
    // ScriptDetection is less used now that we have Romanization Manager, 
    // but maybe still useful for other things? 
    // Actually Romanization Manager handles detection internally now for romanization purposes.

    const Processor = {
        batchQueue: new Set(),
        batchTimeout: null,
        observer: null,
        batchMap: new Map(),

        init: function () {
            this.observer = null;
            this.batchMap = new Map();
            this.batchTimeout = null;
            if (window.SpotifyLyrics.Romanization && window.SpotifyLyrics.Romanization.Manager) {
                window.SpotifyLyrics.Romanization.Manager.init();
            }
        },

        startLyricsObserver: function (container) {
            if (this.observer) this.observer.disconnect();

            this.observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1 && node.matches(window.SpotifyLyrics.Constants.LYRIC_SELECTOR)) {
                            // Eager Check: immediately restore if possible to prevent flicker
                            if (EagerCache.restoreLyricFromCache(node)) {
                                return; // Optimization: Skip processing if cache hit
                            }
                            this.processLine(node);
                        }
                    });
                });
            });

            this.observer.observe(container, { childList: true, subtree: true });

            // Fix for Song Change / Initial Load Race Condition
            const existingLines = container.querySelectorAll(window.SpotifyLyrics.Constants.LYRIC_SELECTOR);
            existingLines.forEach(line => {
                if (EagerCache.restoreLyricFromCache(line)) return;
                this.processLine(line, true);
            });
        },

        processLine: function (line, isInitialLoad = false) {
            if (line.hasAttribute('data-processed')) return;
            line.setAttribute('data-processed', 'true');

            const originalText = line.innerText;
            line.setAttribute('data-original-text', originalText);

            // -- Romanization Flow (Async) --
            this.handleRomanization(line, originalText);

            // -- Translation Flow (Batched/Async) --
            const currentMode = State.mode;
            if (currentMode === 'translated') {
                if (State.translationCache.has(originalText)) {
                    const translated = State.translationCache.get(originalText);
                    line.innerText = translated;
                    line.setAttribute('data-processed-text', translated);
                    EagerCache.cacheLyricElement(line);
                } else {
                    Shimmer.add(line);
                    this.addToBatch(line, originalText);
                }
            } else if (currentMode === 'romanized') {
                // If we are in romanized mode, handleRomanization will update the text when promise resolves.
                // But we should check if we already have it cached to avoid flash?
                const cachedRom = line.getAttribute('data-romanized-text');
                if (cachedRom) {
                    line.innerText = cachedRom;
                    line.setAttribute('data-processed-text', cachedRom);
                    EagerCache.cacheLyricElement(line);
                } else {
                    // It's coming... show shimmer?
                    Shimmer.add(line);
                }
            }
        },

        handleRomanization: function (line, originalText) {
            if (line.hasAttribute('data-romanized-text')) return;

            const Manager = window.SpotifyLyrics.Romanization.Manager;
            if (!Manager) return;

            Manager.convert(originalText).then(romanized => {
                // Check if line is still valid
                if (!line.isConnected) return;

                line.setAttribute('data-romanized-text', romanized);

                // If mode is currently romanized, update UI
                if (State.mode === 'romanized') {
                    Utils.ignoreMutations(() => {
                        line.innerText = romanized;
                        line.setAttribute('data-processed-text', romanized);
                        Shimmer.remove(line);
                        EagerCache.cacheLyricElement(line);
                    });
                } else {
                    // If mode swapped while we were converting, just remove shimmer if it was there (unlikely if not romanized mode)
                    if (line.getAttribute('data-processed-text') === originalText) {
                        Shimmer.remove(line);
                    }
                }
            });
        },

        addToBatch: function (line, text) {
            if (!this.batchMap) this.batchMap = new Map();
            this.batchMap.set(line, text);

            if (this.batchTimeout) clearTimeout(this.batchTimeout);
            this.batchTimeout = setTimeout(() => {
                this.flushBatch();
            }, 200);
        },

        flushBatch: async function () {
            if (!this.batchMap || this.batchMap.size === 0) return;

            const batch = Array.from(this.batchMap.entries());
            this.batchMap.clear();
            this.batchTimeout = null;

            const targetLanguage = State.targetLanguage;
            const uniqueTexts = [...new Set(batch.map(([_, text]) => text))];
            const textsToTranslate = uniqueTexts.filter(text => !State.translationCache.has(text));

            if (textsToTranslate.length === 0) {
                this.applyBatchResults(batch);
                return;
            }

            try {
                const fullText = textsToTranslate.join('\n');

                if (window.googleTranslate) {
                    const fetchPromise = window.googleTranslate.translate(fullText, targetLanguage);
                    // 8s timeout
                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000));

                    const resultBlob = await Promise.race([fetchPromise, timeoutPromise]);
                    if (State.targetLanguage !== targetLanguage) return;

                    const translatedResults = resultBlob.split('\n');

                    textsToTranslate.forEach((original, index) => {
                        if (translatedResults[index]) {
                            State.saveTranslation(original, translatedResults[index].trim());
                        }
                    });
                } else {
                    console.warn("Google Translate function not available");
                    textsToTranslate.forEach(t => State.translationCache.set(t, `[${State.targetLanguage}] ${t}`));
                }

                this.applyBatchResults(batch);

            } catch (e) {
                console.error("Batch processing error", e);
                batch.forEach(([line, _]) => Shimmer.remove(line));
            }
        },

        applyBatchResults: function (batch) {
            Utils.ignoreMutations(() => {
                batch.forEach(([line, originalText]) => {
                    if (!line.isConnected) return;

                    if (State.translationCache.has(originalText)) {
                        const translated = State.translationCache.get(originalText);
                        if (State.mode === 'translated') {
                            line.innerText = translated;
                            line.setAttribute('data-processed-text', translated);
                            Shimmer.remove(line);
                            EagerCache.cacheLyricElement(line);
                        }
                    } else {
                        Shimmer.remove(line);
                    }
                });
            });
        },

        applyModeToAll: function () {
            EagerCache.clear();
            const lyricsLines = document.querySelectorAll(window.SpotifyLyrics.Constants.LYRIC_SELECTOR);
            lyricsLines.forEach(line => {
                line.removeAttribute('data-processed'); // Force re-process
                this.processLine(line, false);
            });
        },

        resetTranslatedLines: function () {
            // This is called when switching modes usually
            EagerCache.clear();
            const lyricsLines = document.querySelectorAll(window.SpotifyLyrics.Constants.LYRIC_SELECTOR);
            lyricsLines.forEach(line => {
                const original = line.getAttribute('data-original-text');
                if (original) {
                    Utils.ignoreMutations(() => {
                        line.innerText = original;
                    });
                }
                Shimmer.remove(line);
            });
            if (this.batchMap) this.batchMap.clear();

            // Re-apply mode logic
            this.applyModeToAll();
        }
    };

    window.SpotifyLyrics.Processor = Processor;
})();
