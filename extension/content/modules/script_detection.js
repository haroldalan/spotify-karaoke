// Spotify Lyrics Extension - Script Detection Module
// Ported from Moegi's script-detection.ts (custom Regex implementation for vanilla JS)

window.SpotifyLyrics = window.SpotifyLyrics || {};

(function () {
    const ScriptDetection = {

        /**
         * Determine the script of a character code.
         * Simplified regex-based detection for common scripts.
         * @param {string} char 
         */
        getScript: function (char) {
            if (!char) return 'Common';
            const code = char.charCodeAt(0);

            // Common/Punctuation/Numbers (Basic Latin range + some general punctuation)
            // This is a heuristic. 
            if (code < 0x41) return 'Common'; // Space, numbers, symbols

            // Latin (A-Z, a-z)
            if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) return 'Latin';

            // Hiragana: 3040-309F
            if (code >= 0x3040 && code <= 0x309F) return 'Hiragana';

            // Katakana: 30A0-30FF
            if (code >= 0x30A0 && code <= 0x30FF) return 'Katakana';

            // CJK Unified Ideographs (Han/Kanji): 4E00-9FFF (roughly)
            if (code >= 0x4E00 && code <= 0x9FFF) return 'Han';

            // Hangul (Korean): AC00-D7AF (Syllables) + 1100-11FF (Jamo)
            if ((code >= 0xAC00 && code <= 0xD7AF) || (code >= 0x1100 && code <= 0x11FF)) return 'Hangul';

            // Cyrillic: 0400-04FF
            if (code >= 0x0400 && code <= 0x04FF) return 'Cyrillic';

            // Tamil: 0B80-0BFF
            if (code >= 0x0B80 && code <= 0x0BFF) return 'Tamil';

            return 'Common'; // Treat others as Common for now
        },

        /**
         * Determine if two scripts should be mergeable into one segment.
         */
        scriptsMergeable: function (script1, script2) {
            if (script1 === script2) {
                return { merge: true, resultScript: script1 };
            }

            // Merge Han with Hiragana or Katakana for Japanese
            if (
                (script1 === "Han" && (script2 === "Hiragana" || script2 === "Katakana")) ||
                ((script1 === "Hiragana" || script1 === "Katakana") && script2 === "Han")
            ) {
                // Keep the 'Japanese' identifier (Hiragana/Katakana) over generic 'Han'
                return { merge: true, resultScript: script1 === "Han" ? script2 : script1 };
            }

            // Merge Hiragana with Katakana
            if (
                (script1 === "Hiragana" && script2 === "Katakana") ||
                (script1 === "Katakana" && script2 === "Hiragana")
            ) {
                return { merge: true, resultScript: script1 }; // Keep first
            }

            return { merge: false, resultScript: null };
        },

        /**
         * Split text into segments by script.
         * @param {string} text 
         * @returns {Array<{text: string, script: string}>}
         */
        splitTextByScript: function (text) {
            if (!text) return [];

            const charEntries = Array.from(text).map(char => ({ text: char, script: this.getScript(char) }));
            const merged = [];

            let currentText = "";
            let currentScript = null;

            for (const entry of charEntries) {
                const text = entry.text;
                const script = entry.script;

                if (script === "Common" || script === "Latin") {
                    // HEURISTIC CHANGE: Treat Latin as 'Common'-ish for the purpose of keeping it with the surrounding script?
                    // Moegi treats Latin as 'none' provider.
                    // If we have "Hello世界", we want "Hello" (Latin) and "世界" (Han).
                    // If we have "わぁ!" (Hiragana + Common), we want "わぁ!" (Hiragana).

                    if (script === "Common") {
                        if (currentScript !== null) {
                            currentText += text;
                        } else {
                            currentText += text;
                        }
                        continue;
                    }
                    // For Latin, we break if previous was Asian, but might merge valid latin blocks
                }

                // If it is NOT common
                if (currentScript === null) {
                    currentScript = script;
                    currentText += text;
                } else {
                    const mergeResult = this.scriptsMergeable(currentScript, script);
                    if (mergeResult.merge) {
                        currentText += text;
                        currentScript = mergeResult.resultScript;
                    } else {
                        // Push current
                        merged.push({ text: currentText, script: currentScript || "Common" });
                        // Start new
                        currentText = text;
                        currentScript = script;
                    }
                }
            }

            if (currentText) {
                merged.push({
                    text: currentText,
                    script: currentScript || "Common"
                });
            }

            return merged;
        },

        /**
         * Get the provider name for a script name.
         */
        getProviderForScript: function (script) {
            switch (script) {
                case 'Hiragana':
                case 'Katakana':
                    return 'japanese';
                case 'Hangul':
                    return 'korean';
                case 'Han':
                    return 'chinese'; // Fallback to Chinese for pure Han, but Japanese context might prefer Japanese
                case 'Cyrillic':
                    return 'cyrillic';
                case 'Tamil':
                    return 'any'; // Use generic romanizer for Tamil
                case 'Latin':
                case 'Common':
                default:
                    return 'none';
            }
        }
    };

    window.SpotifyLyrics.ScriptDetection = ScriptDetection;
})();
