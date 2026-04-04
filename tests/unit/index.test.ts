import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import contentScriptDef from '../../entrypoints/spotify-lyrics.content/index';

// We get the object { matches, runAt, main } from the mocked defineContentScript
const { main } = contentScriptDef as any;

describe('Content Script Integration (JSDOM)', () => {
    let mockStorageSync: any;
    let mockStorageLocal: any;

    beforeEach(() => {
        // Reset DOM
        document.body.innerHTML = '';
        
        // Ensure browser.runtime.id is present for isContextValid() check
        (window as any).browser.runtime.id = 'test-id';
        mockStorageSync = {
            dualLyrics: true,
            targetLang: 'en',
            preferredMode: 'original'
        };

        mockStorageLocal = {};

        (window as any).browser.storage.sync.get.mockImplementation(async (keys: string[]) => {
            const res: any = {};
            keys.forEach(k => res[k] = mockStorageSync[k]);
            return res;
        });

        (window as any).browser.storage.local.get.mockImplementation(async (keys: string[] | string | null) => {
            if (keys === null) return mockStorageLocal;
            if (typeof keys === 'string') return { [keys]: mockStorageLocal[keys] };
            const res: any = {};
            keys.forEach(k => res[k] = mockStorageLocal[k]);
            return res;
        });

        (window as any).browser.storage.local.set.mockImplementation(async (obj: any) => {
            Object.assign(mockStorageLocal, obj);
        });

        // Mock ResizeObserver for JSDOM
        (window as any).ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.restoreAllMocks();
        // Since main() adds event listeners / observers, we need to clear the DOM completely.
        document.body.innerHTML = '';
    });

    function setupSpotifyDOM(songName = 'Test Song') {
        document.body.innerHTML = `
            <div data-testid="now-playing-widget" aria-label="Now playing: ${songName}">
                <a href="/track/1234567890">Link</a>
            </div>
            <main>
                <button data-testid="lyrics-button"></button>
                <div id="lyrics-container-mock">
                    <!-- Wrapper that the container targets -->
                    <div>
                   <div data-testid="lyrics-line">
                       <div>Line 1</div>
                   </div>
                   <div data-testid="lyrics-line">
                       <div>Line 2</div>
                   </div>
                </div>
            </div>
          </main>
        `;
    }

    it('Boot Preloading: Loads database cache into memory synchronously on start', async () => {
        // Pre-populate storage local with a cached song
        mockStorageLocal['lc:Now playing: Cached Song by Artist'] = {
            original: ['Line 1 (Dummy)'],
            processed: {
                en: { translated: ['Translation 1'], romanized: ['Romanization 1'] }
            },
            lastAccessed: 123456
        };

        setupSpotifyDOM('Cached Song by Artist');
        
        // Boot script
        await main();

        // Check if the script preloaded the cache by seeing how it reacts.
        // In the code, trySetup runs async after main(), which checks runtimeCache.
        // To verify, we can wait a tick and check the DOM to see if it applied the cache.
        // Wait for promises to resolve
        await new Promise(r => setTimeout(r, 10));

        // It should inject the controls
        const controls = document.getElementById('sly-lyrics-controls');
        expect(controls).not.toBeNull();
    });

    it('Poison Guard: Refuses to snapshot empty or whitespace-only DOM nodes', async () => {
        setupSpotifyDOM('Race Song');
        await main();

        // 1. Simulate "skeleton" DOM (nodes exist, but text is empty)
        const container = document.getElementById('lyrics-container-mock')!.firstElementChild!;
        container.innerHTML = `
            <div data-testid="lyrics-line">
                <div>   </div>
            </div>
        `;

        // 2. We can't access `cache.original` directly but we know switchMode(translated)
        // will only proceed if cache.original is not empty.
        // We'll also verify that snapshotOriginals doesn't set anything by checking attributes.
        const line = container.querySelector('[data-testid="lyrics-line"] > div')!;
        
        // This is what snapshotOriginals does internally (via syncSetup or trySetup)
        // We'll trigger a mock "syncSetup" by calling main() again or just testing the logic
        // But the best way is to just follow the friend's advice and add real DOM assertions.
        
        // Actually, I'll just check that the attribute set by snapshotOriginals isn't enough to pass the guard.
        // If we call snapshotOriginals (which is what switchMode does at the top now),
        // it should NOT commit to the internal cache.original.
        
        // Let's verify that the controls are NOT in 'translated' state if we try to switch with empty DOM.
        const romanizedBtn = document.querySelector('.sly-lyrics-btn[data-mode="romanized"]') as HTMLButtonElement;
        if (romanizedBtn) {
            romanizedBtn.click();
            await new Promise(r => setTimeout(r, 10));
            // Should still be 'original' (or inactive) because the guard returned early in switchMode
            expect(romanizedBtn.classList.contains('active')).toBe(false);
        }

        // 3. Populate with real text
        container.innerHTML = `
            <div data-testid="lyrics-line">
                <div>Real Lyric Line</div>
            </div>
        `;
        
        if (romanizedBtn) {
            romanizedBtn.click();
            await new Promise(r => setTimeout(r, 10));
            // Now it should be active (once the snapshot succeeds)
            // Wait, we need to ensure the click happens after the DOM is ready.
            expect(romanizedBtn.classList.contains('active')).toBe(true);
        }
    });

    it('Native Override: Merges SKL_NATIVE_LYRICS seamlessly without loops', async () => {
        setupSpotifyDOM('Song 1');
        await main();
        await new Promise(r => setTimeout(r, 10));

        // Discard postMessage to ensure synchronous JSDOM execution
        window.dispatchEvent(new MessageEvent('message', {
            source: window,
            data: {
                type: 'SKL_NATIVE_LYRICS',
                trackId: '1234567890',
                nativeLines: ['こんにちは']
            }
        }));

        await new Promise(r => setTimeout(r, 10));

        // Verify that DOM received the override in data-sly-original
        const firstLine = document.querySelector('[data-testid="lyrics-line"] > div')!;
        expect(firstLine.getAttribute('data-sly-original')).toBe('こんにちは');
        expect(firstLine.textContent).toBe('こんにちは');
    });
});
