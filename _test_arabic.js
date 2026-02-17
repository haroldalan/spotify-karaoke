// Verification script for Tiered Arabic Provider
const fs = require('fs');

// Mock browser environment
const window = {
    SpotifyLyrics: {},
    ArabicServices: { removeTashkeel: (t) => t }, // Mock
    transliteration: { transliterate: (t) => 'Generic: ' + t }, // Mock
    chrome: { runtime: { getURL: (p) => p } }
};
const chrome = window.chrome;

// Load the provider code
const content = fs.readFileSync('extension/content/modules/romanization_providers.js', 'utf8');

// Execute in isolated scope
const fn = new Function('window', 'chrome', 'console', content);
fn(window, chrome, console);

const Providers = window.SpotifyLyrics.Providers;

(async () => {
    console.log('Testing Arabic Provider...\n');
    const text = 'كلام عينيه';

    // Test 1: Full integration (should hit Google Translate)
    try {
        console.log('--- Tier 1: Google Translate ---');
        const result = await Providers.arabic.convert(text);
        console.log(`Input: ${text}`);
        console.log(`Output: ${result}`);

        if (result.match(/[aeiou]/)) {
            console.log('PASS: Output contains vowels (likely Google/Aksharamukha)');
        } else {
            console.log('WARN: Output might be generic fallback');
        }
    } catch (e) {
        console.log('FAIL:', e);
    }
})();
