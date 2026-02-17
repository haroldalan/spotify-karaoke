// Spotify Lyrics Extension - Romanization Providers Module
// Each provider: { check(text) -> bool, convert(text) -> Promise<string> }

window.SpotifyLyrics = window.SpotifyLyrics || {};

(function () {
    // ═══════════════════════════════════════════════
    // Japanese Provider (Kuroshiro + Kuromoji)
    // ═══════════════════════════════════════════════
    let kuroshiroInstance = null;
    let kuroshiroReady = false;
    let kuroshiroInitPromise = null;

    /**
     * Initialize Kuroshiro lazily on first Japanese romanization request.
     * Uses kuromoji dict files from extension's web_accessible_resources.
     */
    async function initKuroshiro() {
        if (kuroshiroReady) return;
        if (kuroshiroInitPromise) return kuroshiroInitPromise;

        kuroshiroInitPromise = (async () => {
            try {
                const Kuroshiro = window.Kuroshiro;
                const KuromojiAnalyzer = window.KuromojiAnalyzer;
                if (!Kuroshiro || !KuromojiAnalyzer) {
                    throw new Error('Kuroshiro or KuromojiAnalyzer not loaded');
                }
                kuroshiroInstance = new Kuroshiro();
                const dictPath = chrome.runtime.getURL('dict');
                const analyzer = new KuromojiAnalyzer({ dictPath: dictPath });
                await kuroshiroInstance.init(analyzer);
                kuroshiroReady = true;
                console.log('[Spotify Lyrics] Kuroshiro initialized successfully');
            } catch (err) {
                console.warn('[Spotify Lyrics] Kuroshiro init failed:', err);
                kuroshiroInitPromise = null; // Allow retry
                throw err;
            }
        })();

        return kuroshiroInitPromise;
    }

    /**
     * Fetch phonetic romanization from Google Translate API.
     * Uses undocumented 'client=gtx' API with 'dt=rm' (romanization) flag.
     * Supports newline-separated batch input.
     */
    async function fetchGoogleRomanization(text, lang = 'ar') {
        try {
            // dt=t (translation) + dt=rm (romanization) ensures standard structure
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${lang}&tl=en&dt=t&dt=rm&q=${encodeURIComponent(text)}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Google API status: ${response.status}`);

            const data = await response.json();
            // Expected format: [ [ ["Trans","Orig",..], [null,null,"Romanization"] ], ... ]

            if (data && data[0] && Array.isArray(data[0])) {
                // Collect all romanization parts
                // Google might return one item with "A\nB" OR multiple items ["A\n", "B"]
                // We join them all and let the caller split if needed.
                let combinedRomanization = '';
                let found = false;

                // Robust strategy: Looks for the romanization field (index 2 or 3) in all segments
                for (const item of data[0]) {
                    if (Array.isArray(item)) {
                        const rom = (typeof item[2] === 'string' && item[2]) ||
                            (typeof item[3] === 'string' && item[3]);

                        if (rom) {
                            combinedRomanization += rom;
                            found = true;
                        }
                    }
                }

                if (found) return combinedRomanization;

                // Fallback: Check standard locations if loop failed (legacy check)
                const lastItem = data[0][data[0].length - 1];
                if (Array.isArray(lastItem)) {
                    const rom = (typeof lastItem[2] === 'string' && lastItem[2]) ||
                        (typeof lastItem[3] === 'string' && lastItem[3]);
                    if (rom) return rom;
                }
            }
            return null;
        } catch (e) {
            console.warn('[Providers] Google romanization failed:', e);
            return null;
        }
    }

    // ═══════════════════════════════════════════════
    // Sanscript script-name mapping for Indic scripts
    // ═══════════════════════════════════════════════
    const INDIC_SCRIPT_MAP = {
        'Devanagari': 'devanagari',
        'Telugu': 'telugu',
        'Kannada': 'kannada',
        'Thai': 'thai',
    };

    // ═══════════════════════════════════════════════
    // Aksharamukha API script-name mapping
    // ═══════════════════════════════════════════════
    const AKSHARAMUKHA_SCRIPT_MAP = {
        'Tamil': 'Tamil',
        'Malayalam': 'Malayalam',
        'Bengali': 'Bengali',
    };

    // ═══════════════════════════════════════════════
    // Provider Definitions
    // ═══════════════════════════════════════════════
    const Providers = {
        /**
         * Korean — uses @romanize/korean (Revised Romanization)
         */
        korean: {
            check: function (text) {
                return /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7AF\uD7B0-\uD7FF]/g.test(text);
            },
            convert: async function (text) {
                if (!window.koreanRomanize || !window.koreanRomanize.romanize) {
                    console.warn('[Providers] Korean romanizer not loaded');
                    return text;
                }
                try {
                    // Process char-by-char: only romanize Hangul syllable blocks,
                    // pass through non-Hangul characters as-is
                    let result = '';
                    let hangulBuffer = '';
                    for (const char of text) {
                        const code = char.charCodeAt(0);
                        if (code >= 0xAC00 && code <= 0xD7AF) {
                            hangulBuffer += char;
                        } else {
                            if (hangulBuffer) {
                                result += window.koreanRomanize.romanize(hangulBuffer, { system: 'RR' });
                                hangulBuffer = '';
                            }
                            result += char;
                        }
                    }
                    if (hangulBuffer) {
                        result += window.koreanRomanize.romanize(hangulBuffer, { system: 'RR' });
                    }
                    return result;
                } catch (err) {
                    console.warn('[Providers] Korean romanization error:', err);
                    return text;
                }
            }
        },

        /**
         * Japanese — uses @sglkc/kuroshiro + kuromoji
         */
        japanese: {
            check: function (text) {
                return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text);
            },
            convert: async function (text) {
                try {
                    await initKuroshiro();
                    if (!kuroshiroInstance) return text;
                    return await kuroshiroInstance.convert(text, {
                        to: 'romaji',
                        mode: 'spaced',
                        romajiSystem: 'hepburn'
                    });
                } catch (err) {
                    console.warn('[Providers] Japanese romanization error:', err);
                    // Fallback to generic transliteration
                    return Providers.any.convert(text);
                }
            }
        },

        /**
         * Chinese — uses pinyin-pro
         */
        chinese: {
            check: function (text) {
                return /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text);
            },
            convert: async function (text) {
                if (!window.pinyinPro || !window.pinyinPro.pinyin) {
                    console.warn('[Providers] pinyin-pro not loaded');
                    return text;
                }
                try {
                    return window.pinyinPro.pinyin(text);
                } catch (err) {
                    console.warn('[Providers] Chinese romanization error:', err);
                    return text;
                }
            }
        },

        /**
         * Cyrillic — uses cyrillic-to-translit-js
         */
        cyrillic: {
            check: function (text) {
                return /[\u0400-\u04FF]/.test(text);
            },
            convert: async function (text) {
                if (!window.CyrillicToTranslit) {
                    console.warn('[Providers] CyrillicToTranslit not loaded');
                    return text;
                }
                try {
                    const translit = new window.CyrillicToTranslit();
                    return translit.transform(text);
                } catch (err) {
                    console.warn('[Providers] Cyrillic romanization error:', err);
                    return text;
                }
            }
        },

        /**
         * Indic scripts (Hindi, Telugu, Kannada, Marathi, Thai)
         * Uses @indic-transliteration/sanscript
         */
        indic: {
            _detectedScript: null,

            check: function (text) {
                // Devanagari, Telugu, Kannada, Thai
                return /[\u0900-\u097F\u0C00-\u0C7F\u0C80-\u0CFF\u0E00-\u0E7F]/.test(text);
            },

            /**
             * Detect which Indic script is dominant in the text.
             */
            _detectScript: function (text) {
                const ScriptDetection = window.SpotifyLyrics.ScriptDetection;
                if (!ScriptDetection) return null;

                for (const char of text) {
                    const script = ScriptDetection.getScript(char);
                    if (script in INDIC_SCRIPT_MAP) {
                        return INDIC_SCRIPT_MAP[script];
                    }
                }
                return null;
            },

            convert: async function (text) {
                if (!window.Sanscript || !window.Sanscript.t) {
                    console.warn('[Providers] Sanscript not loaded');
                    return Providers.any.convert(text);
                }
                try {
                    const sourceScript = this._detectScript(text);
                    if (!sourceScript) return text;
                    // Transliterate to IAST (International Alphabet of Sanskrit Transliteration)
                    return window.Sanscript.t(text, sourceScript, 'iast');
                } catch (err) {
                    console.warn('[Providers] Indic romanization error:', err);
                    return Providers.any.convert(text);
                }
            }
        },

        /**
         * Aksharamukha (Tamil, Malayalam, Bengali)
         * Uses Aksharamukha REST API for high-quality transliteration
         * API: https://aksharamukha-plugin.appspot.com/api/public
         */
        aksharamukha: {
            check: function (text) {
                // Tamil, Malayalam, Bengali
                return /[\u0980-\u09FF\u0B80-\u0BFF\u0D00-\u0D7F]/.test(text);
            },

            _detectScript: function (text) {
                const ScriptDetection = window.SpotifyLyrics.ScriptDetection;
                if (!ScriptDetection) return null;

                for (const char of text) {
                    const script = ScriptDetection.getScript(char);
                    if (script in AKSHARAMUKHA_SCRIPT_MAP) {
                        return AKSHARAMUKHA_SCRIPT_MAP[script];
                    }
                }
                return null;
            },

            convert: async function (text) {
                try {
                    const sourceScript = this._detectScript(text);
                    if (!sourceScript) return text;

                    const params = new URLSearchParams({
                        source: sourceScript,
                        target: 'IAST',
                        text: text
                    });

                    const url = 'https://aksharamukha-plugin.appspot.com/api/public';

                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: params.toString()
                    });

                    if (!response.ok) {
                        throw new Error(`Aksharamukha API error: ${response.status}`);
                    }

                    const result = await response.text();
                    return result || text;
                } catch (err) {
                    console.warn('[Providers] Aksharamukha API error:', err);
                    // Fallback to generic transliteration
                    return Providers.any.convert(text);
                }
            },

            /**
             * Batch conversion for Aksharamukha
             */
            convertBatch: async function (texts) {
                if (!texts || texts.length === 0) return [];

                const firstText = texts[0];
                const sourceScript = this._detectScript(firstText);
                if (!sourceScript) return texts;

                try {
                    const joined = texts.join('\n');
                    const params = new URLSearchParams({
                        source: sourceScript,
                        target: 'IAST',
                        text: joined
                    });

                    const url = 'https://aksharamukha-plugin.appspot.com/api/public';
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: params.toString()
                    });

                    if (!response.ok) throw new Error(`API Error ${response.status}`);

                    const result = await response.text();
                    if (!result) return texts;

                    const split = result.split('\n');
                    if (split.length !== texts.length) {
                        console.warn('[Aksharamukha] Batch length mismatch, falling back to sequential');
                        throw new Error('Length mismatch');
                    }
                    return split;
                } catch (e) {
                    console.warn('[Aksharamukha] Batch error, falling back to sequential:', e);
                    // Sequential Fallback
                    const results = [];
                    for (const t of texts) {
                        // We use the single convert method which now also supports POST
                        results.push(await this.convert(t));
                    }
                    return results;
                }
            }
        },
        /**
         * Arabic — Tiered strategy:
         * 1. Google Translate API (Phonetic romanization) - Best quality, includes vowels
         * 2. Aksharamukha API (ISO 233) - Transliteration
         * 3. Local Fallback (Arabic Services + Generic) - Worst quality (no vowels)
         */
        arabic: {
            check: function (text) {
                return /[\u0600-\u06FF\u0750-\u077F]/.test(text);
            },
            convert: async function (text) {
                // Tier 1: Google Translate (Phonetic)
                const googleResult = await fetchGoogleRomanization(text, 'ar');
                if (googleResult) return googleResult.trim();

                // Tier 2: Aksharamukha API (ISO)
                try {
                    const params = new URLSearchParams({
                        source: 'Arab',
                        target: 'ISO',
                        text: text
                    });
                    const url = 'https://aksharamukha-plugin.appspot.com/api/public';

                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: params.toString()
                    });

                    if (response.ok) {
                        const result = await response.text();
                        if (result) return result;
                    }
                } catch (err) {
                    console.warn('[Providers] Arabic Aksharamukha fallback failed:', err);
                }

                // Tier 3: Local Fallback
                try {
                    let processed = text;
                    if (window.ArabicServices && window.ArabicServices.removeTashkeel) {
                        processed = window.ArabicServices.removeTashkeel(processed);
                    }
                    return await Providers.any.convert(processed);
                } catch (err) {
                    console.warn('[Providers] Arabic local fallback error:', err);
                    return text;
                }
            },

            convertBatch: async function (texts) {
                if (!texts || texts.length === 0) return [];

                // Tier 1: Google Translate Batch
                try {
                    const joined = texts.join('\n');
                    const googleResult = await fetchGoogleRomanization(joined, 'ar');

                    if (googleResult) {
                        const split = googleResult.split('\n');
                        // Basic alignment check (Google sometimes trims trailing newlines)
                        if (split.length === texts.length) return split;
                    }
                } catch (e) {
                    console.warn('[Arabic] Batch Google failed:', e);
                }

                // Fallback: Sequential processing
                const results = [];
                for (const t of texts) {
                    results.push(await this.convert(t));
                }
                return results;
            }
        },

        /**
         * Generic fallback — uses yf-hk/transliteration
         */
        any: {
            check: function (text) {
                return /[\p{L}\p{N}]+/u.test(text);
            },
            convert: async function (text) {
                if (window.transliteration && window.transliteration.transliterate) {
                    try {
                        return window.transliteration.transliterate(text);
                    } catch (err) {
                        console.warn('[Providers] Generic transliteration error:', err);
                    }
                }
                // Absolute fallback: slugify
                if (window.transliteration && window.transliteration.slugify) {
                    try {
                        return window.transliteration.slugify(text, { separator: ' ' });
                    } catch (err) {
                        // Silent fail
                    }
                }
                return text;
            }
        }
    };

    window.SpotifyLyrics.Providers = Providers;
})();
