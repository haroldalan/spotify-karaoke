const fs = require('fs');
const path = require('path');
const vm = require('vm');

// -----------------------------------------------------------------------------
// 1. Setup Mock Browser Environment
// -----------------------------------------------------------------------------
global.window = {
    SpotifyLyrics: {},
    location: { href: 'https://open.spotify.com' },
    console: console
};
global.document = {
    createElement: (tag) => {
        const el = {
            tagName: tag.toUpperCase(),
            style: {},
            classList: {
                add: () => { },
                remove: () => { },
                contains: () => false
            },
            setAttribute: (k, v) => el[k] = v,
            getAttribute: (k) => el[k],
            appendChild: () => { },
            isConnected: true,
            _text: '',

            get innerText() { return this._text; },
            set innerText(v) { this._text = v; this._html = v; },

            _html: '',
            get innerHTML() { return this._html; },
            set innerHTML(v) { this._html = v; this._text = v.replace(/<[^>]*>/g, ''); } // Very basic strip tags
        };
        return el;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild: () => { } }
};
global.chrome = {
    storage: {
        local: {
            get: (keys, cb) => cb({}),
            set: (items, cb) => cb && cb(),
        }
    },
    runtime: {
        getManifest: () => ({ version: '1.2.0' }),
        getURL: (path) => path
    }
};

// Storage Mock Helper
const storageListeners = [];
global.chrome.storage.onChanged = {
    addListener: (cb) => storageListeners.push(cb),
    // Test helper to trigger events
    dispatch: (changes, namespace) => storageListeners.forEach(cb => cb(changes, namespace))
};
global.MutationObserver = class {
    constructor(cb) { }
    observe() { }
    disconnect() { }
};
global.fetch = async () => ({
    ok: true,
    json: async () => ({}),
    text: async () => ''
});

// Helper to load extension modules
function loadModule(relativePath) {
    const fullPath = path.join(__dirname, '../extension/content', relativePath);
    if (!fs.existsSync(fullPath)) {
        throw new Error(`Module not found: ${fullPath}`);
    }
    const code = fs.readFileSync(fullPath, 'utf8');
    vm.runInThisContext(code, { filename: fullPath });
}

// -----------------------------------------------------------------------------
// 2. Load Extension Modules
// -----------------------------------------------------------------------------
console.log('Loading modules...');
loadModule('modules/constants.js');
loadModule('modules/utils.js');
loadModule('modules/state.js'); // Depends on Utils
loadModule('modules/script_detection.js');
loadModule('modules/romanization_providers.js'); // Depends on ScriptDetection
loadModule('modules/eager_cache.js');
loadModule('modules/shimmer.js');
loadModule('modules/renderer.js'); // Depends on Utils, Shimmer, EagerCache
loadModule('modules/processor.js'); // Depends on State, Renderer, etc.

console.log('Modules loaded successfully.\n');

// -----------------------------------------------------------------------------
// 3. Run Tests
// -----------------------------------------------------------------------------

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion Failed: ${message}`);
    }
    process.stdout.write('.');
}

function test(name, fn) {
    try {
        process.stdout.write(`Testing ${name} `);
        fn();
        console.log(' PASS');
    } catch (err) {
        console.log(' FAIL');
        console.error(err);
        fs.writeFileSync('tests/error.log', err.stack || err.toString());
        process.exit(1);
    }
}

// TEST SUITE: Script Detection
test('ScriptDetection', () => {
    const SD = window.SpotifyLyrics.ScriptDetection;

    // Basic Scripts
    assert(SD.getScript('안녕하세요') === 'Hangul', 'Hangul detection'); // Korean
    assert(SD.getScript('こんにちは') === 'Hiragana', 'Hiragana detection'); // Japanese
    assert(SD.getScript('你好') === 'Han', 'Han detection'); // Chinese
    assert(SD.getScript('Привет') === 'Cyrillic', 'Cyrillic detection'); // Russian
    assert(SD.getScript('Hello World') === 'Latin', 'Latin detection'); // English

    // Complex / Mixed
    const segments = SD.splitTextByScript('Hello 안녕하세요 123');
    assert(segments.length >= 2, 'Split mixed script');
    assert(segments.some(s => s.script === 'Hangul'), 'Contains Hangul segment');

    // Arabic
    assert(SD.getScript('مرحبا') === 'Arabic', 'Arabic detection');
});

// TEST SUITE: State Management
test('State Management', () => {
    const State = window.SpotifyLyrics.State;

    // Initial Verification
    assert(State.dualLyrics === false, 'Default dualLyrics should be false');

    // Simulate Storage Change
    // We register a listener via State.onChange first (which calls chrome.storage.onChanged.addListener)
    let callbackCalled = false;
    State.onChange((changes) => {
        callbackCalled = true;
    });

    const changes = { dualLyrics: { newValue: true } };
    // Trigger the mock event
    chrome.storage.onChanged.dispatch(changes, 'local');

    assert(State.dualLyrics === true, 'State updated from listener');
    assert(callbackCalled === true, 'External callback triggered');
});

// TEST SUITE: Renderer (Mock DOM)
test('Renderer Dual Lyrics', () => {
    const Renderer = window.SpotifyLyrics.Renderer;
    const State = window.SpotifyLyrics.State;

    // Create mock element
    const line = document.createElement('div');
    line.innerText = 'Current Text';

    // Test 1: Dual Lyrics Disabled
    State.dualLyrics = false;
    Renderer.applyText(line, 'Translated Text', 'Original Text');
    assert(line.innerText === 'Translated Text', 'Single line text update');
    assert(line.innerHTML === 'Translated Text', 'Single line HTML check');

    // Test 2: Dual Lyrics Enabled
    State.dualLyrics = true;
    Renderer.applyText(line, 'Translated Text', 'Original Text');
    // Expected: Translated<br><span class="sub-lyric">Original</span>
    const expectedHTML = 'Translated Text<br><span class="sub-lyric">Original Text</span>';
    assert(line.innerHTML === expectedHTML, 'Dual line HTML structure correct');

    // Test 3: Same Text (Should ignore dual)
    Renderer.applyText(line, 'Same', 'Same');
    assert(line.innerText === 'Same', 'Same text results in single line');
});

// TEST SUITE: Processor Integration
test('Processor Romanization Flow', async () => {
    const Processor = window.SpotifyLyrics.Processor;
    const Renderer = window.SpotifyLyrics.Renderer;
    const State = window.SpotifyLyrics.State;

    // Reset
    State.currentMode = 'romanized';
    State.dualLyrics = true;

    // Mock Renderer spy
    let lastRender = {};
    Renderer.applyText = (line, text, orig) => {
        lastRender = { text, orig };
    };

    // Mock Romanization
    Processor.getRomanizedText = async (text) => `Romanized(${text})`;

    // Create line
    const line = document.createElement('div');
    line.innerText = 'Original';
    line.setAttribute = (k, v) => line[k] = v;
    line.getAttribute = (k) => line[k];
    line.isConnected = true;

    // Execute
    await Processor.processLine(line);

    // Wait for async
    await new Promise(r => setTimeout(r, 50));

    // Verify
    // Note: Since we mocked getRomanizedText, we check if applyText was called with both args
    assert(lastRender.orig === 'Original', 'Processor passed original text to Renderer');
});

console.log('\nAll tests passed successfully!');
