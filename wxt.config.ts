import { defineConfig } from 'wxt';

export default defineConfig({
  // `npm run dev` builds .output/chrome-mv3-dev and reloads it on every change; load that folder
  // unpacked in your own Chrome. WXT doesn't launch a browser of its own.
  webExt: { disabled: true },
  manifest: {
    name: 'Spotify Karaoke',
    description: 'Romanize and translate Spotify lyrics as they play, and find lyrics for songs Spotify has none for.',
    permissions: ['storage', 'unlimitedStorage', 'declarativeNetRequestWithHostAccess'],
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
  },
});
