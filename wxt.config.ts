import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import removeConsole from 'vite-plugin-remove-console';

const keepDebugLogs = process.env.SLY_DEBUG === '1';

export default defineConfig({
  zip: {
    // The Firefox sources zip is built from the project folder: never ship local test
    // material (live-logs holds a signed-in test browser profile) or page captures.
    excludeSources: ['live-logs/**', 'fiber*.json', 'home.html', 'lyrics.html', '.env*'],
  },
  vite: (configEnv) => ({
    plugins: [
      preact(),
      ...(configEnv.mode === 'production' && !keepDebugLogs ? [removeConsole({ includes: ['debug', 'info', 'log', 'table', 'group', 'groupCollapsed', 'groupEnd'] })] : []),
    ],
    // Test hooks (lib/testHooks.ts) exist only in debug builds.
    define: { __SLY_TEST_HOOKS__: JSON.stringify(keepDebugLogs) },
    optimizeDeps: {
      include: ['@indic-transliteration/sanscript'],
    },
  }),
  manifest: ({ browser }) => ({
    name: browser === 'firefox' ? 'Spotify Karaoke' : 'Spotify Karaoke - Fetches Missing Lyrics, Romanizes & Translates Songs',
    description: 'Automatically fetches missing synced lyrics, romanizes any script, and translates into 132 languages – all live inside Spotify.',
    icons: {
      16: "icon16.png",
      48: "icon48.png",
      128: "icon128.png"
    },
    permissions: ['storage', 'unlimitedStorage', 'declarativeNetRequest'],
    content_scripts: [
      {
        matches: ['https://open.spotify.com/*'],
        js: ['fetchInterceptor.js', 'slyBridge.js'],
        world: 'MAIN',
        run_at: 'document_start',
      },
    ],
    host_permissions: [
      '*://open.spotify.com/*',
      '*://spclient.wg.spotify.com/*',
      '*://open.spotifycdn.com/*',
      '*://translate.googleapis.com/*',
      '*://translate.google.com/*',
      // Japanese dictionary for the local romanizer (kuromoji, lib/lyrics/japaneseRomanizer.ts).
      '*://cdn.jsdelivr.net/*',
      // Layer 2 lyrics fallback providers (lyric-test integration)
      'https://lrclib.net/*',
      'https://music.youtube.com/*',
      'https://i.scdn.co/*',
    ],

    declarative_net_request: {
      rule_resources: [{
        id: 'ytm_rules',
        enabled: true,
        path: 'rules.json',
      }],
    },

    web_accessible_resources: [{
      resources: ['fetchInterceptor.js', 'slyBridge.js'],
      matches: ['https://open.spotify.com/*'],
    }],

    browser_specific_settings: {
      gecko: {
        id: 'spotify-karaoke@example.com',
        strict_min_version: '142.0',
        // @ts-ignore: WXT types missing the new Firefox AMO compliance flag
        data_collection_permissions: {
          required: ['none']
        },
      },
    },
  }),
});
