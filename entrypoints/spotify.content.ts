import { startContent } from '../src/content/main';

export default defineContentScript({
  matches: ['https://open.spotify.com/*'],
  runAt: 'document_start',
  main() {
    void startContent();
  },
});
