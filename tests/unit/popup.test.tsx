import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import App from '../../entrypoints/popup/App';

describe('Popup App Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

        // Assert language defaults to Spanish (from our mock)
        await waitFor(() => {
            const select = screen.getByDisplayValue('Spanish') as HTMLSelectElement;
            expect(select.value).toBe('es');
        });

        // Assert checkbox defaults
        const checkbox = screen.getByRole('checkbox', { name: /dual lyrics mode/i }) as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
    });

    it('updates storage when changing language', async () => {
        render(<App />);

        await waitFor(() => {
            const select = screen.getByRole('combobox');
            fireEvent.change(select, { target: { value: 'ja' } });
        });

        expect(global.browser.storage.sync.set).toHaveBeenCalledWith({
            targetLang: 'ja'
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
        expect(await screen.findByText('Reset all settings to defaults?')).toBeDefined();

        // Click the 'OK' button inside the custom modal
        const okBtn = screen.getByText('OK');
        fireEvent.click(okBtn);

        // Wait for the clear logic to settle
        await waitFor(() => {
            expect((global as any).browser.storage.sync.set).toHaveBeenCalledWith({
                targetLang: 'en',
                dualLyrics: true,
                preferredMode: 'original'
            });
        });
    });
});
