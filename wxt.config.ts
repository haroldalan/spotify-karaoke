import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  vite: () => ({
    plugins: [preact()],
    optimizeDeps: {
      include: ['@indic-transliteration/sanscript'],
    },
  }),
  manifest: {
    name: 'Spotify Karaoke',
    description: 'Romanize and translate Spotify lyrics in your browser.',
    icons: {
      16: "icon16.png",
      48: "icon48.png",
      128: "icon128.png"
    },
    permissions: ['storage'],
    host_permissions: [
      '*://open.spotify.com/*',
      '*://translate.googleapis.com/*',
      '*://translate.google.com/*',
      '*://www.google.com/*',
      '*://api.mymemory.translated.net/*',
      '*://cdn.jsdelivr.net/*',
    ],
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
