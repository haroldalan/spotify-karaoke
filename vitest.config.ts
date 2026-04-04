import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
    plugins: [preact()],
    test: {
        environment: 'jsdom',
        setupFiles: ['./vitest.setup.ts'],
        globals: true,
    },
    resolve: {
        alias: {
            'wxt/client': '/tests/mocks/wxt-client.ts',
        },
    },
});
