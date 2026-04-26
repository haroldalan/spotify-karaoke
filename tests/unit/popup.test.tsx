import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import App from '../../entrypoints/popup/App';

function createLocalStorageMock() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
            store.set(key, String(value));
        },
        removeItem: (key: string) => {
            store.delete(key);
        },
        clear: () => {
            store.clear();
        },
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        get length() {
            return store.size;
        },
    };
}

describe('Popup App Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const localStorageMock = createLocalStorageMock();
        Object.defineProperty(globalThis, 'localStorage', {
            value: localStorageMock,
            configurable: true,
        });
        (global.browser.storage.sync.get as any).mockResolvedValue({
            targetLang: 'es',
            dualLyrics: true,
            preferredMode: 'original'
        });

        // Polyfill for text encoder in node environment
        if (typeof TextEncoder === 'undefined') {
            const { TextEncoder } = require('util');
            global.TextEncoder = TextEncoder;
        }
    });

    it('renders the initial state correctly with storage populated', async () => {
        render(<App />);

        // Assert title exists
        expect(screen.getAllByText('Spotify Karaoke')[0]).toBeDefined();

        // Assert language defaults to Spanish (from our storage mock)
        await waitFor(() => {
            expect(screen.getByText('Spanish')).toBeDefined();
        });

        // Assert checkbox defaults
        const checkbox = screen.getByRole('checkbox', { name: /dual lyrics mode/i }) as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
    });

    it('updates storage when changing language', async () => {
        render(<App />);

        // 1. Wait for async hydration (sets defaults from storage mock)
        await waitFor(() => expect(screen.getByText('Spanish')).toBeDefined());

        // 2. Open the dropdown
        const trigger = screen.getByRole('button', { name: /spanish/i });
        fireEvent.click(trigger);

        // 3. Find and select Japanese (use all/find + selector to avoid multiple match error)
        const options = await screen.findAllByText('Japanese');
        fireEvent.click(options[0]);

        // 4. Verify storage write
        await waitFor(() => {
            expect((global.browser.storage.sync.set as any)).toHaveBeenCalledWith({
                targetLang: 'ja'
            });
        });
    });

    it('updates storage when toggling dual lyrics', async () => {
        render(<App />);

        await waitFor(() => {
            const checkbox = screen.getByRole('checkbox', { name: /dual lyrics mode/i }) as HTMLInputElement;
            fireEvent.click(checkbox);
        });

        expect(global.browser.storage.sync.set).toHaveBeenCalledWith({
            dualLyrics: false
        });
    });

    it('processes custom reset modal logic', async () => {
        render(<App />);

        const resetBtn = screen.getByText('Reset Data');
        fireEvent.click(resetBtn);

        // Verify that the custom modal is displayed by looking for its text
        expect(await screen.findByText('Reset settings?')).toBeDefined();

        // Click the 'Reset' button inside the custom modal
        const okBtn = screen.getByText('Reset');
        fireEvent.click(okBtn);

        // Wait for the clear logic to settle
        await waitFor(() => {
            expect((global as any).browser.storage.sync.set).toHaveBeenCalledWith({
                targetLang: 'en',
                dualLyrics: true,
                preferredMode: 'original',
                showPill: true
            });
        });
    });
});
