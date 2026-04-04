import { vi } from 'vitest';

// Mock WebExtension browser API
const browserMock = {
    runtime: {
        id: 'test-id',
        onMessage: {
            addListener: vi.fn(),
        },
        sendMessage: vi.fn(),
    },
    storage: {
        sync: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
            clear: vi.fn().mockResolvedValue(undefined),
        },
        local: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: {
            addListener: vi.fn(),
        }
    },
};

// Assign mock to global
(global as any).browser = browserMock;
(global as any).defineBackground = (fn: Function) => fn;
(global as any).defineContentScript = (config: any) => config;
(global as any).defineUnlistedScript = (fn: Function) => fn();
