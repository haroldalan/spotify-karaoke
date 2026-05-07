import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import removeConsole from 'vite-plugin-remove-console';

export default defineConfig({
  vite: (configEnv) => ({
    plugins: [
      preact(),
      ...(configEnv.mode === 'production' ? [removeConsole({ includes: ['log', 'debug', 'info'] })] : []),
    ],
    optimizeDeps: {
      include: ['@indic-transliteration/sanscript'],
    },
  }),
  manifest: {
    name: 'Spotify Karaoke - Fetches Missing Lyrics, Romanizes & Translates Songs',
    description: 'Automatically fetches missing synced lyrics, romanizes any script, and translates into 132 languages – all live inside Spotify.',
    icons: {
      16: "icon16.png",
      48: "icon48.png",
      128: "icon128.png"
    },
    permissions: ['storage', 'unlimitedStorage', 'declarativeNetRequest'],
    content_scripts: [
      {
        matches: ['*://open.spotify.com/*'],
        js: ['fetchInterceptor.js', 'slyBridge.js'],
        world: 'MAIN',
        run_at: 'document_start',
      },
    ],
    host_permissions: [
      '*://open.spotify.com/*',
      '*://spclient.wg.spotify.com/*',
      '*://open.spotifycdn.com/*',
      '*://apic-desktop.musixmatch.com/*',
      '*://translate.googleapis.com/*',
      '*://translate.google.com/*',
      '*://www.google.com/*',
      '*://api.mymemory.translated.net/*',
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
      matches: ['*://open.spotify.com/*'],
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
  },
});
