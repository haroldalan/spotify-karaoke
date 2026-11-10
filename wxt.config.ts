import { defineConfig } from 'wxt';

export default defineConfig({
  // `npm run dev` builds .output/chrome-mv3-dev and reloads it on every change; load that folder
  // unpacked in your own Chrome. WXT doesn't launch a browser of its own.
  webExt: { disabled: true },
  zip: {
    // The Firefox sources zip is built from this folder: never ship the signed-in test
    // browser profile (.live) or local probes.
    // assets/: the README's images and video, not needed to build.
    excludeSources: ['.live/**', '.output/**', 'tools/probe/**', 'assets/**', '.env*'],
  },
  // Same names as the published listings, so updates land on them.
  manifest: ({ browser, mode }) => ({
    // Dev kit builds say so in chrome://extensions (see src/devkit/protocol.ts).
    name: (browser === 'firefox' ? 'Spotify Karaoke' : 'Spotify Karaoke - Fetches Missing Lyrics, Romanizes & Translates Songs') + (mode === 'production' ? '' : ` (${mode})`),
    description: 'Romanizes and translates Spotify lyrics as they play, restores their original script, and finds lyrics Spotify doesn’t have.',
    permissions: ['storage', 'unlimitedStorage', 'declarativeNetRequestWithHostAccess', 'scripting'],
    host_permissions: [
      'https://open.spotify.com/*',
      'https://lrclib.net/*',
      'https://music.youtube.com/*',
      'https://translate.googleapis.com/*',
      // Japanese dictionary for kuromoji (romanization).
      'https://cdn.jsdelivr.net/*',
    ],
    icons: { 16: 'icon16.png', 48: 'icon48.png', 128: 'icon128.png' },
    commands: {
      'mode-original': { description: 'Show original lyrics', suggested_key: { default: 'Alt+Shift+O' } },
      'mode-romanized': { description: 'Show romanized lyrics', suggested_key: { default: 'Alt+Shift+R' } },
      'mode-translated': { description: 'Show translated lyrics', suggested_key: { default: 'Alt+Shift+T' } },
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              // The published add-on's id: this build updates it.
              id: 'spotify-karaoke@example.com',
              // Page-world content scripts (world: MAIN) need Firefox's MV3; 142 matches 3.1.6.
              strict_min_version: '142.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
});
